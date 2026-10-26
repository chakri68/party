class_name EyeForest
extends Node3D
## The forest as the chase and bonnet cameras draw it. Same trees, same
## places (it reads the baked Scatter records), regrouped and LOD'd for a
## camera that looks along the ground instead of down at it.
##
## Why a second copy: the baked chunks are 96 m with every mesh in each.
## From above that's right, the view is ~75 x 50 m and a handful of chunks
## covers it in few draw calls. Looking down the road with a 130 m far plane,
## every chunk the frustum grazes is drawn whole: 13 chunks, ~120k m2 of
## forest for ~25k m2 of view, half a million triangles. So, at eye level:
##
## - Near detail (the Kenney pines by the road) and floor clutter (ferns,
##   bushes, rocks...) are streamed round the camera: one MultiMesh per mesh
##   holding just the instances within reach, refilled from a 16 m bucket
##   grid whenever the camera has moved STREAM_STEP metres (a few hundred
##   instances, a millisecond or two). Eleven draw calls whatever the view.
##   The palette shader drops each tree past NEAR_R from the camera; clutter
##   shrinks into the ground over the last FLOOR_BAND metres before FLOOR_R.
## - Impostors: every tree, as one 18-triangle pine reshaped per instance
##   (tall, wide, two-tier...), in IMP_CELL cells, one draw call each. Their
##   shader drops each tree inside NEAR_R, so every tree is drawn exactly
##   once and the swap happens tree by tree on a circle, in fog, not a cell
##   at a time. Deep forest (more than ROAD_NEAR from the centreline) is only
##   ever impostors: its baked meshes were 20-25 triangle cones already.
## - A treeline ring just inside the far plane, in the fog colour, so the
##   horizon down a long straight is distant forest, not sky.
## - Tall landmarks (group track_tall: the fire tower) past PROXY_R: a copy
##   of the mesh scaled about the camera onto PROXY_R, which projects to
##   exactly the same silhouette, drawn in haze. The real one is past the fog
##   (and soon the far plane) by then; this is how it's seen from far off.
##
## Built on demand, the first time a perspective camera is used (~0.5 s);
## a top-down-only session never pays for it.
##
## The biome (Track.get_biome()) picks the style. Forest: all of the above.
## Desert ("impostors": "none"): the scatter is sparse (cacti, scrub, rocks),
## so every tall instance is simply streamed out to the biome's near_r and
## the haze takes over from there; the horizon ring is mesas, not pines;
## and the canyon walls, which are terrain, do the hiding the forest does.
## Snow (Snowblind): the forest's machinery, with the impostors' tips white
## (Biome.tree_snow). Coast (Cliffhanger): the forest's machinery for its
## pine clumps, and no horizon ring (ring "none"): the sea is the horizon.

const BUCKET := 16.0 ## streaming grid
const STREAM_STEP := 4.0 ## camera metres between refills
const STREAM_TURN := 25.0 ## ...or degrees of camera yaw
const STREAM_BEHIND := 12.0 ## behind the camera, only this close is kept (a fast turn shouldn't find a hole)
const IMP_CELL := 64.0
const NEAR_R := 50.0 ## detail -> impostor, horizontal metres from the camera
const FLOOR_R := 34.0
const FLOOR_BAND := 8.0
const ROAD_NEAR := 26.0 ## trees this close to the centreline get near detail
const RING_R := 106.0 ## treeline ring radius; fog is total by 108, far plane 118
const ROAD_GRID := 4.0
const PROXY_R := 80.0 ## tall landmarks further than this are drawn as a haze silhouette on this radius

## Per baked tree mesh (Scatter.meshes order, build_pine_panic TREE_IDS):
## impostor width, height, drop the top tier (1 = two tiers).
const SHAPES := [
	Vector3(0.78, 1.12, 0), # pine_tall: narrow spire
	Vector3(1.0, 1.04, 0), # pine_default
	Vector3(1.12, 0.9, 0), # pine_round
	Vector3(0.95, 0.62, 0), # pine_small
	Vector3(1.0, 1.0, 0), # pine_far
	Vector3(1.12, 0.9, 1), # pine_far_b: two tiers, wider
]

var fog_color := Color(0.69, 0.73, 0.76)
var near_r := NEAR_R
var ring_r := RING_R
var fog_range := Vector2(24.0, 108.0) ## the biome's depth fog, for the far silhouettes
var built := false
var near_mat: ShaderMaterial
var floor_mat: ShaderMaterial
var far_mat: ShaderMaterial
var ring: MeshInstance3D
var counts := {} # for tests and the perf notes
var tall: Array = [] # [landmark Node3D, its far silhouette MeshInstance3D]

var _track: Track
var _near := {} # Mesh -> {Vector2i bucket: PackedFloat32Array of x,y,z,yaw,s}
var _floor := {}
var _streams := [] # [MultiMeshInstance3D, buckets dict, reach metres]
var _centre := Vector3.INF
var _yaw := 0.0


## Reads the track's Scatter chunks and builds everything. Weather gets the
## new materials so cloud shade and mist reach them too.
func build(track: Track, palette: ShaderMaterial, weather: Weather) -> void:
	if built:
		return
	built = true
	_track = track
	var biome := track.get_biome()
	near_r = biome.near_r
	ring_r = biome.fog_end - 2.0
	fog_range = Vector2(biome.fog_begin, biome.fog_end)
	var pines := biome.impostors == "pines"
	near_mat = palette.duplicate()
	near_mat.set_shader_parameter("lod_mode", 1)
	near_mat.set_shader_parameter("lod_range", Vector2(near_r, 0.0))
	floor_mat = palette.duplicate()
	floor_mat.set_shader_parameter("lod_mode", 2)
	floor_mat.set_shader_parameter("lod_range", Vector2(FLOOR_R, FLOOR_BAND))
	far_mat = ShaderMaterial.new()
	far_mat.shader = preload("res://shaders/forest_far.gdshader")
	far_mat.set_shader_parameter("near_r", near_r)
	far_mat.set_shader_parameter("snow_cap", biome.tree_snow)
	for m in [near_mat, floor_mat, far_mat]:
		weather.register(m)

	var road := _road_grid(track)
	var imp := {} # Vector2i -> PackedFloat32Array of x,y,z,yaw,s,shape
	var forest := track.get_node_or_null("Forest")
	if forest == null:
		return
	for sc in forest.get_children():
		if not sc is Scatter:
			continue
		var is_tree: bool = sc.get_meta("kind", "") == "tree"
		for m in sc.meshes.size():
			var data: PackedFloat32Array = sc.decode(m)
			var mesh: Mesh = sc.meshes[m]
			for i in range(0, data.size(), Scatter.STRIDE):
				var x := data[i]
				var z := data[i + 2]
				var rec := [x, data[i + 1], z, data[i + 3], absf(data[i + 4])]
				if not is_tree:
					_put(_floor, mesh, _cell(x, z, BUCKET), rec)
					continue
				if not pines:
					_put(_near, mesh, _cell(x, z, BUCKET), rec)
					continue
				var key := _cell(x, z, IMP_CELL)
				if not imp.has(key):
					imp[key] = PackedFloat32Array()
				imp[key].append_array(rec + [float(m)])
				# The baked deep-forest cones (pine_far, pine_far_b) are no
				# better than an impostor, so they never get near detail.
				if m < 4 and road.has(Vector2i(floori(x / ROAD_GRID), floori(z / ROAD_GRID))):
					_put(_near, mesh, _cell(x, z, BUCKET), rec)

	counts = {"near": 0, "floor": 0, "impostor": 0, "near_mm": 0, "floor_mm": 0, "impostor_mm": 0}
	var g_near := _group("Near")
	var g_floor := _group("Floor")
	var g_far := _group("Far")
	for mesh in _near:
		_stream(g_near, mesh, _near[mesh], near_mat, near_r + STREAM_STEP * 2.0)
	for mesh in _floor:
		_stream(g_floor, mesh, _floor[mesh], floor_mat, FLOOR_R + STREAM_STEP * 2.0)
	for mesh in _near:
		for b in _near[mesh]:
			counts["near"] += _near[mesh][b].size() / 5
	for mesh in _floor:
		for b in _floor[mesh]:
			counts["floor"] += _floor[mesh][b].size() / 5
	var unit := _impostor_mesh()
	for key in imp:
		_impostors(g_far, unit, imp[key])
	if biome.ring != "none":
		ring = MeshInstance3D.new()
		ring.name = "Treeline"
		ring.mesh = _ring_mesh(ring_r) if biome.ring == "pines" else _mesa_ring(ring_r)
		var rmat := ShaderMaterial.new()
		rmat.shader = preload("res://shaders/treeline.gdshader")
		rmat.set_shader_parameter("haze", fog_color)
		ring.material_override = rmat
		ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ring.extra_cull_margin = 200.0
		add_child(ring)
	var lm_shader := preload("res://shaders/far_landmark.gdshader")
	for t in track.get_tree().get_nodes_in_group("track_tall"):
		if not track.is_ancestor_of(t) or not t.has_meta("proxy_mesh"):
			continue
		var mi := MeshInstance3D.new()
		mi.name = "Far" + String(t.name)
		mi.mesh = t.get_meta("proxy_mesh")
		var m := ShaderMaterial.new()
		m.shader = lm_shader
		m.set_shader_parameter("haze", fog_color)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.layers = 16 # 3D view only
		mi.visible = false
		add_child(mi)
		tall.append([t, mi])


## Keeps the treeline ring round the camera (it never gets closer) and the
## streamed near detail filled for where the camera is now.
func follow(cam: Node3D, ground_y: float) -> void:
	var p := cam.global_position
	if ring:
		ring.global_position = Vector3(p.x, ground_y, p.z)
	_place_tall(p)
	var fwd := -cam.global_basis.z
	var yaw := atan2(fwd.x, fwd.z)
	if _centre == Vector3.INF or Vector2(p.x - _centre.x, p.z - _centre.z).length() >= STREAM_STEP \
			or absf(angle_difference(yaw, _yaw)) >= deg_to_rad(STREAM_TURN):
		refill(p, fwd)


## Refills every streamed MultiMesh with the instances within its reach of
## `at`, in front of the camera (a little past side-on, so a STREAM_TURN of
## yaw can't uncover the edge) plus a small ring behind it. reach = the
## shader's cut-off plus two steps, so nothing the shader would draw is
## missing before the next refill.
func refill(at: Vector3, fwd := Vector3.ZERO) -> void:
	_centre = at
	_yaw = atan2(fwd.x, fwd.z)
	var f2 := Vector2(fwd.x, fwd.z).normalized()
	var any_dir := f2 == Vector2.ZERO
	var behind2 := STREAM_BEHIND * STREAM_BEHIND
	for s in _streams:
		var mi: MultiMeshInstance3D = s[0]
		var buckets: Dictionary = s[1]
		var reach: float = s[2]
		var r2 := reach * reach
		var lo := _cell(at.x - reach, at.z - reach, BUCKET)
		var hi := _cell(at.x + reach, at.z + reach, BUCKET)
		var picked := PackedFloat32Array()
		for bz in range(lo.y, hi.y + 1):
			for bx in range(lo.x, hi.x + 1):
				var recs: PackedFloat32Array = buckets.get(Vector2i(bx, bz), PackedFloat32Array())
				for r in range(0, recs.size(), 5):
					var dx := recs[r] - at.x
					var dz := recs[r + 2] - at.z
					var d2 := dx * dx + dz * dz
					if d2 <= r2 and (any_dir or d2 <= behind2 or dx * f2.x + dz * f2.y > -0.25 * sqrt(d2)):
						picked.append_array(recs.slice(r, r + 5))
		var n := picked.size() / 5
		var buf := PackedFloat32Array()
		buf.resize(n * 16)
		for i in n:
			var r := i * 5
			var o := i * 16
			_xform(buf, o, picked[r], picked[r + 1], picked[r + 2], picked[r + 3], picked[r + 4])
			var k := 1.0 + (_jit(picked[r], picked[r + 2]) - 0.5) * 0.22
			buf[o + 12] = k; buf[o + 13] = k; buf[o + 14] = k; buf[o + 15] = 1.0
		var mm := mi.multimesh
		mm.instance_count = n
		if n > 0:
			mm.buffer = buf
		mi.custom_aabb = AABB(Vector3(at.x - reach, at.y - 40.0, at.z - reach), Vector3(reach * 2.0, 80.0, reach * 2.0))


## Scales each tall landmark about the camera onto PROXY_R once it's further
## than that. Its haze matches the real one's depth fog at PROXY_R (main.gd:
## fog 24-108 m, curve 1.25), thinning slowly past it so it never vanishes.
func _place_tall(cam_p: Vector3) -> void:
	for pair in tall:
		var t: Node3D = pair[0]
		var mi: MeshInstance3D = pair[1]
		var aim := t.global_position + Vector3(0, 12.0, 0)
		var d := cam_p.distance_to(aim)
		mi.visible = d > PROXY_R
		if not mi.visible:
			continue
		var k := PROXY_R / d
		var about := Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * k), cam_p * (1.0 - k))
		mi.global_transform = about * t.global_transform
		var fog_at := pow(clampf((PROXY_R - fog_range.x) / (fog_range.y - fog_range.x), 0.0, 1.0), 1.25)
		(mi.material_override as ShaderMaterial).set_shader_parameter("haze_k", minf(fog_at + (d - PROXY_R) / 2500.0, 0.8))


## Instances one streamed MultiMesh draws right now (tests).
func streamed() -> int:
	var n := 0
	for s in _streams:
		n += (s[0] as MultiMeshInstance3D).multimesh.instance_count
	return n


## Cells (ROAD_GRID metres) within ROAD_NEAR of the centreline.
func _road_grid(track: Track) -> Dictionary:
	var out := {}
	var reach := int(ceil(ROAD_NEAR / ROAD_GRID))
	var r2 := ROAD_NEAR * ROAD_NEAR
	for p in track.centerline:
		var cx := floori(p.x / ROAD_GRID)
		var cz := floori(p.z / ROAD_GRID)
		for dz in range(-reach, reach + 1):
			for dx in range(-reach, reach + 1):
				var c := Vector2i(cx + dx, cz + dz)
				if out.has(c):
					continue
				var q := Vector2((c.x + 0.5) * ROAD_GRID - p.x, (c.y + 0.5) * ROAD_GRID - p.z)
				if q.length_squared() <= r2:
					out[c] = true
	return out


static func _cell(x: float, z: float, size: float) -> Vector2i:
	return Vector2i(floori(x / size), floori(z / size))


static func _put(d: Dictionary, mesh: Mesh, key: Vector2i, rec: Array) -> void:
	if not d.has(mesh):
		d[mesh] = {}
	if not d[mesh].has(key):
		d[mesh][key] = PackedFloat32Array()
	d[mesh][key].append_array(rec)


func _group(n: String) -> Node3D:
	var g := Node3D.new()
	g.name = n
	add_child(g)
	return g


## Instance buffer layout (MultiMesh.buffer): 12 floats of row-major 3x4
## transform, then colour if used, then custom data if used.
static func _xform(buf: PackedFloat32Array, o: int, x: float, y: float, z: float, yaw: float, s: float) -> void:
	var c := cos(yaw) * s
	var n := sin(yaw) * s
	buf[o] = c; buf[o + 1] = 0.0; buf[o + 2] = n; buf[o + 3] = x
	buf[o + 4] = 0.0; buf[o + 5] = s; buf[o + 6] = 0.0; buf[o + 7] = y
	buf[o + 8] = -n; buf[o + 9] = 0.0; buf[o + 10] = c; buf[o + 11] = z


## Per-instance brightness jitter, from the position: deterministic, no rng.
static func _jit(x: float, z: float) -> float:
	return fposmod(sin(x * 12.9898 + z * 78.233) * 43758.5453, 1.0)


func _stream(parent: Node3D, mesh: Mesh, buckets: Dictionary, mat: Material, reach: float) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	_streams.append([mi, buckets, reach])
	counts[String(parent.name).to_lower() + "_mm"] += 1


func _impostors(parent: Node3D, unit: Mesh, recs: PackedFloat32Array) -> void:
	var n := recs.size() / 6
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = unit
	mm.instance_count = n
	var buf := PackedFloat32Array()
	buf.resize(n * 20)
	for i in n:
		var r := i * 6
		var o := i * 20
		var x := recs[r]
		var z := recs[r + 2]
		_xform(buf, o, x, recs[r + 1], z, recs[r + 3], recs[r + 4])
		var h := _jit(x, z)
		var k := 0.88 + h * 0.24
		buf[o + 12] = k; buf[o + 13] = k * (0.97 + 0.06 * _jit(z, x)); buf[o + 14] = k; buf[o + 15] = 1.0
		var sh: Vector3 = SHAPES[int(recs[r + 5])]
		buf[o + 16] = sh.x; buf[o + 17] = sh.y; buf[o + 18] = sh.z; buf[o + 19] = h
	mm.buffer = buf
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = far_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	counts["impostor"] += n
	counts["impostor_mm"] += 1


## The impostor: a 3-sided trunk and three 5-sided tiers, flat shaded like
## Kenney's, 18 triangles. UV.x tags the part (0 trunk, 1-3 tiers) so the
## shader can reshape it per instance. Proportions after the deep-forest
## pine_far, so the swap from the baked meshes reads as the same tree.
static func _impostor_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var leaf := Color("2f5636")
	_cone(st, 3, 0.24, 0.0, 2.4, Color("4a3326"), 0.0, 0.0)
	_cone(st, 5, 1.75, 1.5, 5.5, leaf.darkened(0.12), 0.0, 1.0)
	_cone(st, 5, 1.35, 3.7, 7.7, leaf.darkened(0.04), 0.6, 2.0)
	_cone(st, 5, 0.95, 5.9, 9.8, leaf.lightened(0.04), 1.2, 3.0)
	return st.commit()


static func _cone(st: SurfaceTool, sides: int, r: float, y0: float, y1: float, col: Color, yaw: float, part: float) -> void:
	for k in sides:
		var a0 := yaw + TAU * k / sides
		var a1 := yaw + TAU * (k + 1) / sides
		var p0 := Vector3(cos(a0) * r, y0, sin(a0) * r)
		var p1 := Vector3(cos(a1) * r, y0, sin(a1) * r)
		var apex := Vector3(0, y1, 0)
		var nrm := (apex - p0).cross(p1 - p0).normalized()
		for v in [p0, p1, apex]:
			st.set_color(col.darkened(0.08 * (k % 2)))
			st.set_normal(nrm)
			st.set_uv(Vector2(part, 0.0))
			st.add_vertex(v)


## Flat-topped buttes and mesas all the way round, with the odd spire: the
## desert's horizon. Same rules as the treeline: y is metres above the car's
## ground, the shader colours it as haze.
static func _mesa_ring(radius: float) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	const SEGS := 180
	var n := FastNoiseLite.new()
	n.seed = 9
	n.frequency = 0.045
	var heights := PackedFloat32Array()
	for i in SEGS + 1:
		var v := n.get_noise_1d(i % SEGS)
		# Terraced: a plateau, a lower bench, or open desert, with hard steps.
		var h := 15.0 + _jit(i, 3.0) * 1.2 if v > 0.12 else (8.0 + _jit(i, 4.0) * 0.8 if v > -0.18 else 2.5)
		heights.append(h)
	var low := -14.0
	for i in SEGS:
		var a0 := TAU * i / SEGS
		var a1 := TAU * (i + 1) / SEGS
		var b0 := Vector3(cos(a0), 0, sin(a0)) * radius
		var b1 := Vector3(cos(a1), 0, sin(a1)) * radius
		var h0 := heights[i]
		var h1 := heights[i + 1]
		# A step between plateaus stays a step: both corners take the segment's height.
		var top := maxf(h0, h1) if absf(h0 - h1) < 1.5 else h0
		var verts := [b0 + Vector3(0, low, 0), b1 + Vector3(0, low, 0), b0 + Vector3(0, top, 0),
			b0 + Vector3(0, top, 0), b1 + Vector3(0, low, 0), b1 + Vector3(0, top, 0)]
		if _jit(i, 11.0) > 0.93: # a spire
			var bm := (b0 + b1) * 0.5
			verts.append_array([b0 + Vector3(0, top, 0), b1 + Vector3(0, top, 0), bm + Vector3(0, top + 9.0 + _jit(i, 5.0) * 6.0, 0)])
		for v in verts:
			st.set_uv(Vector2(clampf((v.y - low) / (20.0 - low), 0.0, 1.0), 0.0))
			st.add_vertex(v)
	return st.commit()


## A ragged band of treetops all the way round, 240 spikes. y is metres
## above the car's ground; the shader colours it as haze.
static func _ring_mesh(radius := RING_R) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	const SPIKES := 240
	var n := FastNoiseLite.new()
	n.seed = 5
	n.frequency = 0.05
	for i in SPIKES:
		var a0 := TAU * i / SPIKES
		var a1 := TAU * (i + 1) / SPIKES
		var am := (a0 + a1) * 0.5
		var hill := 3.0 + n.get_noise_1d(i) * 4.0 # rolling ridge under the tips
		var v0 := hill + 4.0 + _jit(i, 1.0) * 1.5
		var v1 := 3.0 + n.get_noise_1d(i + 1) * 4.0 + 4.0 + _jit(i + 1, 1.0) * 1.5
		var tip := hill + 8.0 + _jit(i, 7.0) * 5.0
		var b0 := Vector3(cos(a0), 0, sin(a0)) * radius
		var b1 := Vector3(cos(a1), 0, sin(a1)) * radius
		var bm := Vector3(cos(am), 0, sin(am)) * radius
		var low := -14.0
		for v in [b0 + Vector3(0, low, 0), b1 + Vector3(0, low, 0), b0 + Vector3(0, v0, 0),
				b0 + Vector3(0, v0, 0), b1 + Vector3(0, low, 0), b1 + Vector3(0, v1, 0),
				b0 + Vector3(0, v0, 0), b1 + Vector3(0, v1, 0), bm + Vector3(0, tip, 0)]:
			st.set_uv(Vector2(clampf((v.y - low) / (20.0 - low), 0.0, 1.0), 0.0))
			st.add_vertex(v)
	return st.commit()
