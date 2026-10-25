extends SceneTree
## Generates scenes/tracks/pine_panic.scn: Pine Panic, the easy stage (spec §6).
## Deterministic. Run after tools/bake_assets.gd:
##   godot --headless --path . --script res://tools/build_pine_panic.gd
##
## A point-to-point gravel stage through pine forest: start arch, a wooden
## bridge over a stream, the ranger cabin, the sawmill, two hairpins with
## chevrons and hay, spectators at the good corners, finish arch, stop control.
## Trees wall the road and the forest stays closed all the way out: full
## pines near the road, cheaper ones in the deep forest, undergrowth between.
## They're baked into Scatter chunks (MultiMesh + colliders built on load).
##
## The road isn't drawn with a compass: the spline gets a seeded wobble
## (kinks, corners that tighten or open), the width and verge vary, and a
## height profile adds crests, dips and a little camber (off-camber in two
## places). Terrain (one height grid, see terrain.gd) carries the road and the
## forest; everything is placed on it, and Track.centerline is the final
## shape, so checkpoints, the map and the autopilot all agree.
##
## Saved binary because the forest data is a lot of numbers and nobody diffs them.

const OUT := "res://scenes/tracks/pine_panic.scn"
const MESH_DIR := "res://assets/meshes/"
const VC_MAT := "res://assets/materials/vertex_color.tres"
const ROAD_SHADER := "res://shaders/road.gdshader"

const ROAD_HALF_WIDTH := 3.0 ## nominal: 6 m of gravel, ~1.5 car lengths. Varies ±0.35 along the stage
const SHOULDER := 0.7 ## nominal loose verge either side; still "road" to the surface probe
const DITCH := 1.4 ## dark strip past the verge, before the trees
const APRON := 1.1 ## ragged gravel spill past the ditch; the shader eats it away
const STEP := 2.0 ## metres between centreline samples
const CHUNK := 96.0 ## forest chunk size; one MultiMesh (one draw call) per mesh per chunk, culled per chunk
const SEED := 11
const TERRAIN_CELL := 4.0
const TERRAIN_AMP := 3.2 ## metres of rolling ground in the deep forest
## Height profile along the stage: [centre m, half length m, rise m]. Cosine
## bumps; steepest is ~10%, none at a hairpin, landmark, bridge or the ends.
const PROFILE := [
	[180.0, 55.0, 2.0], [330.0, 60.0, -2.2], [465.0, 42.0, 2.6],
	[905.0, 75.0, 3.6], [1060.0, 48.0, -2.0], [1405.0, 52.0, 2.5],
	[1560.0, 45.0, -1.8], [1990.0, 50.0, 2.2],
]
## Off-camber stretches: [centre m, half length m]. The rest cambers gently into corners.
const OFF_CAMBER := [[1130.0, 26.0], [1470.0, 22.0]]

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
const C_DITCH := Color("4a4130")
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
## Per centreline sample: road half width, verge width, camber (height change
## per metre to the right).
var half_w := PackedFloat32Array()
var verge_w := PackedFloat32Array()
var bank := PackedFloat32Array()
var profile_h := PackedFloat32Array()
## Places the rolling ground flattens out for: [Vector2 centre, radius].
var flats: Array = []
var terrain: Terrain
var road_mat: ShaderMaterial
var tree_xz: Array = [] # Vector2 per tree, for the canopy shade under them


func _init() -> void:
	rng.seed = SEED
	noise.seed = SEED
	noise.frequency = 0.02
	vc_mat = load(VC_MAT)
	road_mat = ShaderMaterial.new()
	road_mat.shader = load(ROAD_SHADER) # Track._ready hands it the detail noise; not saved
	terrain = Terrain.new()
	terrain.name = "Ground"
	map_mat = StandardMaterial3D.new()
	map_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	map_mat.vertex_color_use_as_albedo = true
	map_mat.vertex_color_is_srgb = true
	for id in ["pine_tall", "pine_default", "pine_round", "pine_small", "log", "log_large", "log_stack",
			"rock_a", "rock_c", "rock_small", "rock_tall", "stump", "bush", "bush_small", "grass",
			"campfire", "arch", "flag_red", "flag_green", "tent", "cone"]:
		meshes[id] = load(MESH_DIR + id + ".res")
	_cheap_meshes()

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
	_shape_road()
	_plan_sites()
	_build_dist_grid(bb.grow(90.0))
	_bake_heights(bb)
	track.centerline = pts # final: wobbled, and on the ground
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
	_index_clearings()
	_forest(bb)
	_ground_tints() # after the forest: shade follows the canopy
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
	var raw := _resample(dense)
	# Wobble: push the line sideways by a seeded, smooth amount (two octaves
	# plus a few sharp kinks), so straights aren't ruler-straight and corners
	# tighten or open partway. Damped in tight corners: the hairpins stay
	# the hairpins, and the start and finish stay straight for the arches.
	var m := raw.size()
	var wob := FastNoiseLite.new()
	wob.seed = SEED + 3
	wob.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	wob.frequency = 1.0
	var kinks: Array = []
	var krng := RandomNumberGenerator.new()
	krng.seed = SEED + 5
	for k in 9:
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
		moved.append(b + Vector2(-t.y, t.x) * off * amp)
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


## Local radius at sample i from the heading change over a 24 m chord.
func _radius(i: int) -> float:
	var dh := tans[maxi(i - 6, 0)].signed_angle_to(tans[mini(i + 6, n - 1)], Vector3.UP)
	return 24.0 / maxf(absf(dh), 0.0001)


## Per-sample width, verge, height profile and camber. Smoothed along the
## stage so none of it steps.
func _shape_road() -> void:
	var wn := FastNoiseLite.new()
	wn.seed = SEED + 7
	wn.frequency = 1.0
	var raw_w := PackedFloat32Array()
	var raw_b := PackedFloat32Array()
	for i in n:
		var s := i * STEP
		var r := _radius(i)
		# Hairpins get a little extra room, like real ones (cars cut them).
		raw_w.append(ROAD_HALF_WIDTH + wn.get_noise_1d(s / 80.0) * 0.3 + 0.4 * (1.0 - smoothstep(20.0, 30.0, r)))
		var into := signf(_turn(i)) * 0.03 * (1.0 - smoothstep(30.0, 90.0, r))
		var off := 0.0
		for oc in OFF_CAMBER:
			off = maxf(off, _bump(s, oc[0], oc[1]))
		# Off-camber: the road falls away from the corner, or across a straight.
		var dir := signf(_turn(i)) if absf(_turn(i)) > 0.01 else 1.0
		raw_b.append(lerpf(into, -dir * 0.04, off))
		var h := 0.0
		for p in PROFILE:
			h += float(p[2]) * _bump(s, p[0], p[1])
		profile_h.append(h)
	for i in n:
		var sw := 0.0
		var sb := 0.0
		var k := 0
		for j in range(maxi(i - 5, 0), mini(i + 6, n)):
			sw += raw_w[j]
			sb += raw_b[j]
			k += 1
		half_w.append(sw / k)
		bank.append(sb / k)
		verge_w.append(clampf(SHOULDER + wn.get_noise_1d(i * STEP / 23.0 + 100.0) * 0.35, 0.35, 1.05))


## Cosine bump: 1 at centre, 0 at +-half, smooth both ends.
func _bump(s: float, centre: float, half: float) -> float:
	var t := absf(s - centre) / half
	return 0.5 + 0.5 * cos(PI * t) if t < 1.0 else 0.0


## Where things go, decided before the ground is shaped, because the ground
## flattens out for them (and for the stream, which mustn't run uphill).
var meadow := Vector3.ZERO
var stop_end := Vector3.ZERO
var cabin_spot: Array
var sawmill_spot: Array
var bridge_i := 0


func _plan_sites() -> void:
	spawn_i = int(24.0 / STEP)
	finish_i = n - 1 - int(70.0 / STEP)
	var r0 := _right(spawn_i)
	var side := 1.0 if (pts[spawn_i] + r0 * 48.0).z < (pts[spawn_i] - r0 * 48.0).z else -1.0
	meadow = pts[spawn_i] + r0 * side * 48.0
	stop_end = pts[n - 1] + tans[n - 1] * 10.0
	cabin_spot = _side_spot(CABIN_AT, 17.0)
	sawmill_spot = _side_spot(SAWMILL_AT, 30.0)
	bridge_i = _straightest_near(BRIDGE_AT, 40)
	_plan_stream()
	flats.append([Vector2(meadow.x, meadow.z), 46.0])
	flats.append([Vector2(stop_end.x, stop_end.z), 26.0])
	flats.append([Vector2(cabin_spot[2].x, cabin_spot[2].z), 18.0])
	flats.append([Vector2(sawmill_spot[2].x, sawmill_spot[2].z), 34.0])
	for p in [pts[spawn_i + 8], pts[finish_i]]:
		flats.append([Vector2(p.x, p.z), 14.0])


## Ground height before baking: the road's own height (profile plus camber)
## near the road, rolling noise further out, flat around the sites and the
## stream. The road term is a distance-weighted average over nearby samples,
## so the inside of a hairpin blends both legs instead of stepping.
func _height(x: float, z: float) -> float:
	var d := _fast_dist(x, z)
	var amp := TERRAIN_AMP * smoothstep(8.0, 40.0, d)
	for f in flats:
		amp *= smoothstep(f[1], f[1] + 24.0, Vector2(x, z).distance_to(f[0]))
	var sd := _stream_dist(x, z)
	if sd < 40.0:
		amp *= smoothstep(6.0, 40.0, sd)
	var t := (terrain_noise.get_noise_2d(x, z) * 0.8 + terrain_noise.get_noise_2d(x * 2.7 + 300.0, z * 2.7) * 0.2) * amp
	var w_road := 1.0 - smoothstep(9.0, 34.0, d)
	if w_road <= 0.0:
		return t
	var sum := 0.0
	var wsum := 0.0
	var reach := d + 10.0
	var r := ceili(reach / HASH_CELL)
	var cx := floori(x / HASH_CELL)
	var cz := floori(z / HASH_CELL)
	for ddx in range(-r, r + 1):
		for ddz in range(-r, r + 1):
			var k := Vector2i(cx + ddx, cz + ddz)
			if not _hash.has(k):
				continue
			for i in _hash[k]:
				var off := Vector2(x - pts[i].x, z - pts[i].z)
				var di := off.length()
				if di > reach:
					continue
				var wi := exp(-pow((di - d) / 3.0, 2.0))
				var lat := clampf(off.dot(Vector2(_right(i).x, _right(i).z)), -9.0, 9.0)
				sum += wi * (profile_h[i] + bank[i] * lat)
				wsum += wi
	var road_h := sum / wsum if wsum > 0.0 else 0.0
	return lerpf(t, road_h, w_road)


var terrain_noise := FastNoiseLite.new()


## Bakes the height grid into the Terrain (tints come later, after the
## forest) and drops the centreline onto it. From here on everything asks
## terrain.height_at(), the same function the game uses.
func _bake_heights(bb: Rect2) -> void:
	terrain_noise.seed = SEED + 11
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


## Reference forest-floor tint; the ground shader reads value relative to it
## as canopy shade (keep in sync with ground.gdshader's REF).
const C_FLOOR_REF := Color("5a4a36")


## Per-vertex tint for the terrain: rgb is the broad colour, alpha how much
## forest floor the shader paints over it. Under the canopy it's darker the
## denser the trees above; by the road it turns to verge grass; yards and the
## meadow keep their own colour.
func _ground_tints() -> void:
	var shade_grid := {}
	for p in tree_xz:
		var k := Vector2i(roundi((p.x - terrain.origin.x) / TERRAIN_CELL), roundi((p.y - terrain.origin.y) / TERRAIN_CELL))
		for dz in range(-1, 2):
			for dx in range(-1, 2):
				var kk := k + Vector2i(dx, dz)
				shade_grid[kk] = shade_grid.get(kk, 0.0) + (1.0 if dx == 0 and dz == 0 else 0.45)
	var bytes := PackedByteArray()
	bytes.resize(terrain.w * terrain.d * 4)
	for iz in terrain.d:
		for ix in terrain.w:
			var x := terrain.origin.x + ix * TERRAIN_CELL
			var z := terrain.origin.y + iz * TERRAIN_CELL
			var dens: float = shade_grid.get(Vector2i(ix, iz), 0.0)
			var k := noise.get_noise_2d(x, z) * 0.5 + 0.5
			var shade := lerpf(1.06, 0.7, clampf(dens / 4.5, 0.0, 1.0)) * (0.92 + k * 0.16)
			var c := Color(C_FLOOR_REF.r * shade, C_FLOOR_REF.g * shade, C_FLOOR_REF.b * shade)
			var forest := 1.0
			# Verge grass where light gets in, ragged: the noise moves the line.
			var d_road := _fast_dist(x, z)
			var grass := clampf(1.0 - (d_road - 6.0 - noise.get_noise_2d(x * 2.0, z * 2.0) * 3.0) / 5.0, 0.0, 1.0) * 0.85
			c = c.lerp(C_GRASS, grass)
			forest -= grass * 0.8
			for y in yards:
				var t := clampf((y[1] - Vector2(x, z).distance_to(y[0])) / 8.0, 0.0, 1.0)
				c = c.lerp(y[2], t)
				forest = lerpf(forest, 0.15, t)
			var o := (iz * terrain.w + ix) * 4
			bytes[o] = clampi(roundi(c.r * 255.0), 0, 255)
			bytes[o + 1] = clampi(roundi(c.g * 255.0), 0, 255)
			bytes[o + 2] = clampi(roundi(c.b * 255.0), 0, 255)
			bytes[o + 3] = clampi(roundi(forest * 255.0), 0, 255)
	terrain.tints = bytes
	terrain.collision_layer = LAYER_WORLD
	terrain.set_meta("surface", "offroad")
	track.add_child(terrain)
	print("ground: %d x %d vertices, %.0f m cells" % [terrain.w, terrain.d, TERRAIN_CELL])


## Road = visual strip (ditch, verge, wheel ruts, crown, all vertex colour) + a
## probe-only trimesh on the surfaces layer. The car drives on the flat
## ground; its downward ray reads the surface type from the probe, so there's
## no lip at the road edge to snag on.
## Cross-section at sample i: [lateral m, colour, jitter m]. Edges past the
## crown get per-sample jitter so the verge and ditch lines are never ruled;
## the last pair is the apron the shader frays into the forest floor.
func _profile(i: int) -> Array:
	var h := half_w[i]
	var v := h + verge_w[i]
	var dk := C_DITCH.lerp(C_VERGE, 0.4)
	var grass := C_GRASS.lerp(C_VERGE, 0.35)
	return [
		[-(v + DITCH + APRON), grass, 0.5], [-(v + DITCH), grass, 0.45], [-(v + 0.5), C_DITCH, 0.3], [-v, dk, 0.25],
		[-h, C_VERGE, 0.18], [-1.9, C_TRACK, 0.0], [-1.25, C_RUT, 0.0], [-0.5, C_CROWN, 0.0],
		[0.5, C_CROWN, 0.0], [1.25, C_RUT, 0.0], [1.9, C_TRACK, 0.0], [h, C_VERGE, 0.18],
		[v, dk, 0.25], [v + 0.5, C_DITCH, 0.3], [v + DITCH, grass, 0.45], [v + DITCH + APRON, grass, 0.5],
	]


## Road pieces this many centreline samples long (~120 m). One mesh for the
## whole stage put all 35k triangles through the GPU every frame from any
## camera; pieces let the camera cull what it can't see, for two or three
## extra draw calls.
const ROAD_PIECE := 60


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
			row.append([pos, Color(c.r * shade, c.g * shade, c.b * shade), Vector2(lat, i * STEP), Vector2(half_w[i], half_w[i] + verge_w[i])])
		rows.append(row)
	var cols: int = (rows[0] as Array).size()
	var body := StaticBody3D.new()
	body.name = "Road"
	body.add_to_group("track_road", true)
	body.set_meta("surface", "road")
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
	# three strips across, so camber is carried, not averaged away).
	var faces := PackedVector3Array()
	for i in n - 1:
		var w0 := half_w[i] + verge_w[i]
		var w1 := half_w[i + 1] + verge_w[i + 1]
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
	clearings.append([Vector2(meadow.x, meadow.z), 42.0])
	yards.append([Vector2(meadow.x, meadow.z), 38.0, C_GRASS.lightened(0.05)])
	var end := _g(stop_end)
	clearings.append([Vector2(end.x, end.z), 22.0])
	yards.append([Vector2(end.x, end.z), 18.0, C_YARD])
	# Service tents along the meadow's road edge; the middle stays open.
	for k in 3:
		var p := _g(pts[spawn_i] + r0 * side * 14.0 + tans[spawn_i] * (k * 7.0 - 12.0))
		var tent := _solid("Tent%d" % k, "tent", Transform3D(Basis.looking_at(tans[spawn_i], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)
	for k in 6:
		var p := _g(pts[0] + _right(0) * (k * 1.4 - 3.5))
		g.add_child(_mesh_node("Cone%d" % k, meshes["cone"], Transform3D(Basis.IDENTITY, p)))
	for k in 2:
		var p := _g(end + _right(n - 1) * (k * 9.0 - 6.0) + tans[n - 1] * 8.0)
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


func _plan_stream() -> void:
	var bi := bridge_i
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


func _stream_and_bridge() -> void:
	var bi := bridge_i
	var c := pts[bi]
	for i in stream.size():
		stream[i] = _g(stream[i])
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
		var p := _g(stream[i] + Vector3(-t.z, 0, t.x) * (3.4 if k % 2 == 0 else -3.4))
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
			var p := _g(pts[i] + o * (half_w[i] + verge_w[i] + DITCH + 0.6))
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


# --- roadside ------------------------------------------------------------------

## Logs, rocks and stumps just past the ditch: things to clip, and to call.
func _roadside() -> void:
	var g := _group("Roadside")
	var i := 30
	var count := 0
	while i < n - 40:
		i += rng.randi_range(12, 26)
		var side := -1.0 if rng.randf() < 0.5 else 1.0
		var d := half_w[i] + verge_w[i] + DITCH + rng.randf_range(0.2, 1.4)
		var p := _g(pts[i] + _right(i) * side * d, -0.05)
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
	return [i, side, p] # y is the road's; the site is flattened to about that


## Ranger cabin: log walls, red roof, chimney, woodpile. In its own clearing.
func _cabin() -> void:
	var spot := cabin_spot
	var i: int = spot[0]
	var p: Vector3 = _g(spot[2], -0.1)
	var face := Vector3(pts[i].x - p.x, 0, pts[i].z - p.z).normalized() # front faces the road
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
	var spot := sawmill_spot
	var i: int = spot[0]
	var p: Vector3 = _g(spot[2], -0.1)
	var face := Vector3(pts[i].x - p.x, 0, pts[i].z - p.z).normalized()
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
		var back := half_w[i] + verge_w[i] + DITCH + (2.0 if side > 0 else 2.6)
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


# --- forest ----------------------------------------------------------------------

const TREE_IDS := ["pine_tall", "pine_default", "pine_round", "pine_small", "pine_far", "pine_far_b"]
const TREE_RADII := [0.4, 0.5, 0.5, 0.35, 0.45, 0.45]
const FLOOR_IDS := ["bush", "bush_small", "rock_a", "stump", "grass", "fern", "branch"]
const FLOOR_RADII := [0.0, 0.0, 1.0, 0.4, 0.0, 0.0, 0.0]
const NEAR_FOREST := 24.0 ## full Kenney pines inside this distance from the road, cheap ones past it
const SOLID_FOREST := 45.0 ## trees past this get no collider: scenery, nobody gets that far in


## Trees wall the road and the canopy stays closed all the way out, with
## glades. Jittered grid, so spacing stays even without a Poisson pass.
## Near the road: the detailed pines (they're what you see up close and what
## you hit). Deep forest: the two cheap pines, a little bigger so fewer of
## them close the canopy. Every tree stands on the terrain.
func _forest(bb: Rect2) -> void:
	var area := bb.grow(50.0)
	var walls := bb.grow(20.0)
	var chunks := {} # Vector2i -> {mesh_id: PackedFloat32Array}
	var counts := {}
	var edge := ROAD_HALF_WIDTH + 0.4 + SHOULDER + 0.35 + DITCH + 0.4
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
			elif d < NEAR_FOREST:
				p = 0.74
			else:
				p = 0.64
			# Patchy, not uniform: noise opens glades in the far forest.
			p *= clampf(0.8 + noise.get_noise_2d(px * 0.6, pz * 0.6) * 0.9, 0.3, 1.15) if d > 14.0 else 1.0
			if rng.randf() > p:
				continue
			if not _clear(px, pz) or _stream_dist(px, pz) < 4.5:
				continue
			var w := rng.randf()
			var id: String
			var s := rng.randf_range(0.8, 1.25)
			if d < NEAR_FOREST:
				id = "pine_tall" if w < 0.38 else ("pine_default" if w < 0.68 else ("pine_round" if w < 0.88 else "pine_small"))
				if d < 9.0 and rng.randf() < 0.35:
					id = "pine_small"
			else:
				id = "pine_tall" if w < 0.25 else ("pine_far" if w < 0.7 else "pine_far_b")
				s = rng.randf_range(0.95, 1.4)
			var solid := d < SOLID_FOREST and walls.has_point(Vector2(px, pz))
			# Sunk a little so a slope never shows daylight under a trunk.
			_add(chunks, counts, id, px, terrain.height_at(px, pz) - 0.15, pz, rng.randf() * TAU, s if solid else -s)
			tree_xz.append(Vector2(px, pz))
		x += CELL
	# Forest floor: bushes, rocks, stumps, ferns and fallen branches between
	# the trees; grass tufts along the ditch.
	x = area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, 4.0)
			var pz := z + rng.randf_range(0.0, 4.0)
			z += 3.2
			var d := _fast_dist(px, pz)
			if not _clear(px, pz) or _stream_dist(px, pz) < 3.8:
				continue
			if d < ROAD_HALF_WIDTH + SHOULDER + 0.3:
				continue
			var y := terrain.height_at(px, pz)
			if d < edge + 0.6:
				if rng.randf() < 0.55:
					_add(chunks, counts, "grass", px, y, pz, rng.randf() * TAU, rng.randf_range(0.6, 1.0))
				continue
			var r := rng.randf()
			if r < 0.13:
				if d < 30.0 or r < 0.05:
					_add(chunks, counts, "bush" if r < 0.07 else "bush_small", px, y, pz, rng.randf() * TAU, rng.randf_range(0.7, 1.2))
			elif r < 0.15:
				_add(chunks, counts, "rock_a", px, y - 0.1, pz, rng.randf() * TAU, rng.randf_range(0.4, 0.9))
			elif r < 0.165:
				_add(chunks, counts, "stump", px, y - 0.05, pz, rng.randf() * TAU, rng.randf_range(0.8, 1.2))
			elif r < 0.33:
				_add(chunks, counts, "fern", px, y, pz, rng.randf() * TAU, rng.randf_range(0.7, 1.3))
			elif r < 0.37:
				_add(chunks, counts, "branch", px, y, pz, rng.randf() * TAU, rng.randf_range(0.7, 1.3))
		x += 3.2
	var g := _group("Forest")
	var keys := chunks.keys()
	keys.sort()
	var solid_total := 0
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
			sc.origin = Vector2(key.x, key.y) * CHUNK
			sc.span = CHUNK
			var any := false
			for m in ids.size():
				var data: PackedFloat32Array = by_id.get(ids[m], PackedFloat32Array())
				sc.meshes.append(meshes[ids[m]])
				sc.packed.append(Scatter.pack(data, sc.origin, CHUNK))
				sc.radii.append(radii[m])
				any = any or not data.is_empty()
				if radii[m] > 0.0:
					for k in range(4, data.size(), Scatter.STRIDE):
						solid_total += 1 if data[k] > 0.0 else 0
			if any:
				g.add_child(sc)
			else:
				sc.free()
	print("forest: %s in %d chunks, %d solid" % [counts, keys.size(), solid_total])


func _add(chunks: Dictionary, counts: Dictionary, id: String, x: float, y: float, z: float, yaw: float, s: float) -> void:
	var key := Vector2i(floori(x / CHUNK), floori(z / CHUNK))
	if not chunks.has(key):
		chunks[key] = {}
	if not chunks[key].has(id):
		chunks[key][id] = PackedFloat32Array()
	chunks[key][id].append_array([snappedf(x, 0.01), snappedf(y, 0.01), snappedf(z, 0.01), snappedf(yaw, 0.01), snappedf(s, 0.01)])
	counts[id] = counts.get(id, 0) + 1


# --- cheap scenery meshes -----------------------------------------------------------

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


## Two deep-forest pines, ~40 and ~30 triangles (the Kenney ones are 80-230).
## From the Navigator's camera only the silhouette and the tiers read.
func _cheap_meshes() -> void:
	var leaf := Color("2f5636")
	var bark := Color("4a3326")
	var st := _st()
	_cone(st, 5, 0.22, 0.0, 2.2, bark)
	_cone(st, 7, 1.7, 1.6, 5.4, leaf.darkened(0.12))
	_cone(st, 7, 1.35, 3.7, 7.6, leaf.darkened(0.04), 0.4)
	_cone(st, 6, 0.95, 5.9, 9.6, leaf.lightened(0.04), 0.9)
	meshes["pine_far"] = _commit(st)
	st = _st()
	_cone(st, 5, 0.25, 0.0, 2.0, bark)
	_cone(st, 8, 1.9, 1.4, 6.0, leaf.darkened(0.1))
	_cone(st, 7, 1.3, 4.2, 8.4, leaf.lightened(0.02), 0.5)
	meshes["pine_far_b"] = _commit(st)
	# Fern: six fronds, each a bent quad, arching out and down.
	st = _st()
	var fern := Color("4f7a35")
	for k in 6:
		var a := TAU * k / 6.0 + 0.3 * (k % 2)
		var dir := Vector3(cos(a), 0, sin(a))
		var side := Vector3(-dir.z, 0, dir.x) * 0.16
		var mid := dir * 0.45 + Vector3(0, 0.42, 0)
		var tip := dir * 0.95 + Vector3(0, 0.18, 0)
		var c := fern.darkened(0.1 * (k % 3))
		_tri(st, Vector3.ZERO, mid - side, mid + side, c)
		_tri(st, mid + side, mid - side, tip, c.lightened(0.06))
	meshes["fern"] = _commit(st)
	# Fallen branch: a thin bar with a fork, lying in the litter.
	st = _st()
	var wood := C_LOG_DARK
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.06, 0)), Vector3(0.12, 0.12, 2.0), wood)
	_box(st, Transform3D(Basis(Vector3.UP, 0.6), Vector3(0.22, 0.05, 0.55)), Vector3(0.08, 0.08, 0.8), wood.lightened(0.08))
	meshes["branch"] = _commit(st)


# --- map overlay -------------------------------------------------------------------

## What the static map draws on top of the forest: a bold road ribbon, the
## stream, and an icon per landmark plus start and finish. Render layer 3,
## which only the map camera sees, 24 m above the road so the canopy (13 m at
## most, on ground that rolls a few metres) can't hide it.
func _map_overlay() -> void:
	var g := _group("MapOverlay")
	var y := Vector3(0, 24.0, 0)
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
