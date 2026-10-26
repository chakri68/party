extends SceneTree
## What every stage generator shares (tools/build_<stage>.gd extends this):
## the centreline (Catmull-Rom through control points, a seeded wobble, an
## even 2 m resample), the distance fields round it, the baked height grid,
## the road strip and its surface probe, checkpoint gates, spawn and
## recovery markers, callout landmarks and their map icons, scatter chunk
## records, and the small mesh helpers everything is made of.
##
## A stage script sets the per-stage knobs below in its _init, then runs its
## own pipeline. It must provide _height(x, z) (the ground before baking) and
## _profile(i) (the road's cross-section at sample i); the rest it uses as is
## or overrides. The biome (palette, sky, scatter style) is the stage's call:
## see scripts/biome.gd.
##
## Deterministic: every random number comes from a seeded stream, so the same
## script makes the same scene (node for node; the binary file itself isn't
## byte-stable, because Godot's resource ids aren't).

const MESH_DIR := "res://assets/meshes/"
const VC_MAT := "res://assets/materials/vertex_color.tres"
const ROAD_SHADER := "res://shaders/road.gdshader"
const GLOW_SHADER := "res://shaders/glow.gdshader"
const STEP := 2.0 ## metres between centreline samples
const CHUNK := 96.0 ## scatter chunk size; one MultiMesh (one draw call) per mesh per chunk, culled per chunk
const TERRAIN_CELL := 4.0
const HASH_CELL := 16.0
const DG_CELL := 2.0
## Road pieces this many centreline samples long (~120 m). One mesh for the
## whole stage put all 35k triangles through the GPU every frame from any
## camera; pieces let the camera cull what it can't see, for two or three
## extra draw calls.
const ROAD_PIECE := 60
const ICON_SCALE := 1.25 ## the small map shows ~0.26 px a metre; this keeps an icon ~7 px there

const LAYER_WORLD := 1
const LAYER_CAR := 2
const LAYER_TRIGGER := 4
const LAYER_SURFACE := 8
const RENDER_WORLD := 1
const RENDER_MAP_ONLY := 4
const RENDER_EGG := 16 ## layer 5: 3D view only (animated glows, the fake junction); never the map
const C_BEACON := Color("e0281e") ## EyeForest's far silhouette keys on this colour for the lamp
## Rally furniture, the same on every stage.
const C_BOARD := Color("1e1e1e")
const C_CHEVRON := Color("f2f2ea")
const C_TAPE_RED := Color("d8322a")
const C_TAPE_WHITE := Color("f0ede4")
const C_STRAW := Color("d6b65e")
const C_LOG_DARK := Color("4f3522")

# --- per-stage knobs (set in the stage's _init) ---------------------------------

var stage_seed := 11
## Route control points (x, z), start to finish, before route_scale.
var control: Array = []
var route_scale := 1.0
## Sideways wobble on the spline (1 = Pine Panic's), and how many sharp kinks.
var wobble := 1.0
var kink_count := 9
## Stage fractions where the checkpoints go, in order.
var cp_fractions: Array = []
## Checkpoint and finish gates: metres across the road.
var gate_width := 14.0
## Nominal road half width and loose verge, metres (per-sample widths vary round these).
var road_half_width := 3.0
var shoulder := 0.7
## What the car feels on the verge: "road" (Pine Panic's loose gravel edge
## counts as road) or another surface, e.g. "sand", probed separately.
var verge_surface := "road"
## What the car feels on the road itself (Snowblind's is packed "snow").
var road_surface := "road"
## Straw bales on the outside of the tight corners (Snowblind's snowbanks do
## that job there).
var hay := true
## Metres past the verge before the scenery starts (sightlines cut from here).
var ditch := 1.4

# --- state ---------------------------------------------------------------------

var track: Track
var pts: PackedVector3Array
var tans: PackedVector3Array
var n := 0
var rng := RandomNumberGenerator.new()
var noise := FastNoiseLite.new()
## Scenery gets its own random stream, so adding a prop doesn't reshuffle the scatter.
var srng := RandomNumberGenerator.new()
var terrain_noise := FastNoiseLite.new()
var vc_mat: Material
var map_mat: StandardMaterial3D
var road_mat: ShaderMaterial
var meshes := {}
var terrain: Terrain
var corners: Array = [] # [apex sample, min radius, turn sign]
## Per centreline sample: road half width, verge width, camber (height change
## per metre to the right), height profile.
var half_w := PackedFloat32Array()
var verge_w := PackedFloat32Array()
var bank := PackedFloat32Array()
var profile_h := PackedFloat32Array()
## Places scenery keeps away from: [Vector2 centre, radius].
var clearings: Array = []
## Ground tints: [Vector2 centre, radius, Color].
var yards: Array = []
## Places the ground flattens out for: [Vector2 centre, radius].
var flats: Array = []
## Raised ground: [Vector2 centre, radius, metres].
var mounds: Array = []
var scenery_sites := {} # id -> [sample, side, Vector3 on the road's height]
## Map icons for the callouts: [Node3D, shape, Color].
var callout_icons: Array = []
var tree_xz: Array = [] # Vector2 per tall plant, for the shade under them
var spawn_i := 0
var spectator_spots: Array = [] # [sample, side]
var finish_i := 0

var _hash := {} # Vector2i -> PackedInt32Array of sample indices
var _clear_index := {}
var _dg := PackedFloat32Array()
var _dg_rect := Rect2()
var _dg_w := 0
var _dg_h := 0


## The ground before baking, at world (x, z). The stage's call.
func _height(_x: float, _z: float) -> float:
	return 0.0


## Road cross-section at sample i: [[lateral m, colour, jitter m], ...],
## left to right. The stage's call.
func _profile(_i: int) -> Array:
	return []


## Packs the finished track and writes it.
func _save(out: String) -> int:
	_own(track)
	var ps := PackedScene.new()
	var err := ps.pack(track)
	assert(err == OK)
	err = ResourceSaver.save(ps, out, ResourceSaver.FLAG_COMPRESS)
	return err


# --- centreline ---------------------------------------------------------------

func _catmull(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)


func _sample_centerline() -> void:
	var c: Array[Vector2] = []
	for p in control:
		c.append(p * route_scale)
	# Open spline: mirror a phantom point past each end.
	c.push_front(c[0] * 2.0 - c[1])
	c.append(c[c.size() - 1] * 2.0 - c[c.size() - 2])
	var dense: Array[Vector2] = []
	for i in range(1, c.size() - 2):
		for k in 60:
			dense.append(_catmull(c[i - 1], c[i], c[i + 1], c[i + 2], k / 60.0))
	dense.append(c[c.size() - 2])
	var raw := _resample(dense)
	# Wobble: push the line sideways by a seeded, smooth amount (two octaves
	# plus a few sharp kinks), so straights aren't ruler-straight and corners
	# tighten or open partway. Damped in tight corners: the hairpins stay
	# the hairpins, and the start and finish stay straight for the arches.
	var m := raw.size()
	var wob := FastNoiseLite.new()
	wob.seed = stage_seed + 3
	wob.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	wob.frequency = 1.0
	var kinks: Array = []
	var krng := RandomNumberGenerator.new()
	krng.seed = stage_seed + 5
	for k in kink_count:
		kinks.append([krng.randf_range(0.08, 0.92) * m * STEP, krng.randf_range(0.9, 1.6) * (1.0 if krng.randf() < 0.5 else -1.0), krng.randf_range(5.0, 9.0)])
	var moved: Array[Vector2] = []
	for i in m:
		var a := raw[maxi(i - 6, 0)]
		var b := raw[i]
		var cc := raw[mini(i + 6, m - 1)]
		var turn := absf((b - a).angle_to(cc - b))
		var radius := 12.0 * STEP / maxf(turn, 0.0001)
		var s := i * STEP
		var amp := smoothstep(22.0, 45.0, radius) * smoothstep(0.0, 60.0, s) * smoothstep(0.0, 90.0, (m - 1) * STEP - s)
		var off := wob.get_noise_1d(s / 55.0) * 1.6 + wob.get_noise_1d(s / 17.0 + 40.0) * 0.45
		for kk in kinks:
			off += float(kk[1]) * exp(-pow((s - float(kk[0])) / float(kk[2]), 2.0))
		var t := (cc - a).normalized()
		moved.append(b + Vector2(-t.y, t.x) * off * amp * wobble)
	var fin := _resample(moved)
	for p in fin:
		pts.append(Vector3(p.x, 0.0, p.y))
	n = pts.size()
	for i in n:
		tans.append((pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]).normalized())


## Uniform arc-length resample, so samples double as distance markers.
func _resample(line: Array[Vector2]) -> Array[Vector2]:
	var out: Array[Vector2] = []
	var acc := 0.0
	var target := 0.0
	for i in line.size() - 1:
		var a := line[i]
		var b := line[i + 1]
		var seg := a.distance_to(b)
		while seg > 0.0 and target <= acc + seg:
			out.append(a.lerp(b, (target - acc) / seg))
			target += STEP
		acc += seg
	return out


func _right(i: int) -> Vector3:
	var t := tans[clampi(i, 0, n - 1)]
	return Vector3(-t.z, 0, t.x)


func _road_bounds() -> Rect2:
	var r := Rect2(Vector2(pts[0].x, pts[0].z), Vector2.ZERO)
	for p in pts:
		r = r.expand(Vector2(p.x, p.z))
	return r


func _xf_at(i: int, lift := 0.0) -> Transform3D:
	return Transform3D(Basis.looking_at(tans[i], Vector3.UP), pts[i] + Vector3(0, lift, 0))


func _build_hash() -> void:
	for i in n:
		var k := Vector2i(floori(pts[i].x / HASH_CELL), floori(pts[i].z / HASH_CELL))
		if not _hash.has(k):
			_hash[k] = PackedInt32Array()
		_hash[k].append(i)


## Distance from p to the centreline (sample-accurate, capped).
func _road_dist(x: float, z: float, cap := 64.0) -> float:
	var best := cap
	var r := ceili(cap / HASH_CELL)
	var cx := floori(x / HASH_CELL)
	var cz := floori(z / HASH_CELL)
	for dx in range(-r, r + 1):
		for dz in range(-r, r + 1):
			var k := Vector2i(cx + dx, cz + dz)
			if _hash.has(k):
				for i in _hash[k]:
					best = minf(best, Vector2(x - pts[i].x, z - pts[i].z).length())
	return best


func _nearest_sample(x: float, z: float) -> int:
	var best := INF
	var bi := 0
	for i in n:
		var d := Vector2(x - pts[i].x, z - pts[i].z).length_squared()
		if d < best:
			best = d
			bi = i
	return bi


func _clear(x: float, z: float, pad := 0.0) -> bool:
	var list: Array = clearings
	if not _clear_index.is_empty():
		list = _clear_index.get(Vector2i(floori(x / 32.0), floori(z / 32.0)), [])
	for c in list:
		if Vector2(x, z).distance_to(c[0]) < c[1] + pad:
			return false
	return true


## Buckets clearings into 32 m cells so the forest pass checks a handful, not all.
func _index_clearings() -> void:
	for c in clearings:
		var ctr: Vector2 = c[0]
		var r: float = c[1]
		for cx in range(floori((ctr.x - r) / 32.0), floori((ctr.x + r) / 32.0) + 1):
			for cz in range(floori((ctr.y - r) / 32.0), floori((ctr.y + r) / 32.0) + 1):
				var k := Vector2i(cx, cz)
				if not _clear_index.has(k):
					_clear_index[k] = []
				_clear_index[k].append(c)


## Approximate distance-to-road field (two-pass chamfer), for the far forest
## where exact distances don't matter. Near the road _road_dist is exact.
func _build_dist_grid(rect: Rect2, extra := PackedVector3Array()) -> void:
	_dg_rect = rect
	_dg_w = int(ceil(rect.size.x / DG_CELL)) + 1
	_dg_h = int(ceil(rect.size.y / DG_CELL)) + 1
	_dg.resize(_dg_w * _dg_h)
	_dg.fill(1e6)
	for p in pts + extra:
		var cx := int((p.x - rect.position.x) / DG_CELL)
		var cz := int((p.z - rect.position.y) / DG_CELL)
		for dz in range(-3, 4):
			for dx in range(-3, 4):
				var x := cx + dx
				var z := cz + dz
				if x < 0 or z < 0 or x >= _dg_w or z >= _dg_h:
					continue
				var w := Vector2(rect.position.x + x * DG_CELL - p.x, rect.position.y + z * DG_CELL - p.z).length()
				_dg[z * _dg_w + x] = minf(_dg[z * _dg_w + x], w)
	var o := DG_CELL
	var dgl := DG_CELL * 1.4142
	for z in _dg_h:
		for x in _dg_w:
			var i := z * _dg_w + x
			var v := _dg[i]
			if x > 0: v = minf(v, _dg[i - 1] + o)
			if z > 0:
				v = minf(v, _dg[i - _dg_w] + o)
				if x > 0: v = minf(v, _dg[i - _dg_w - 1] + dgl)
				if x < _dg_w - 1: v = minf(v, _dg[i - _dg_w + 1] + dgl)
			_dg[i] = v
	for z in range(_dg_h - 1, -1, -1):
		for x in range(_dg_w - 1, -1, -1):
			var i := z * _dg_w + x
			var v := _dg[i]
			if x < _dg_w - 1: v = minf(v, _dg[i + 1] + o)
			if z < _dg_h - 1:
				v = minf(v, _dg[i + _dg_w] + o)
				if x < _dg_w - 1: v = minf(v, _dg[i + _dg_w + 1] + dgl)
				if x > 0: v = minf(v, _dg[i + _dg_w - 1] + dgl)
			_dg[i] = v


func _fast_dist(x: float, z: float) -> float:
	var cx := clampi(int(round((x - _dg_rect.position.x) / DG_CELL)), 0, _dg_w - 1)
	var cz := clampi(int(round((z - _dg_rect.position.y) / DG_CELL)), 0, _dg_h - 1)
	var d := _dg[cz * _dg_w + cx]
	return _road_dist(x, z, 16.0) if d < 18.0 else d


## Signed turn over +-k samples: < 0 is a right-hander (seen from above, north up).
func _turn(i: int, k := 6) -> float:
	return tans[maxi(i - k, 0)].cross(tans[mini(i + k, n - 1)]).y


func _find_corners() -> void:
	# Radius from heading change over a 24 m chord; group consecutive tight samples.
	var cur: Array = []
	for i in range(6, n - 6):
		var dh := tans[i - 6].signed_angle_to(tans[i + 6], Vector3.UP)
		var r := 24.0 / maxf(absf(dh), 0.0001)
		if r < 34.0:
			if cur.is_empty() or i - cur[3] > 4:
				if not cur.is_empty():
					corners.append(cur)
				cur = [i, r, signf(_turn(i)), i]
			else:
				if r < cur[1]:
					cur[0] = i
					cur[1] = r
				cur[3] = i
	if not cur.is_empty():
		corners.append(cur)
	for c in corners:
		print("corner at %4d m  radius %4.1f  %s" % [c[0] * STEP, c[1], "right" if c[2] < 0 else "left"])


## Local radius at sample i from the heading change over a 24 m chord.
func _radius(i: int) -> float:
	var dh := tans[maxi(i - 6, 0)].signed_angle_to(tans[mini(i + 6, n - 1)], Vector3.UP)
	return 24.0 / maxf(absf(dh), 0.0001)


## Cosine bump: 1 at centre, 0 at +-half, smooth both ends.
func _bump(s: float, centre: float, half: float) -> float:
	var t := absf(s - centre) / half
	return 0.5 + 0.5 * cos(PI * t) if t < 1.0 else 0.0


## Bakes the height grid into the Terrain (tints come later, after the
## forest) and drops the centreline onto it. From here on everything asks
## terrain.height_at(), the same function the game uses.
func _bake_heights(bb: Rect2) -> void:
	terrain_noise.seed = stage_seed + 11
	terrain_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	terrain_noise.frequency = 0.0085
	var area := bb.grow(80.0)
	terrain.origin = area.position
	terrain.cell = TERRAIN_CELL
	terrain.w = int(ceil(area.size.x / TERRAIN_CELL)) + 1
	terrain.d = int(ceil(area.size.y / TERRAIN_CELL)) + 1
	var bytes := PackedByteArray()
	bytes.resize(terrain.w * terrain.d * 2)
	for iz in terrain.d:
		for ix in terrain.w:
			var hh := _height(area.position.x + ix * TERRAIN_CELL, area.position.y + iz * TERRAIN_CELL)
			bytes.encode_s16((iz * terrain.w + ix) * 2, clampi(roundi(hh * 100.0), -32000, 32000))
	terrain.heights_cm = bytes
	terrain.decode()
	for i in n:
		pts[i].y = terrain.height_at(pts[i].x, pts[i].z)
	var lo := INF
	var hi := -INF
	for p in pts:
		lo = minf(lo, p.y)
		hi = maxf(hi, p.y)
	print("terrain: %d x %d, road height %.1f..%.1f m" % [terrain.w, terrain.d, lo, hi])


## p dropped (or lifted) onto the ground.
func _g(p: Vector3, lift := 0.0) -> Vector3:
	return Vector3(p.x, terrain.height_at(p.x, p.z) + lift, p.z)


## Appends a primitive (BoxMesh etc.) into st, transformed, in one flat colour.
func _prim(st: SurfaceTool, prim: PrimitiveMesh, xf: Transform3D, col: Color) -> void:
	var a := prim.get_mesh_arrays()
	var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
	var nm: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
	var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX]
	var nb := xf.basis.inverse().transposed()
	for i in idx:
		st.set_color(col)
		st.set_normal((nb * nm[i]).normalized())
		st.add_vertex(xf * v[i])


func _box(st: SurfaceTool, xf: Transform3D, size: Vector3, col: Color) -> void:
	var b := BoxMesh.new()
	b.size = size
	_prim(st, b, xf, col)


func _st() -> SurfaceTool:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	return st


func _commit(st: SurfaceTool, mat: Material = null) -> ArrayMesh:
	var m := st.commit()
	m.surface_set_material(0, mat if mat else vc_mat)
	return m


func _mesh_node(name: String, mesh: Mesh, xf := Transform3D.IDENTITY, layers := RENDER_WORLD) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = name
	mi.mesh = mesh
	mi.transform = xf
	mi.layers = layers
	return mi


func _solid(name: String, kind: String, xf: Transform3D, size: Vector3, centre := Vector3.ZERO) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = name
	body.collision_layer = LAYER_WORLD
	body.collision_mask = 0
	body.add_to_group("track_obstacle", true)
	body.set_meta("kind", kind)
	body.transform = xf
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	cs.position = centre + Vector3(0, size.y * 0.5, 0)
	body.add_child(cs)
	return body


func _group(name: String) -> Node3D:
	var g := Node3D.new()
	g.name = name
	track.add_child(g)
	return g


func _road() -> void:
	var rows: Array = []
	for i in n:
		var row: Array = []
		var shade := 1.0 + noise.get_noise_2d(pts[i].x * 2.0, pts[i].z * 2.0) * 0.12
		for p in _profile(i):
			# Per-vertex mottle on top of the slow noise: loose gravel isn't a smooth band.
			var c: Color = (p[1] as Color).darkened(rng.randf_range(-0.05, 0.09))
			var lat: float = float(p[0]) + rng.randf_range(-1.0, 1.0) * float(p[2])
			# On the ground itself, lifted a hair; the ground is the same grid
			# the car drives on, so the road can't float or sink.
			var pos := _g(pts[i] + _right(i) * lat, 0.04)
			row.append([pos, Color(c.r * shade, c.g * shade, c.b * shade, c.a), Vector2(lat, i * STEP), Vector2(half_w[i], half_w[i] + verge_w[i])])
		rows.append(row)
	var cols: int = (rows[0] as Array).size()
	var body := StaticBody3D.new()
	body.name = "Road"
	body.add_to_group("track_road", true)
	body.set_meta("surface", road_surface)
	body.collision_layer = LAYER_SURFACE
	body.collision_mask = 0
	for i0 in range(0, n - 1, ROAD_PIECE):
		var st := _st()
		for i in range(i0, mini(i0 + ROAD_PIECE, n - 1)):
			for j in cols - 1:
				var a: Array = rows[i][j]
				var b: Array = rows[i][j + 1]
				var c: Array = rows[i + 1][j]
				var d: Array = rows[i + 1][j + 1]
				for v in [a, c, b, b, c, d]:
					st.set_color(v[1])
					st.set_uv(v[2])
					st.set_uv2(v[3])
					st.set_normal(terrain.normal_at(v[0].x, v[0].z))
					st.add_vertex(v[0])
		st.index()
		var mi := _mesh_node("Mesh%d" % (i0 / ROAD_PIECE), _commit(st, road_mat))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		body.add_child(mi)
	# Probe covers road and verge, not the ditch, and follows the ground (in
	# three strips across, so camber is carried, not averaged away). With a
	# verge surface of its own, the road probe stops at the verge and the
	# verge gets a body of its own.
	var faces := PackedVector3Array()
	var split := verge_surface != "road"
	for i in n - 1:
		var w0 := half_w[i] + (0.0 if split else verge_w[i])
		var w1 := half_w[i + 1] + (0.0 if split else verge_w[i + 1])
		for k in 3:
			var f0 := -1.0 + k * 2.0 / 3.0
			var f1 := -1.0 + (k + 1) * 2.0 / 3.0
			var a := _g(pts[i] + _right(i) * w0 * f0)
			var b := _g(pts[i] + _right(i) * w0 * f1)
			var c := _g(pts[i + 1] + _right(i + 1) * w1 * f0)
			var d := _g(pts[i + 1] + _right(i + 1) * w1 * f1)
			faces.append_array([a, c, b, b, c, d])
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	shape.backface_collision = true
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	cs.shape = shape
	body.add_child(cs)
	track.add_child(body)
	if split:
		_verge_probe()


## The verge's own surface probe (verge_surface), both sides, half_w out to
## the verge edge.
func _verge_probe() -> void:
	var faces := PackedVector3Array()
	for i in n - 1:
		for side in [-1.0, 1.0]:
			var a := _g(pts[i] + _right(i) * side * half_w[i])
			var b := _g(pts[i] + _right(i) * side * (half_w[i] + verge_w[i]))
			var c := _g(pts[i + 1] + _right(i + 1) * side * half_w[i + 1])
			var d := _g(pts[i + 1] + _right(i + 1) * side * (half_w[i + 1] + verge_w[i + 1]))
			faces.append_array([a, c, b, b, c, d])
	var body := StaticBody3D.new()
	body.name = "Verge"
	body.add_to_group("track_road", true)
	body.set_meta("surface", verge_surface)
	body.collision_layer = LAYER_SURFACE
	body.collision_mask = 0
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	shape.backface_collision = true
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	cs.shape = shape
	body.add_child(cs)
	track.add_child(body)


## Invisible fence at the edge of the world so nobody drives into the void.
func _world_walls(bb: Rect2) -> void:
	var walls := _group("WorldBounds")
	var c := bb.get_center()
	var e := bb.size * 0.5 + Vector2(20, 20)
	var defs := [
		[Vector3(c.x, 0, c.y - e.y), Vector3(e.x * 2, 40, 1)],
		[Vector3(c.x, 0, c.y + e.y), Vector3(e.x * 2, 40, 1)],
		[Vector3(c.x - e.x, 0, c.y), Vector3(1, 40, e.y * 2)],
		[Vector3(c.x + e.x, 0, c.y), Vector3(1, 40, e.y * 2)],
	]
	for k in defs.size():
		var body := StaticBody3D.new()
		body.name = "Wall%d" % k
		body.collision_layer = LAYER_WORLD
		body.position = defs[k][0]
		var cs := CollisionShape3D.new()
		cs.name = "Shape"
		var bs := BoxShape3D.new()
		bs.size = defs[k][1]
		cs.shape = bs
		body.add_child(cs)
		walls.add_child(body)


## Metres across the gate at sample i. gate_width unless a stage knows better
## (a canyon gate has to span the whole floor, wall to wall).
func _gate_width_at(_i: int) -> float:
	return gate_width


func _gate(name: String, i: int, width := -1.0) -> Area3D:
	var area := Area3D.new()
	area.name = name
	area.transform = _xf_at(i, 1.5)
	area.collision_layer = LAYER_TRIGGER
	area.collision_mask = LAYER_CAR
	area.monitorable = false
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var bs := BoxShape3D.new()
	bs.size = Vector3(gate_width if width < 0.0 else width, 3, 2)
	cs.shape = bs
	area.add_child(cs)
	return area


func _markers() -> void:
	var markers := _group("Markers")

	var spawn := Marker3D.new()
	spawn.name = "Spawn"
	spawn.transform = _xf_at(spawn_i, 0.6)
	spawn.add_to_group("track_spawn", true)
	markers.add_child(spawn)
	var start_anchor := Marker3D.new()
	start_anchor.name = "Recovery0"
	start_anchor.transform = _xf_at(spawn_i, 0.6)
	start_anchor.add_to_group("track_recovery", true)
	start_anchor.set_meta("after_checkpoint", 0)
	markers.add_child(start_anchor)

	var fin := _gate("Finish", finish_i, _gate_width_at(finish_i))
	fin.add_to_group("track_finish", true)
	fin.set_meta("distance_m", finish_i * STEP)
	markers.add_child(fin)

	for k in cp_fractions.size():
		var i := int(cp_fractions[k] * n)
		var cp := _gate("CP%d" % (k + 1), i, _gate_width_at(i))
		cp.add_to_group("track_checkpoint", true)
		cp.set_meta("index", k + 1)
		cp.set_meta("distance_m", i * STEP)
		markers.add_child(cp)
		var rec := Marker3D.new()
		rec.name = "Recovery%d" % (k + 1)
		rec.transform = _xf_at(i + 3, 0.6)
		rec.add_to_group("track_recovery", true)
		rec.set_meta("after_checkpoint", k + 1)
		markers.add_child(rec)


func _straightest_near(at: float, span: int) -> int:
	var best := INF
	var bi := int(at * n)
	for i in range(int(at * n) - span, int(at * n) + span):
		var t := absf(_turn(i, 10))
		if t < best:
			best = t
			bi = i
	return bi


func _landmarks() -> Node3D:
	return track.get_node("Landmarks") if track.has_node("Landmarks") else _group("Landmarks")


func _side_spot(at: float, offset: float) -> Array:
	var i := int(at * n)
	var side := -1.0 if _turn(i, 10) < 0 else 1.0 # outside of any bend, where there's room
	var p := pts[i] + _right(i) * side * offset
	return [i, side, p] # y is the road's; the site is flattened to about that


## Registers a callout: landmark group, label, distance, map icon.
func _callout(body: Node3D, label: String, site: Array, shape: String, col: Color) -> void:
	body.add_to_group("track_landmark", true)
	body.set_meta("label", label)
	body.set_meta("callout", true)
	body.set_meta("distance_m", int(site[0]) * STEP)
	_landmarks().add_child(body)
	callout_icons.append([body, shape, col])
	_sightline(site)


## Opens the tree wall between the road and a callout, and back along the
## approach, so it can be seen from the car (at eye level the first row of
## trunks hides anything 8 m in), not just from above.
func _sightline(site: Array) -> void:
	var i: int = site[0]
	var side: float = site[1]
	var p: Vector3 = site[2]
	for from in [i, maxi(i - 9, 0)]:
		var a := pts[from] + _right(from) * side * (half_w[from] + verge_w[from] + ditch + 1.0)
		var steps := maxi(int(Vector2(a.x - p.x, a.z - p.z).length() / 2.5), 1)
		for k in steps:
			var q := a.lerp(p, float(k) / steps)
			clearings.append([Vector2(q.x, q.z), 2.6])


## Facing for a prop at `p` beside sample i: +Z toward the road.
func _facing_road(i: int, p: Vector3) -> Basis:
	var face := Vector3(pts[i].x - p.x, 0, pts[i].z - p.z).normalized()
	return Basis.looking_at(-face, Vector3.UP)


## A box from a to b, `w` thick: legs, braces, rails.
func _beam(st: SurfaceTool, a: Vector3, b: Vector3, w: float, col: Color) -> void:
	var d := b - a
	var up := Vector3.UP if absf(d.normalized().dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
	_box(st, Transform3D(Basis.looking_at(d, up), (a + b) * 0.5), Vector3(w, w, d.length()), col)


## Appends a baked mesh's triangles (vertex colours) into st.
func _merge(st: SurfaceTool, mesh: Mesh, xf: Transform3D, tint := Color.WHITE) -> void:
	var a := mesh.surface_get_arrays(0)
	var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
	var nm: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
	var cols: PackedColorArray = a[Mesh.ARRAY_COLOR]
	var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX] if a[Mesh.ARRAY_INDEX] != null else PackedInt32Array(range(v.size()))
	var nb := xf.basis.inverse().transposed()
	for i in idx:
		st.set_color(cols[i] * tint if not cols.is_empty() else tint)
		st.set_normal((nb * nm[i]).normalized())
		st.add_vertex(xf * v[i])


func _glow_mat(col: Color, size_energy: float, pulse: float, fade: Vector2, flame := false) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(GLOW_SHADER)
	m.set_shader_parameter("color", col)
	m.set_shader_parameter("energy", size_energy)
	m.set_shader_parameter("pulse_period", pulse)
	m.set_shader_parameter("fade", fade)
	m.set_shader_parameter("flame", flame)
	m.set_shader_parameter("billboard", not flame)
	return m


## A soft additive glow sprite on the 3D-only layer: never in the map.
func _glow(name: String, size: float, mat: ShaderMaterial, pos: Vector3) -> MeshInstance3D:
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var mi := _mesh_node(name, q, Transform3D(Basis.IDENTITY, pos), RENDER_EGG)
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


func _add(chunks: Dictionary, counts: Dictionary, id: String, x: float, y: float, z: float, yaw: float, s: float) -> void:
	var key := Vector2i(floori(x / CHUNK), floori(z / CHUNK))
	if not chunks.has(key):
		chunks[key] = {}
	if not chunks[key].has(id):
		chunks[key][id] = PackedFloat32Array()
	chunks[key][id].append_array([snappedf(x, 0.01), snappedf(y, 0.01), snappedf(z, 0.01), snappedf(yaw, 0.01), snappedf(s, 0.01)])
	counts[id] = counts.get(id, 0) + 1


## Flat-shaded triangle (Kenney's look), clockwise from outside.
func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, col: Color) -> void:
	var nrm := (c - a).cross(b - a).normalized()
	for v in [a, b, c]:
		st.set_color(col)
		st.set_normal(nrm)
		st.add_vertex(v)


## n-sided cone from radius r at y0 to a point at y1, base darkened like the
## baked pines' fake AO. Open bottom: nobody sees it from above.
func _cone(st: SurfaceTool, sides: int, r: float, y0: float, y1: float, col: Color, yaw := 0.0) -> void:
	for k in sides:
		var a0 := yaw + TAU * k / sides
		var a1 := yaw + TAU * (k + 1) / sides
		var p0 := Vector3(cos(a0) * r, y0, sin(a0) * r)
		var p1 := Vector3(cos(a1) * r, y0, sin(a1) * r)
		_tri(st, p0, p1, Vector3(0, y1, 0), col.darkened(0.08 * (k % 2)))


## Icon outlines in map metres (x east, z south; so -z points up the map).
## [polygon, colour or null for the icon's own].
func _icon_shape(shape: String) -> Array:
	var rect := func(cx: float, cz: float, w: float, h: float, rot := 0.0) -> PackedVector2Array:
		var out := PackedVector2Array()
		for c in [Vector2(-w, -h), Vector2(w, -h), Vector2(w, h), Vector2(-w, h)]:
			out.append(Vector2(cx, cz) + (c * 0.5).rotated(rot))
		return out
	match shape:
		"tower": # tall spike with the beacon on top
			return [[PackedVector2Array([Vector2(-6, 11), Vector2(6, 11), Vector2(0, -12)]), null],
				[rect.call(0.0, -14.0, 5.0, 5.0), C_BEACON]]
		"stand": # diamond
			return [[PackedVector2Array([Vector2(0, -10), Vector2(10, 0), Vector2(0, 10), Vector2(-10, 0)]), null]]
		"logs": # three stacked bars
			return [[rect.call(0.0, -7.0, 22.0, 4.5), null], [rect.call(0.0, 0.0, 22.0, 4.5), null], [rect.call(0.0, 7.0, 22.0, 4.5), null]]
		"outhouse": # upright box with a lean-to roof
			return [[rect.call(0.0, 2.0, 11.0, 14.0), null], [PackedVector2Array([Vector2(-8, -5), Vector2(8, -5), Vector2(0, -12)]), null]]
		"wreck": # X
			return [[rect.call(0.0, 0.0, 26.0, 5.5, PI * 0.25), null], [rect.call(0.0, 0.0, 26.0, 5.5, -PI * 0.25), null]]
		"gate": # bar between two posts
			return [[rect.call(0.0, 0.0, 22.0, 4.0), null], [rect.call(-12.0, 0.0, 5.0, 12.0), null], [rect.call(12.0, 0.0, 5.0, 12.0), null]]
		"tent": # wide, low triangle
			return [[PackedVector2Array([Vector2(-13, 9), Vector2(13, 9), Vector2(0, -10)]), null]]
		"windpump": # a fan of four blades on a thin tower
			return [[rect.call(0.0, 4.0, 3.5, 16.0), null], [rect.call(0.0, -6.0, 20.0, 4.0, PI * 0.25), null],
				[rect.call(0.0, -6.0, 20.0, 4.0, -PI * 0.25), null]]
		"tank": # a drum on legs
			var drum := PackedVector2Array()
			for k in 8:
				drum.append(Vector2(cos(TAU * (k + 0.5) / 8.0), sin(TAU * (k + 0.5) / 8.0)) * 9.0 + Vector2(0, -3))
			return [[drum, null], [rect.call(-5.0, 9.0, 3.0, 8.0), null], [rect.call(5.0, 9.0, 3.0, 8.0), null]]
		"shrine": # a cross under a little roof
			return [[rect.call(0.0, 2.0, 4.0, 18.0), null], [rect.call(0.0, -2.0, 14.0, 4.0), null],
				[PackedVector2Array([Vector2(-9, -9), Vector2(9, -9), Vector2(0, -15)]), null]]
		"plough": # truck from above with the angled blade out front
			return [[rect.call(0.0, 4.0, 10.0, 18.0), null], [rect.call(0.0, -9.0, 20.0, 4.0, 0.3), null]]
		"fence": # three staggered rows
			return [[rect.call(-3.0, -8.0, 18.0, 3.0), null], [rect.call(3.0, 0.0, 18.0, 3.0), null], [rect.call(-3.0, 8.0, 18.0, 3.0), null]]
		"hut": # a house front: box and roof
			return [[rect.call(0.0, 4.0, 16.0, 11.0), null], [PackedVector2Array([Vector2(-11, -1), Vector2(11, -1), Vector2(0, -13)]), null]]
	return []


## One map icon per callout (callout_icons), each its own shape (not colour
## alone, spec §10), north up whatever way the thing faces, `y` above the
## ground. One node each under g/Icons, so tests (and the big map) can find
## them; the map renders once, so the extra draws cost nothing after.
func _callout_icon_layer(g: Node3D, y: Vector3) -> void:
	var icons_g := Node3D.new()
	icons_g.name = "Icons"
	g.add_child(icons_g)
	for ic in callout_icons:
		var node: Node3D = ic[0]
		var ist := _st()
		var at := node.transform.origin
		at.y = y.y + 0.8
		for part in _icon_shape(ic[1]):
			var poly: PackedVector2Array = part[0]
			for o in Geometry2D.offset_polygon(poly, 2.4, Geometry2D.JOIN_MITER):
				_flat_poly(ist, o, at - Vector3(0, 0.15, 0), Color("1a1a1a"))
		for part in _icon_shape(ic[1]):
			_flat_poly(ist, part[0], at, part[1] if part[1] != null else ic[2])
		var icon := _mesh_node(String(node.name), _commit(ist, map_mat), Transform3D.IDENTITY, RENDER_MAP_ONLY)
		icon.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		icon.set_meta("label", node.get_meta("label"))
		icon.set_meta("shape", ic[1])
		icons_g.add_child(icon)


func _flat_poly(st: SurfaceTool, poly: PackedVector2Array, at: Vector3, col: Color) -> void:
	poly = Transform2D.IDENTITY.scaled(Vector2.ONE * ICON_SCALE) * poly
	var tris := Geometry2D.triangulate_polygon(poly)
	for k in tris:
		st.set_color(col)
		st.set_normal(Vector3.UP)
		st.add_vertex(at + Vector3(poly[k].x, 0, poly[k].y))


func _ribbon(st: SurfaceTool, line: PackedVector3Array, half: float, col: Color, lift: Vector3) -> void:
	for i in line.size() - 1:
		var t0 := (line[mini(i + 1, line.size() - 1)] - line[maxi(i - 1, 0)]).normalized()
		var t1 := (line[mini(i + 2, line.size() - 1)] - line[i]).normalized()
		var r0 := Vector3(-t0.z, 0, t0.x) * half
		var r1 := Vector3(-t1.z, 0, t1.x) * half
		var a := line[i] - r0 + lift
		var b := line[i] + r0 + lift
		var c := line[i + 1] - r1 + lift
		var d := line[i + 1] + r1 + lift
		for v in [a, c, b, b, c, d]:
			st.set_color(col)
			st.set_normal(Vector3.UP)
			st.add_vertex(v)


func _own(node: Node) -> void:
	for c in node.get_children():
		c.owner = track
		_own(c)


# --- rally furniture: arches, chevrons, hay, spectators -------------------------

func _plan() -> void:
	# Spectators where it's worth watching: the two tightest corners, outside.
	var by_radius := corners.duplicate()
	by_radius.sort_custom(func(a: Array, b: Array) -> bool: return a[1] < b[1])
	for c in by_radius.slice(0, 2):
		spectator_spots.append([c[0], -c[2]]) # outside = opposite the turn
	# And one fast kink midway, inside, set well back.
	spectator_spots.append([int(0.42 * n), 1.0])


## Start and finish arches (Kenney's inflatable), a painted line under each.
func _arches() -> void:
	var g := _group("Arches")
	for spec in [["StartArch", spawn_i + 8, false], ["FinishArch", finish_i, true]]:
		var i: int = spec[1]
		var xf := _xf_at(i)
		var arch := Node3D.new()
		arch.name = spec[0]
		arch.transform = xf
		const S := 1.2
		# The mesh spans x 0..9.33, z -1.65..0; centre it on the road.
		arch.add_child(_mesh_node("Mesh", meshes["arch"], Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * S), Vector3(-4.665 * S, 0, 0.825 * S))))
		for side in [-1.0, 1.0]:
			arch.add_child(_solid("Leg%s" % ("L" if side < 0 else "R"), "arch", Transform3D(Basis.IDENTITY, Vector3(side * 5.0, 0, 0)), Vector3(0.9, 3.0, 1.6)))
		var st := _st()
		var w := road_half_width * 2 + shoulder * 2
		if spec[2]:
			# Chequered finish line.
			for a in 2:
				for b in int(w / 0.75):
					var col := C_BOARD if (a + b) % 2 == 0 else C_CHEVRON
					_box(st, Transform3D(Basis.IDENTITY, Vector3(-w * 0.5 + 0.375 + b * 0.75, 0.04, -0.375 + a * 0.75)), Vector3(0.75, 0.02, 0.75), col)
		else:
			_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.04, 0)), Vector3(w, 0.02, 0.5), C_CHEVRON)
		arch.add_child(_mesh_node("Line", _commit(st)))
		for side in [-1.0, 1.0]:
			arch.add_child(_mesh_node("Flag", meshes["flag_green" if not spec[2] else "flag_red"],
				Transform3D(Basis(Vector3.UP, PI * 0.5), Vector3(side * 6.4, 0, 1.5))))
		g.add_child(arch)
		clearings.append([Vector2(xf.origin.x, xf.origin.z), 9.0])


## Chevron board, tilted back so the arrows read from the Navigator's camera.
func _chevron_mesh(right_turn: bool) -> ArrayMesh:
	var st := _st()
	var tilt := Basis(Vector3.RIGHT, deg_to_rad(35))
	var face := Transform3D(tilt, Vector3(0, 1.25, 0))
	_box(st, face, Vector3(2.4, 0.9, 0.06), C_BOARD)
	for k in 2:
		var x := -0.45 + k * 0.7
		# The driver faces the board's +Z, so their right is the board's -X.
		var dir := -1.0 if right_turn else 1.0
		for s in [-1.0, 1.0]:
			var bar := Transform3D(Basis(Vector3.BACK, -s * dir * deg_to_rad(40)), Vector3(x * dir, s * 0.17, -0.045))
			_box(st, face * bar, Vector3(0.5, 0.13, 0.03), C_CHEVRON)
	for x in [-0.9, 0.9]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, 0.55, 0.25)), Vector3(0.1, 1.1, 0.1), C_LOG_DARK)
	return _commit(st)


func _corner_furniture() -> void:
	var g := _group("Corners")
	var right_board := _chevron_mesh(true)
	var left_board := _chevron_mesh(false)
	var bale := BoxMesh.new()
	bale.size = Vector3(1.2, 0.6, 0.7)
	var count := 0
	for c in corners:
		var apex: int = c[0]
		var right_turn: bool = c[2] < 0
		var outside := _right(apex) * (-1.0 if right_turn else 1.0)
		# Boards on the outside, from just before the turn-in to the apex.
		for k in 3:
			var i := clampi(apex - 10 + k * 5, 0, n - 1)
			var o := _right(i) * (-1.0 if right_turn else 1.0)
			var p := _g(pts[i] + o * (half_w[i] + verge_w[i] + ditch + 0.6))
			var facing := Basis.looking_at(-tans[maxi(apex - 14, 0)], Vector3.UP)
			g.add_child(_mesh_node("Chevron%d" % count, right_board if right_turn else left_board, Transform3D(facing, p)))
			clearings.append([Vector2(p.x, p.z), 1.8])
			count += 1
		# Tight ones get a line of hay on the outside of the apex.
		if hay and c[1] < 22.0:
			var st := _st()
			var line: Array[Vector3] = []
			for k in 7:
				var i := clampi(apex - 6 + k * 2, 0, n - 1)
				var o := _right(i) * (-1.0 if right_turn else 1.0)
				var p := _g(pts[i] + o * (half_w[i] + verge_w[i] + 0.9))
				line.append(p)
				_prim(st, bale, Transform3D(Basis.looking_at(tans[i], Vector3.UP), p + Vector3(0, 0.3, 0)), C_STRAW.darkened(rng.randf_range(0.0, 0.12)))
				clearings.append([Vector2(p.x, p.z), 1.6])
			var hay := StaticBody3D.new()
			hay.name = "Hay%d" % count
			hay.collision_layer = LAYER_WORLD
			hay.add_to_group("track_obstacle", true)
			hay.set_meta("kind", "hay")
			hay.add_child(_mesh_node("Mesh", _commit(st)))
			for k in line.size() - 1:
				var cs := CollisionShape3D.new()
				cs.name = "Shape%d" % k
				var bs := BoxShape3D.new()
				var a := line[k]
				var b := line[k + 1]
				bs.size = Vector3(0.8, 0.6, a.distance_to(b) + 0.6)
				cs.shape = bs
				cs.transform = Transform3D(Basis.looking_at(b - a, Vector3.UP), (a + b) * 0.5 + Vector3(0, 0.3, 0))
				hay.add_child(cs)
			g.add_child(hay)
	print("chevrons: %d" % count)


## A knot of fans behind a tape line: one merged mesh per group, a solid
## (invisible) fence along the tape so nobody gets flattened.
func _spectators() -> void:
	var g := _group("Spectators")
	var jackets := [Color("e8731c"), Color("d8322a"), Color("2a6fd6"), Color("e8c21c"), Color("2e9e4f"), Color("f0ede4"), Color("7a3fb0")]
	var k := 0
	for spot in spectator_spots:
		var i: int = spot[0]
		var side: float = spot[1]
		var st := _st()
		var tape: Array[Vector3] = []
		var back := half_w[i] + verge_w[i] + ditch + (2.0 if side > 0 else 2.6)
		for j in range(-6, 7):
			var s := clampi(i + j, 0, n - 1)
			tape.append(_g(pts[s] + _right(s) * side * back))
		# Posts and tape: red and white, flat-ish so it reads from above.
		for j in tape.size():
			_box(st, Transform3D(Basis.IDENTITY, tape[j] + Vector3(0, 0.5, 0)), Vector3(0.07, 1.0, 0.07), C_TAPE_WHITE)
			if j < tape.size() - 1:
				var a := tape[j]
				var b := tape[j + 1]
				var segs := 3
				for q in segs:
					var m := a.lerp(b, (q + 0.5) / segs) + Vector3(0, 0.92, 0)
					_box(st, Transform3D(Basis.looking_at(b - a, Vector3.UP), m), Vector3(0.22, 0.04, a.distance_to(b) / segs), C_TAPE_RED if q % 2 == 0 else C_TAPE_WHITE)
		# People, facing the road.
		for q in 14:
			var s := clampi(i + rng.randi_range(-10, 10), 0, n - 1)
			var p := _g(pts[s] + _right(s) * side * (back + rng.randf_range(1.2, 4.5)))
			var look := Basis.looking_at(Vector3(pts[s].x - p.x, 0, pts[s].z - p.z), Vector3.UP).rotated(Vector3.UP, rng.randf_range(-0.4, 0.4))
			var jacket: Color = jackets[rng.randi() % jackets.size()]
			var h := rng.randf_range(0.9, 1.08)
			_box(st, Transform3D(look, p + Vector3(0, 0.42 * h, 0)), Vector3(0.38, 0.84 * h, 0.26), Color("2e3440"))
			_box(st, Transform3D(look, p + Vector3(0, 1.15 * h, 0)), Vector3(0.52, 0.66 * h, 0.32), jacket)
			_box(st, Transform3D(look, p + Vector3(0, 1.62 * h, 0)), Vector3(0.26, 0.28, 0.26), Color("e0b48e"))
			if rng.randf() < 0.5:
				_box(st, Transform3D(look, p + Vector3(0, 1.8 * h, 0)), Vector3(0.3, 0.08, 0.3), jacket.darkened(0.3))
		var group := StaticBody3D.new()
		group.name = "Fans%d" % k
		group.collision_layer = LAYER_WORLD
		group.add_to_group("track_obstacle", true)
		group.set_meta("kind", "spectators")
		group.add_child(_mesh_node("Mesh", _commit(st)))
		for j in tape.size() - 1:
			var cs := CollisionShape3D.new()
			cs.name = "Fence%d" % j
			var bs := BoxShape3D.new()
			bs.size = Vector3(0.3, 1.0, tape[j].distance_to(tape[j + 1]) + 0.3)
			cs.shape = bs
			cs.transform = Transform3D(Basis.looking_at(tape[j + 1] - tape[j], Vector3.UP), (tape[j] + tape[j + 1]) * 0.5 + Vector3(0, 0.5, 0))
			group.add_child(cs)
		for f in 2:
			var fp := _g(tape[2 + f * 8] + _right(i) * side * 2.0)
			group.add_child(_mesh_node("Flag%d" % f, meshes["flag_red" if f == 0 else "flag_green"], Transform3D(Basis(Vector3.UP, rng.randf() * TAU), fp)))
		g.add_child(group)
		var mid := pts[i] + _right(i) * side * (back + 3.0)
		clearings.append([Vector2(mid.x, mid.z), 15.0])
		k += 1
	print("spectator groups: %d" % k)
