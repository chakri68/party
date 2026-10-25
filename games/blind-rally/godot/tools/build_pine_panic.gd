extends SceneTree
## Generates scenes/tracks/pine_panic.scn: Pine Panic, the easy stage (spec §6).
## Deterministic. Run after tools/bake_assets.gd:
##   godot --headless --path . --script res://tools/build_pine_panic.gd
##
## A point-to-point gravel stage through pine forest: start arch, a wooden
## bridge over a stream, the ranger cabin, the sawmill, two hairpins with
## chevrons and hay, spectators at the good corners, finish arch, stop control.
## Trees wall the road and thin out with distance; they're baked into Scatter
## chunks (MultiMesh + colliders built on load). Saved binary because the
## forest data is a lot of numbers and nobody diffs them.

const OUT := "res://scenes/tracks/pine_panic.scn"
const MESH_DIR := "res://assets/meshes/"
const VC_MAT := "res://assets/materials/vertex_color.tres"

const ROAD_HALF_WIDTH := 3.0 ## 6 m of gravel: about 1.5 car lengths, 3 car widths
const SHOULDER := 0.7 ## loose verge either side; still "road" to the surface probe
const DITCH := 1.4 ## dark strip past the verge, before the trees
const STEP := 2.0 ## metres between centreline samples
const CHUNK := 96.0 ## forest chunk size; one MultiMesh per mesh per chunk
const SEED := 11

## Route control points (x, z), start to finish, before SCALE.
const SCALE := 1.4
const CONTROL := [
	Vector2(-330, 250), Vector2(-290, 252), Vector2(-235, 238), Vector2(-190, 250),
	Vector2(-150, 232), Vector2(-128, 190), Vector2(-140, 140), Vector2(-112, 98),
	Vector2(-60, 92), Vector2(-20, 120), Vector2(30, 128), Vector2(64, 124),
	Vector2(78, 104), Vector2(78, 48), Vector2(48, 10), Vector2(-5, -5),
	Vector2(-50, -30), Vector2(-62, -86), Vector2(-56, -112), Vector2(-30, -120),
	Vector2(25, -112), Vector2(70, -140), Vector2(85, -190), Vector2(130, -225),
	Vector2(190, -215), Vector2(225, -175), Vector2(246, -108), Vector2(258, -96),
	Vector2(300, -100), Vector2(330, -60), Vector2(320, -5), Vector2(282, 30),
	Vector2(266, 42), Vector2(270, 85), Vector2(300, 130), Vector2(345, 150),
]
const CP_FRACTIONS := [0.17, 0.34, 0.5, 0.67, 0.84]
const BRIDGE_AT := 0.27
const CABIN_AT := 0.55
const SAWMILL_AT := 0.72

const LAYER_WORLD := 1
const LAYER_CAR := 2
const LAYER_TRIGGER := 4
const LAYER_SURFACE := 8
const RENDER_WORLD := 1
const RENDER_MAP_ONLY := 4

## Palette (sRGB), shared with tools/bake_assets.gd's remap.
const C_CROWN := Color("9a8360")
const C_TRACK := Color("8c7552")
const C_RUT := Color("6f5b40")
const C_VERGE := Color("a99373")
const C_DITCH := Color("3f3a2b")
const C_FLOOR_A := Color("4d4130")
const C_FLOOR_B := Color("3b4a2b")
const C_GRASS := Color("5d6a37")
const C_YARD := Color("6e6046")
const C_WATER := Color("2f5966")
const C_WATER_EDGE := Color("4a6e62")
const C_LOG := Color("6e4b30")
const C_LOG_DARK := Color("4f3522")
const C_PLANK := Color("8a6a46")
const C_PLANK_DARK := Color("6d5236")
const C_ROOF_RED := Color("86302a")
const C_ROOF_TIN := Color("6c7680")
const C_WALL := Color("b9a98a")
const C_STRAW := Color("d6b65e")
const C_BOARD := Color("1e1e1e")
const C_CHEVRON := Color("f2f2ea")
const C_TAPE_RED := Color("d8322a")
const C_TAPE_WHITE := Color("f0ede4")
const C_SAW := Color("b9c0c6")

var track: Track
var pts: PackedVector3Array
var tans: PackedVector3Array
var n := 0
var rng := RandomNumberGenerator.new()
var noise := FastNoiseLite.new()
var vc_mat: Material
var map_mat: StandardMaterial3D
var meshes := {}
var _hash := {} # Vector2i -> PackedInt32Array of sample indices
const HASH_CELL := 16.0

## Places trees keep away from: [Vector2 centre, radius].
var clearings: Array = []
## Ground tints: [Vector2 centre, radius, Color].
var yards: Array = []
var stream: PackedVector3Array
var _stream_rect := Rect2()
var corners: Array = [] # [apex sample, min radius, turn sign]
var spectator_spots: Array = [] # [sample, side]


func _init() -> void:
	rng.seed = SEED
	noise.seed = SEED
	noise.frequency = 0.02
	vc_mat = load(VC_MAT)
	map_mat = StandardMaterial3D.new()
	map_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	map_mat.vertex_color_use_as_albedo = true
	map_mat.vertex_color_is_srgb = true
	for id in ["pine_tall", "pine_default", "pine_round", "pine_small", "log", "log_large", "log_stack",
			"rock_a", "rock_c", "rock_small", "rock_tall", "stump", "bush", "bush_small", "grass",
			"campfire", "arch", "flag_red", "flag_green", "tent", "cone"]:
		meshes[id] = load(MESH_DIR + id + ".res")

	_sample_centerline()
	_build_hash()
	track = Track.new()
	track.name = "PinePanic"
	track.track_id = "pine_panic"
	track.display_name = "Pine Panic"
	track.difficulty = "easy"
	track.centerline = pts
	track.length_m = (n - 1) * STEP
	var bb := _road_bounds().grow(30.0)
	track.bounds = bb

	_find_corners()
	_plan()
	_env()
	_road()
	_stream_and_bridge()
	_world_walls(bb)
	_markers()
	_arches()
	_service_and_stop()
	_corner_furniture()
	_cabin()
	_sawmill()
	_spectators()
	_roadside()
	_ground(bb) # after everything that tints a yard
	_index_clearings()
	_build_dist_grid(bb.grow(60.0))
	_forest(bb)
	_map_overlay()

	_own(track)
	var ps := PackedScene.new()
	var err := ps.pack(track)
	assert(err == OK)
	err = ResourceSaver.save(ps, OUT, ResourceSaver.FLAG_COMPRESS)
	print("saved %s (err %d): %d samples, %.0f m, bounds %s, %d corners" % [OUT, err, n, track.length_m, bb, corners.size()])
	track.free()
	quit(0 if err == OK else 1)


# --- centreline ---------------------------------------------------------------

func _catmull(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)


func _sample_centerline() -> void:
	var c: Array[Vector2] = []
	for p in CONTROL:
		c.append(p * SCALE)
	# Open spline: mirror a phantom point past each end.
	c.push_front(c[0] * 2.0 - c[1])
	c.append(c[c.size() - 1] * 2.0 - c[c.size() - 2])
	var dense: Array[Vector2] = []
	for i in range(1, c.size() - 2):
		for k in 60:
			dense.append(_catmull(c[i - 1], c[i], c[i + 1], c[i + 2], k / 60.0))
	dense.append(c[c.size() - 2])
	# Resample at uniform arc length so samples double as distance markers.
	var acc := 0.0
	var target := 0.0
	for i in dense.size() - 1:
		var a := dense[i]
		var b := dense[i + 1]
		var seg := a.distance_to(b)
		while target <= acc + seg:
			var p := a.lerp(b, (target - acc) / seg)
			pts.append(Vector3(p.x, 0.0, p.y))
			target += STEP
		acc += seg
	n = pts.size()
	for i in n:
		tans.append((pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]).normalized())


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


func _stream_dist(x: float, z: float) -> float:
	if not _stream_rect.has_point(Vector2(x, z)):
		return INF
	var best := INF
	for p in stream:
		best = minf(best, Vector2(x - p.x, z - p.z).length())
	return best


func _clear(x: float, z: float, pad := 0.0) -> bool:
	var list: Array = clearings
	if not _clear_index.is_empty():
		list = _clear_index.get(Vector2i(floori(x / 32.0), floori(z / 32.0)), [])
	for c in list:
		if Vector2(x, z).distance_to(c[0]) < c[1] + pad:
			return false
	return true


var _clear_index := {}


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


var _dg := PackedFloat32Array()
var _dg_rect := Rect2()
var _dg_w := 0
var _dg_h := 0
const DG_CELL := 2.0


## Approximate distance-to-road field (two-pass chamfer), for the far forest
## where exact distances don't matter. Near the road _road_dist is exact.
func _build_dist_grid(rect: Rect2) -> void:
	_dg_rect = rect
	_dg_w = int(ceil(rect.size.x / DG_CELL)) + 1
	_dg_h = int(ceil(rect.size.y / DG_CELL)) + 1
	_dg.resize(_dg_w * _dg_h)
	_dg.fill(1e6)
	for p in pts:
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


func _plan() -> void:
	# Spectators where it's worth watching: the two tightest corners, outside.
	var by_radius := corners.duplicate()
	by_radius.sort_custom(func(a: Array, b: Array) -> bool: return a[1] < b[1])
	for c in by_radius.slice(0, 2):
		spectator_spots.append([c[0], -c[2]]) # outside = opposite the turn
	# And one fast kink midway, inside, set well back.
	spectator_spots.append([int(0.42 * n), 1.0])


# --- mesh helpers --------------------------------------------------------------

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


# --- world ---------------------------------------------------------------------

func _env() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	# Low, warm, from the south-west: long tree shadows across the road.
	sun.rotation_degrees = Vector3(-48, -140, 0)
	sun.light_color = Color(1.0, 0.94, 0.84)
	sun.light_energy = 1.25
	# main.gd turns these off on phones; desktop gets cheap orthogonal ones.
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 110.0
	sun.shadow_opacity = 0.7
	sun.shadow_blur = 1.5
	track.add_child(sun)
	var we := WorldEnvironment.new()
	we.name = "Environment"
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("2c3a2c")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.62, 0.68, 0.74)
	env.ambient_light_energy = 0.62
	we.environment = env
	track.add_child(we)


func _ground_col(x: float, z: float, d_road: float) -> Color:
	var k := noise.get_noise_2d(x, z) * 0.5 + 0.5
	var c := C_FLOOR_A.lerp(C_FLOOR_B, k)
	c = c.darkened(clampf(noise.get_noise_2d(x * 3.1 + 500, z * 3.1) * 0.15, -0.08, 0.15))
	# Lighter grassy verge right by the road, where light gets in.
	c = c.lerp(C_GRASS, clampf(1.0 - (d_road - 5.0) / 6.0, 0.0, 1.0) * 0.8)
	for y in yards:
		var dy: float = Vector2(x, z).distance_to(y[0])
		c = c.lerp(y[2], clampf((y[1] - dy) / 8.0, 0.0, 1.0))
	return c


func _ground(bb: Rect2) -> void:
	var body := StaticBody3D.new()
	body.name = "Ground"
	body.collision_layer = LAYER_WORLD
	body.set_meta("surface", "offroad")
	var area := bb.grow(70.0)
	const CELL := 8.0
	var nx := int(ceil(area.size.x / CELL))
	var nz := int(ceil(area.size.y / CELL))
	var st := _st()
	var verts: Array[Vector3] = []
	var cols: Array[Color] = []
	for r in nz + 1:
		for c in nx + 1:
			var x := area.position.x + c * CELL
			var z := area.end.y - r * CELL # rows run north, so winding faces up
			verts.append(Vector3(x, 0, z))
			cols.append(_ground_col(x, z, _road_dist(x, z, 16.0)))
	for r in nz:
		for c in nx:
			var a := r * (nx + 1) + c
			var b := a + 1
			var cc := a + nx + 1
			var d := cc + 1
			for i in [a, cc, b, b, cc, d]:
				st.set_color(cols[i])
				st.set_normal(Vector3.UP)
				st.add_vertex(verts[i])
	st.index()
	body.add_child(_mesh_node("Mesh", _commit(st)))
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var bs := BoxShape3D.new()
	bs.size = Vector3(area.size.x, 2, area.size.y)
	cs.shape = bs
	cs.position = Vector3(area.get_center().x, -1, area.get_center().y)
	body.add_child(cs)
	track.add_child(body)
	print("ground: %d x %d cells" % [nx, nz])


## Road = visual strip (ditch, verge, wheel ruts, crown, all vertex colour) + a
## probe-only trimesh on the surfaces layer. The car drives on the flat
## ground; its downward ray reads the surface type from the probe, so there's
## no lip at the road edge to snag on.
func _road() -> void:
	var h := ROAD_HALF_WIDTH
	var prof := [
		[-(h + SHOULDER + DITCH), C_GRASS], [-(h + SHOULDER + 0.5), C_DITCH], [-(h + SHOULDER), C_DITCH.lerp(C_VERGE, 0.4)],
		[-h, C_VERGE], [-1.9, C_TRACK], [-1.25, C_RUT], [-0.5, C_CROWN],
		[0.5, C_CROWN], [1.25, C_RUT], [1.9, C_TRACK], [h, C_VERGE],
		[h + SHOULDER, C_DITCH.lerp(C_VERGE, 0.4)], [h + SHOULDER + 0.5, C_DITCH], [h + SHOULDER + DITCH, C_GRASS],
	]
	var st := _st()
	var lift := Vector3(0, 0.03, 0)
	var rows: Array = []
	for i in n:
		var row: Array = []
		var shade := 1.0 + noise.get_noise_2d(pts[i].x * 2.0, pts[i].z * 2.0) * 0.12
		for p in prof:
			# Per-vertex mottle on top of the slow noise: loose gravel isn't a smooth band.
			var c: Color = (p[1] as Color).darkened(rng.randf_range(-0.05, 0.09))
			row.append([pts[i] + _right(i) * float(p[0]) + lift, Color(c.r * shade, c.g * shade, c.b * shade)])
		rows.append(row)
	for i in n - 1:
		for j in prof.size() - 1:
			var a: Array = rows[i][j]
			var b: Array = rows[i][j + 1]
			var c: Array = rows[i + 1][j]
			var d: Array = rows[i + 1][j + 1]
			for v in [a, c, b, b, c, d]:
				st.set_color(v[1])
				st.set_normal(Vector3.UP)
				st.add_vertex(v[0])
	st.index()
	var body := StaticBody3D.new()
	body.name = "Road"
	body.add_to_group("track_road", true)
	body.set_meta("surface", "road")
	body.collision_layer = LAYER_SURFACE
	body.collision_mask = 0
	var mi := _mesh_node("Mesh", _commit(st))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(mi)
	# Probe covers road and verge, not the ditch.
	var faces := PackedVector3Array()
	var w := h + SHOULDER
	for i in n - 1:
		var a := pts[i] - _right(i) * w
		var b := pts[i] + _right(i) * w
		var c := pts[i + 1] - _right(i + 1) * w
		var d := pts[i + 1] + _right(i + 1) * w
		faces.append_array([a, c, b, b, c, d])
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
		[Vector3(c.x, 2, c.y - e.y), Vector3(e.x * 2, 4, 1)],
		[Vector3(c.x, 2, c.y + e.y), Vector3(e.x * 2, 4, 1)],
		[Vector3(c.x - e.x, 2, c.y), Vector3(1, 4, e.y * 2)],
		[Vector3(c.x + e.x, 2, c.y), Vector3(1, 4, e.y * 2)],
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


# --- markers -------------------------------------------------------------------

func _gate(name: String, i: int) -> Area3D:
	var area := Area3D.new()
	area.name = name
	area.transform = _xf_at(i, 1.5)
	area.collision_layer = LAYER_TRIGGER
	area.collision_mask = LAYER_CAR
	area.monitorable = false
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var bs := BoxShape3D.new()
	bs.size = Vector3(ROAD_HALF_WIDTH * 2 + 8, 3, 2)
	cs.shape = bs
	area.add_child(cs)
	return area


var spawn_i := 0
var finish_i := 0


func _markers() -> void:
	var markers := _group("Markers")
	spawn_i = int(24.0 / STEP)
	finish_i = n - 1 - int(70.0 / STEP)

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

	var fin := _gate("Finish", finish_i)
	fin.add_to_group("track_finish", true)
	fin.set_meta("distance_m", finish_i * STEP)
	markers.add_child(fin)

	for k in CP_FRACTIONS.size():
		var i := int(CP_FRACTIONS[k] * n)
		var cp := _gate("CP%d" % (k + 1), i)
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
		var w := ROAD_HALF_WIDTH * 2 + SHOULDER * 2
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


## Service park behind the start (a meadow: the off-road test drives here) and
## stop control past the finish, where the road ends in a clearing.
func _service_and_stop() -> void:
	var g := _group("ServiceAndStop")
	# The meadow sits beside the start, on the side away from the map edge.
	var r0 := _right(spawn_i)
	var side := 1.0 if (pts[spawn_i] + r0 * 48.0).z < (pts[spawn_i] - r0 * 48.0).z else -1.0
	var meadow := pts[spawn_i] + r0 * side * 48.0
	clearings.append([Vector2(meadow.x, meadow.z), 42.0])
	yards.append([Vector2(meadow.x, meadow.z), 38.0, C_GRASS.lightened(0.05)])
	var end := pts[n - 1] + tans[n - 1] * 10.0
	clearings.append([Vector2(end.x, end.z), 22.0])
	yards.append([Vector2(end.x, end.z), 18.0, C_YARD])
	# Service tents along the meadow's road edge; the middle stays open.
	for k in 3:
		var p := pts[spawn_i] + r0 * side * 14.0 + tans[spawn_i] * (k * 7.0 - 12.0)
		var tent := _solid("Tent%d" % k, "tent", Transform3D(Basis.looking_at(tans[spawn_i], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)
	for k in 6:
		var p := pts[0] + _right(0) * (k * 1.4 - 3.5) + Vector3(0, 0, 0)
		g.add_child(_mesh_node("Cone%d" % k, meshes["cone"], Transform3D(Basis.IDENTITY, p)))
	for k in 2:
		var p := end + _right(n - 1) * (k * 9.0 - 6.0) + tans[n - 1] * 8.0
		var tent := _solid("StopTent%d" % k, "tent", Transform3D(Basis.looking_at(tans[n - 1], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)


# --- stream and bridge -----------------------------------------------------------

func _straightest_near(at: float, span: int) -> int:
	var best := INF
	var bi := int(at * n)
	for i in range(int(at * n) - span, int(at * n) + span):
		var t := absf(_turn(i, 10))
		if t < best:
			best = t
			bi = i
	return bi


func _stream_and_bridge() -> void:
	var bi := _straightest_near(BRIDGE_AT, 40)
	var c := pts[bi]
	var across := _right(bi)
	# Meander away from the bridge on both sides; stop where it nears the road again.
	var left: Array[Vector3] = []
	var right_side: Array[Vector3] = []
	for dir in [-1.0, 1.0]:
		var p := c
		var heading: Vector3 = across * dir
		var out: Array[Vector3] = left if dir < 0 else right_side
		for k in 70:
			heading = heading.rotated(Vector3.UP, sin(k * 0.35 + dir) * 0.18)
			p += heading * 4.0
			if k > 4 and _road_dist(p.x, p.z, 30.0) < 22.0:
				break
			out.append(p)
	left.reverse()
	for p in left:
		stream.append(p)
	stream.append(c)
	for p in right_side:
		stream.append(p)
	_stream_rect = Rect2(Vector2(stream[0].x, stream[0].z), Vector2.ZERO)
	for p in stream:
		_stream_rect = _stream_rect.expand(Vector2(p.x, p.z))
	_stream_rect = _stream_rect.grow(8.0)
	# Water ribbon, banks lighter.
	var st := _st()
	var prof := [[-3.6, C_WATER_EDGE], [-2.2, C_WATER], [2.2, C_WATER], [3.6, C_WATER_EDGE]]
	for i in stream.size() - 1:
		var t := (stream[i + 1] - stream[i]).normalized()
		var t0 := (stream[mini(i + 1, stream.size() - 1)] - stream[maxi(i - 1, 0)]).normalized()
		var t1 := (stream[mini(i + 2, stream.size() - 1)] - stream[i]).normalized()
		var r0 := Vector3(-t0.z, 0, t0.x)
		var r1 := Vector3(-t1.z, 0, t1.x)
		for j in prof.size() - 1:
			var a := stream[i] + r0 * float(prof[j][0]) + Vector3(0, 0.02, 0)
			var b := stream[i] + r0 * float(prof[j + 1][0]) + Vector3(0, 0.02, 0)
			var cc := stream[i + 1] + r1 * float(prof[j][0]) + Vector3(0, 0.02, 0)
			var d := stream[i + 1] + r1 * float(prof[j + 1][0]) + Vector3(0, 0.02, 0)
			var verts := [[a, prof[j][1]], [cc, prof[j][1]], [b, prof[j + 1][1]], [b, prof[j + 1][1]], [cc, prof[j][1]], [d, prof[j + 1][1]]]
			for v in verts:
				st.set_color(v[1])
				st.set_normal(Vector3.UP)
				st.add_vertex(v[0])
	var water := _mesh_node("Stream", _commit(st))
	water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	track.add_child(water)

	# The bridge: plank deck across the stream, rails both sides you can hit.
	var bridge := StaticBody3D.new()
	bridge.name = "WoodenBridge"
	bridge.collision_layer = LAYER_WORLD
	bridge.add_to_group("track_landmark", true)
	bridge.add_to_group("track_obstacle", true)
	bridge.set_meta("label", "wooden bridge")
	bridge.set_meta("kind", "landmark")
	bridge.transform = _xf_at(bi)
	var bst := _st()
	const LEN := 12.0
	var half := ROAD_HALF_WIDTH + 1.4
	var planks := int(LEN / 0.5)
	for k in planks:
		var z := -LEN * 0.5 + 0.25 + k * 0.5
		_box(bst, Transform3D(Basis.IDENTITY, Vector3(0, 0.09, z)), Vector3(half * 2.0, 0.08, 0.46), C_PLANK if k % 2 == 0 else C_PLANK_DARK)
	for side in [-1.0, 1.0]:
		_box(bst, Transform3D(Basis.IDENTITY, Vector3(side * half, 0.15, 0)), Vector3(0.35, 0.3, LEN + 0.4), C_LOG_DARK)
		for k in 7:
			_box(bst, Transform3D(Basis.IDENTITY, Vector3(side * half, 0.6, -LEN * 0.5 + k * LEN / 6.0)), Vector3(0.22, 1.2, 0.22), C_LOG)
		_box(bst, Transform3D(Basis.IDENTITY, Vector3(side * half, 1.15, 0)), Vector3(0.18, 0.16, LEN), C_LOG)
		_box(bst, Transform3D(Basis.IDENTITY, Vector3(side * half, 0.7, 0)), Vector3(0.12, 0.12, LEN), C_LOG_DARK)
		var cs := CollisionShape3D.new()
		cs.name = "Rail%s" % ("L" if side < 0 else "R")
		var bs := BoxShape3D.new()
		bs.size = Vector3(0.4, 1.3, LEN)
		cs.shape = bs
		cs.position = Vector3(side * (half + 0.05), 0.65, 0)
		bridge.add_child(cs)
	bridge.add_child(_mesh_node("Mesh", _commit(bst)))
	track.add_child(bridge)
	clearings.append([Vector2(c.x, c.z), 12.0])
	# Rocks along the banks near the crossing.
	var g := _group("StreamRocks")
	for k in 10:
		var i := clampi(stream.size() / 2 + (k - 5) * 3 + (1 if k >= 5 else -1) * 2, 0, stream.size() - 1)
		var t := (stream[mini(i + 1, stream.size() - 1)] - stream[maxi(i - 1, 0)]).normalized()
		var p := stream[i] + Vector3(-t.z, 0, t.x) * (3.4 if k % 2 == 0 else -3.4)
		if _road_dist(p.x, p.z) < 6.0:
			continue
		g.add_child(_mesh_node("Rock%d" % k, meshes["rock_c" if k % 3 == 0 else "rock_small"], Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(0.5, 1.0)), p)))
	print("bridge at %.0f m, stream %d points" % [bi * STEP, stream.size()])


# --- corners -------------------------------------------------------------------

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
			var p := pts[i] + o * (ROAD_HALF_WIDTH + SHOULDER + DITCH + 0.6)
			var facing := Basis.looking_at(-tans[maxi(apex - 14, 0)], Vector3.UP)
			g.add_child(_mesh_node("Chevron%d" % count, right_board if right_turn else left_board, Transform3D(facing, p)))
			clearings.append([Vector2(p.x, p.z), 1.8])
			count += 1
		# Tight ones get a line of hay on the outside of the apex.
		if c[1] < 22.0:
			var st := _st()
			var line: Array[Vector3] = []
			for k in 7:
				var i := clampi(apex - 6 + k * 2, 0, n - 1)
				var o := _right(i) * (-1.0 if right_turn else 1.0)
				var p := pts[i] + o * (ROAD_HALF_WIDTH + SHOULDER + 0.9)
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


# --- roadside ------------------------------------------------------------------

## Logs, rocks and stumps just past the ditch: things to clip, and to call.
func _roadside() -> void:
	var g := _group("Roadside")
	var i := 30
	var count := 0
	while i < n - 40:
		i += rng.randi_range(12, 26)
		var side := -1.0 if rng.randf() < 0.5 else 1.0
		var d := ROAD_HALF_WIDTH + SHOULDER + DITCH + rng.randf_range(0.2, 1.4)
		var p := pts[i] + _right(i) * side * d
		if not _clear(p.x, p.z, 1.0) or _stream_dist(p.x, p.z) < 6.0:
			continue
		var pick := rng.randf()
		var body: StaticBody3D
		if pick < 0.45:
			# Lying along the road, a little skewed.
			var yaw := Basis.looking_at(tans[i], Vector3.UP).get_euler().y + rng.randf_range(-0.3, 0.3)
			var long := rng.randf() < 0.3
			var mesh: Mesh = meshes["log_large" if long else "log"]
			var size := Vector3(1.0, 0.85, 3.4) if not long else Vector3(3.3, 1.4, 1.8)
			body = _solid("Log%d" % count, "log", Transform3D(Basis(Vector3.UP, yaw), p), size)
			body.add_child(_mesh_node("Mesh", mesh))
		elif pick < 0.8:
			var s := rng.randf_range(0.6, 1.1)
			var mesh_id: String = ["rock_a", "rock_c", "rock_tall"][rng.randi() % 3]
			var aabb: AABB = (meshes[mesh_id] as Mesh).get_aabb()
			body = _solid("Rock%d" % count, "rock", Transform3D(Basis(Vector3.UP, rng.randf() * TAU), p), aabb.size * s * Vector3(0.8, 1, 0.8), (aabb.get_center() * s) * Vector3(1, 0, 1))
			body.add_child(_mesh_node("Mesh", meshes[mesh_id], Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * s), Vector3.ZERO)))
		else:
			body = _solid("Stump%d" % count, "stump", Transform3D(Basis(Vector3.UP, rng.randf() * TAU), p), Vector3(0.9, 0.8, 0.9))
			body.add_child(_mesh_node("Mesh", meshes["stump"]))
		g.add_child(body)
		clearings.append([Vector2(p.x, p.z), 2.2])
		count += 1
	print("roadside props: %d" % count)


# --- landmarks -------------------------------------------------------------------

func _landmarks() -> Node3D:
	return track.get_node("Landmarks") if track.has_node("Landmarks") else _group("Landmarks")


func _side_spot(at: float, offset: float) -> Array:
	var i := int(at * n)
	var side := -1.0 if _turn(i, 10) < 0 else 1.0 # outside of any bend, where there's room
	var p := pts[i] + _right(i) * side * offset
	return [i, side, p]


## Ranger cabin: log walls, red roof, chimney, woodpile. In its own clearing.
func _cabin() -> void:
	var spot := _side_spot(CABIN_AT, 17.0)
	var i: int = spot[0]
	var p: Vector3 = spot[2]
	var face := (pts[i] - p).normalized() # front faces the road
	var body := _solid("RangerCabin", "landmark", Transform3D(Basis.looking_at(-face, Vector3.UP), p), Vector3(7.4, 3.2, 5.8))
	body.add_to_group("track_landmark", true)
	body.set_meta("label", "ranger cabin")
	var st := _st()
	for k in 8:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.2 + k * 0.4, 0)), Vector3(7.2 + (0.3 if k % 2 == 0 else 0.0), 0.4, 5.6 + (0.0 if k % 2 == 0 else 0.3)), C_LOG if k % 2 == 0 else C_LOG_DARK)
	var roof := PrismMesh.new()
	roof.size = Vector3(6.8, 2.4, 8.4) # rotated: ridge runs along the long walls
	_prim(st, roof, Transform3D(Basis(Vector3.UP, PI * 0.5), Vector3(0, 4.4, 0)), C_ROOF_RED)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(2.2, 4.6, 1.2)), Vector3(0.8, 2.6, 0.8), Color("6b6660"))
	_box(st, Transform3D(Basis.IDENTITY, Vector3(-0.8, 1.1, 2.86)), Vector3(1.2, 2.2, 0.1), C_PLANK_DARK) # door
	for x in [-2.6, 1.6]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, 1.7, 2.86)), Vector3(1.2, 0.9, 0.1), Color("cfd8c8"))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	body.add_child(_mesh_node("Woodpile", meshes["log_stack"], Transform3D(Basis(Vector3.UP, PI * 0.5), Vector3(5.2, 0, 0.5))))
	body.add_child(_mesh_node("Campfire", meshes["campfire"], Transform3D(Basis.IDENTITY, Vector3(-1.5, 0, 6.5))))
	var sign_label := Label3D.new()
	sign_label.name = "Sign"
	sign_label.text = "RANGER STATION"
	sign_label.font_size = 64
	sign_label.pixel_size = 0.012
	sign_label.outline_size = 10
	sign_label.modulate = Color("f2e6c8")
	sign_label.outline_modulate = Color("2a1e14")
	sign_label.transform = Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-35)), Vector3(0, 3.6, 3.0))
	body.add_child(sign_label)
	_landmarks().add_child(body)
	clearings.append([Vector2(p.x, p.z), 14.0])
	yards.append([Vector2(p.x, p.z), 11.0, C_YARD.lerp(C_GRASS, 0.4)])
	print("cabin at %.0f m, %.1f m off the road" % [i * STEP, _road_dist(p.x, p.z)])


## Sawmill: the big shed (11 m deep along its local Z), an open saw bay with
## the blade, log piles and a sawdust heap. Biggest thing on the map.
func _sawmill() -> void:
	var spot := _side_spot(SAWMILL_AT, 30.0)
	var i: int = spot[0]
	var p: Vector3 = spot[2]
	var face := (pts[i] - p).normalized()
	var basis := Basis.looking_at(-face, Vector3.UP) # +Z faces the road
	var body := _solid("Sawmill", "landmark", Transform3D(basis, p), Vector3(14, 6, 11))
	body.add_to_group("track_landmark", true)
	body.set_meta("label", "sawmill")
	var st := _st()
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 3, 0)), Vector3(14, 6, 11), C_WALL)
	for k in 7:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(-6 + k * 2, 3, 5.52)), Vector3(0.15, 6, 0.06), C_PLANK_DARK)
	var roof := PrismMesh.new()
	roof.size = Vector3(15, 3, 12)
	_prim(st, roof, Transform3D(Basis(Vector3.UP, 0), Vector3(0, 7.5, 0)), C_ROOF_TIN)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 2.0, 5.53)), Vector3(4, 4, 0.08), Color("3a3430")) # big door
	# Saw bay: a roof on posts beside the shed, the blade under it.
	for x in [8.0, 15.0]:
		for z in [-3.5, 3.5]:
			_box(st, Transform3D(Basis.IDENTITY, Vector3(x, 2.2, z)), Vector3(0.3, 4.4, 0.3), C_LOG_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(11.5, 4.5, 0)), Vector3(8.5, 0.25, 8.5), C_ROOF_TIN.darkened(0.15))
	_box(st, Transform3D(Basis.IDENTITY, Vector3(11.5, 0.6, 0)), Vector3(6.5, 1.2, 1.4), C_PLANK_DARK) # carriage
	var blade := CylinderMesh.new()
	blade.top_radius = 1.3
	blade.bottom_radius = 1.3
	blade.height = 0.08
	blade.radial_segments = 16
	_prim(st, blade, Transform3D(Basis(Vector3.RIGHT, PI * 0.5), Vector3(11.5, 1.8, 0)), C_SAW)
	var heap := CylinderMesh.new()
	heap.top_radius = 0.2
	heap.bottom_radius = 3.2
	heap.height = 2.2
	heap.radial_segments = 10
	_prim(st, heap, Transform3D(Basis.IDENTITY, Vector3(-11, 1.1, 6)), Color("d9b98a"))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	var bay := CollisionShape3D.new()
	bay.name = "BayShape"
	var bs := BoxShape3D.new()
	bs.size = Vector3(6.5, 1.4, 1.4)
	bay.shape = bs
	bay.position = Vector3(11.5, 0.7, 0)
	body.add_child(bay)
	for k in 4:
		var lp := Vector3(-9.5 + k * 3.8, 0, -9.5)
		body.add_child(_mesh_node("Logs%d" % k, meshes["log_stack"], Transform3D(Basis(Vector3.UP, PI * 0.5), lp)))
		var lc := CollisionShape3D.new()
		lc.name = "LogsShape%d" % k
		var lb := BoxShape3D.new()
		lb.size = Vector3(3.6, 1.7, 3.2)
		lc.shape = lb
		lc.position = lp + Vector3(0, 0.85, 0)
		body.add_child(lc)
	for k in 3:
		body.add_child(_mesh_node("Trunk%d" % k, meshes["log_large"], Transform3D(Basis(Vector3.UP, 0.2 * k), Vector3(12 + k * 0.4, 0, -8 + k * 2.0))))
	_landmarks().add_child(body)
	clearings.append([Vector2(p.x, p.z), 32.0])
	yards.append([Vector2(p.x, p.z), 22.0, C_YARD])
	print("sawmill at %.0f m, %.1f m off the road" % [i * STEP, _road_dist(p.x, p.z)])


# --- spectators ------------------------------------------------------------------

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
		var back := ROAD_HALF_WIDTH + SHOULDER + DITCH + (2.0 if side > 0 else 2.6)
		for j in range(-6, 7):
			var s := clampi(i + j, 0, n - 1)
			tape.append(pts[s] + _right(s) * side * back)
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
			var p := pts[s] + _right(s) * side * (back + rng.randf_range(1.2, 4.5))
			var look := Basis.looking_at(pts[s] - p, Vector3.UP).rotated(Vector3.UP, rng.randf_range(-0.4, 0.4))
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
			var fp := tape[2 + f * 8] + _right(i) * side * 2.0
			group.add_child(_mesh_node("Flag%d" % f, meshes["flag_red" if f == 0 else "flag_green"], Transform3D(Basis(Vector3.UP, rng.randf() * TAU), fp)))
		g.add_child(group)
		var mid := pts[i] + _right(i) * side * (back + 3.0)
		clearings.append([Vector2(mid.x, mid.z), 15.0])
		k += 1
	print("spectator groups: %d" % k)


# --- forest ----------------------------------------------------------------------

const TREE_IDS := ["pine_tall", "pine_default", "pine_round", "pine_small"]
const TREE_RADII := [0.4, 0.5, 0.5, 0.35]
const FLOOR_IDS := ["bush", "bush_small", "rock_a", "stump", "grass"]
const FLOOR_RADII := [0.0, 0.0, 1.0, 0.4, 0.0]


## Trees wall the road and thin out with distance. Jittered grid, so spacing
## stays even without a Poisson pass.
func _forest(bb: Rect2) -> void:
	var area := bb.grow(50.0)
	var chunks := {} # Vector2i -> {mesh_id: PackedFloat32Array}
	var counts := {}
	var edge := ROAD_HALF_WIDTH + SHOULDER + DITCH + 0.4
	const CELL := 2.7
	var x := area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, CELL)
			var pz := z + rng.randf_range(0.0, CELL)
			z += CELL
			var d := _fast_dist(px, pz)
			var p := 0.0
			if d < edge:
				continue
			elif d < 12.0:
				p = 0.86
			elif d < 30.0:
				p = 0.55
			elif d < 60.0:
				p = 0.3
			else:
				p = 0.17
			# Patchy, not uniform: noise opens glades in the far forest.
			p *= clampf(0.75 + noise.get_noise_2d(px * 0.6, pz * 0.6) * 0.9, 0.25, 1.15) if d > 14.0 else 1.0
			if rng.randf() > p:
				continue
			if not _clear(px, pz) or _stream_dist(px, pz) < 4.5:
				continue
			var w := rng.randf()
			var id: String = "pine_tall" if w < 0.38 else ("pine_default" if w < 0.68 else ("pine_round" if w < 0.88 else "pine_small"))
			var s := rng.randf_range(0.8, 1.25)
			if d < 9.0 and rng.randf() < 0.35:
				id = "pine_small"
			_add(chunks, counts, id, px, pz, rng.randf() * TAU, s)
		x += CELL
	# Forest floor: bushes, rocks and stumps between the trees; grass tufts in the ditch.
	x = area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, 4.0)
			var pz := z + rng.randf_range(0.0, 4.0)
			z += 4.0
			var d := _fast_dist(px, pz)
			if not _clear(px, pz) or _stream_dist(px, pz) < 3.8:
				continue
			if d < ROAD_HALF_WIDTH + SHOULDER + 0.3:
				continue
			if d < edge + 0.6:
				if rng.randf() < 0.55:
					_add(chunks, counts, "grass", px, pz, rng.randf() * TAU, rng.randf_range(0.6, 1.0))
				continue
			var r := rng.randf()
			if r < 0.18:
				if d < 30.0:
					_add(chunks, counts, "bush" if r < 0.1 else "bush_small", px, pz, rng.randf() * TAU, rng.randf_range(0.7, 1.2))
			elif r < 0.2:
				_add(chunks, counts, "rock_a", px, pz, rng.randf() * TAU, rng.randf_range(0.4, 0.9))
			elif r < 0.215:
				_add(chunks, counts, "stump", px, pz, rng.randf() * TAU, rng.randf_range(0.8, 1.2))
		x += CELL * 1.48
	var g := _group("Forest")
	var keys := chunks.keys()
	keys.sort()
	for key in keys:
		var by_id: Dictionary = chunks[key]
		for kind in ["trees", "floor"]:
			var ids: Array = TREE_IDS if kind == "trees" else FLOOR_IDS
			var radii: Array = TREE_RADII if kind == "trees" else FLOOR_RADII
			var sc := Scatter.new()
			sc.name = "%s_%d_%d" % [kind.capitalize(), key.x, key.y]
			sc.collision_layer = LAYER_WORLD
			sc.collision_mask = 0
			sc.add_to_group("track_obstacle", true)
			sc.set_meta("kind", "tree" if kind == "trees" else "floor")
			# Tall trunks: the car only meets the bottom, the x-ray probe needs the canopy.
			sc.collider_height = 12.0 if kind == "trees" else 1.2
			sc.tint_jitter = 0.12 if kind == "trees" else 0.08
			sc.cast_shadows = kind == "trees"
			var any := false
			for m in ids.size():
				var data: PackedFloat32Array = by_id.get(ids[m], PackedFloat32Array())
				sc.meshes.append(meshes[ids[m]])
				sc.instances.append(data)
				sc.radii.append(radii[m])
				any = any or not data.is_empty()
			if any:
				g.add_child(sc)
			else:
				sc.free()
	print("forest: %s in %d chunks" % [counts, keys.size()])


func _add(chunks: Dictionary, counts: Dictionary, id: String, x: float, z: float, yaw: float, s: float) -> void:
	var key := Vector2i(floori(x / CHUNK), floori(z / CHUNK))
	if not chunks.has(key):
		chunks[key] = {}
	if not chunks[key].has(id):
		chunks[key][id] = PackedFloat32Array()
	chunks[key][id].append_array([snappedf(x, 0.01), snappedf(z, 0.01), snappedf(yaw, 0.01), snappedf(s, 0.01)])
	counts[id] = counts.get(id, 0) + 1


# --- map overlay -------------------------------------------------------------------

## What the static map draws on top of the forest: a bold road ribbon, the
## stream, and an icon per landmark plus start and finish. Render layer 3,
## which only the map camera sees, at 16 m so the canopy can't hide it.
func _map_overlay() -> void:
	var g := _group("MapOverlay")
	var y := Vector3(0, 16.0, 0)
	var st := _st()
	_ribbon(st, pts, 4.5, Color("e9d6a8"), y)
	_ribbon(st, stream, 3.0, Color("5b9cc4"), y - Vector3(0, 0.1, 0))
	var icons := []
	var bridge: Node3D = track.get_node("WoodenBridge")
	icons.append([bridge.transform, Vector3(20, 0.2, 14), Color("7a5232")])
	var lm: Node3D = track.get_node("Landmarks")
	icons.append([lm.get_node("RangerCabin").transform, Vector3(18, 0.2, 18), Color("c0392b")])
	icons.append([lm.get_node("Sawmill").transform, Vector3(30, 0.2, 22), Color("8e99a4")])
	for ic in icons:
		var xf: Transform3D = ic[0]
		var size: Vector3 = ic[1]
		_box(st, Transform3D(xf.basis, xf.origin + y + Vector3(0, 0.3, 0)), size + Vector3(2.4, 0, 2.4), Color("1a1a1a"))
		_box(st, Transform3D(xf.basis, xf.origin + y + Vector3(0, 0.5, 0)), size, ic[2])
	# Start: green square. Finish: chequers.
	var sp := pts[spawn_i] + y + Vector3(0, 0.6, 0)
	_box(st, Transform3D(Basis.IDENTITY, sp), Vector3(14, 0.2, 14), Color("1a1a1a"))
	_box(st, Transform3D(Basis.IDENTITY, sp + Vector3(0, 0.2, 0)), Vector3(11, 0.2, 11), Color("2ecc71"))
	var fp := pts[finish_i] + y + Vector3(0, 0.6, 0)
	for a in 3:
		for b in 3:
			_box(st, Transform3D(Basis.IDENTITY, fp + Vector3((a - 1) * 4.5, 0, (b - 1) * 4.5)), Vector3(4.5, 0.2, 4.5), Color("111111") if (a + b) % 2 == 0 else Color("f5f5f5"))
	var mi := _mesh_node("Mesh", _commit(st, map_mat), Transform3D.IDENTITY, RENDER_MAP_ONLY)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(mi)


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
