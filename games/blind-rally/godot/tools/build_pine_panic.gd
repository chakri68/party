extends "res://tools/stage_builder.gd"
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
## The generic half (centreline, terrain bake, road strip, gates, icons) is
## tools/stage_builder.gd, shared with every stage.

const OUT := "res://scenes/tracks/pine_panic.scn"

const ROAD_HALF_WIDTH := 3.0 ## nominal: 6 m of gravel, ~1.5 car lengths. Varies ±0.35 along the stage
const SHOULDER := 0.7 ## nominal loose verge either side; still "road" to the surface probe
const DITCH := 1.4 ## dark strip past the verge, before the trees
const APRON := 1.1 ## ragged gravel spill past the ditch; the shader eats it away
const SEED := 11
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
## Smaller callouts beside the road (spec §6 landmarks the Navigator can
## call): [id, stage metres, side (+1 right of travel, -1 left, 0 = outside
## of the bend), metres off the centreline, flat-ground radius (0 = none)].
## Kept 60 m+ clear of the bridge, cabin and sawmill, and off the checkpoints.
const SCENERY := [
	["gate", 112.0, 1.0, 6.2, 0.0],
	["wreck", 560.0, 0.0, 7.6, 0.0],
	["tower", 906.0, 0.0, 18.0, 7.0],
	["stand", 1062.0, 0.0, 8.0, 0.0],
	["landing", 1470.0, 0.0, 12.0, 12.0],
	["outhouse", 2078.0, 0.0, 7.6, 0.0],
	["camp", 2214.0, 0.0, 12.5, 11.0],
]
## Easter-egg spots: [kind, stage metres, side, metres off the centreline].
## Baked as markers only; scripts/easter_eggs.gd decides from the session
## seed which of them come alive in a run.
const EGG_SPOTS := [
	["deer", 232.0, 0.0, 0.0], ["deer", 470.0, 0.0, 0.0], ["deer", 735.0, 0.0, 0.0],
	["deer", 1110.0, 0.0, 0.0], ["deer", 1612.0, 0.0, 0.0], ["deer", 2036.0, 0.0, 0.0],
	["birds", 186.0, -1.0, 10.0], ["birds", 520.0, 1.0, 10.0], ["birds", 860.0, -1.0, 10.0],
	["birds", 1336.0, 1.0, 10.0], ["birds", 1745.0, -1.0, 10.0], ["birds", 2128.0, 1.0, 10.0],
	["moose", 306.0, 0.0, 15.0],
	["bigfoot", 1772.0, 0.0, 21.0],
	["wrongway", 820.0, 0.0, 0.0],
]


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
const C_PLANK := Color("8a6a46")
const C_PLANK_DARK := Color("6d5236")
const C_ROOF_RED := Color("86302a")
const C_ROOF_TIN := Color("6c7680")
const C_WALL := Color("b9a98a")
const C_SAW := Color("b9c0c6")
const C_STEEL := Color("8a9096")
const C_STEEL_DARK := Color("5c6066")
const C_GLASS := Color("2c3a40")
const C_CAMO := Color("5b6b3a")
const C_FOREST_GREEN := Color("2f5d3a")


var stream: PackedVector3Array
var _stream_rect := Rect2()


func _init() -> void:
	stage_seed = SEED
	control = CONTROL
	route_scale = SCALE
	cp_fractions = CP_FRACTIONS
	gate_width = ROAD_HALF_WIDTH * 2 + 8
	ditch = DITCH
	road_half_width = ROAD_HALF_WIDTH
	shoulder = SHOULDER
	rng.seed = SEED
	srng.seed = SEED + 21
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
	map_mat.cull_mode = BaseMaterial3D.CULL_DISABLED # icon triangles come in either winding; it's only ever seen from above
	for id in ["pine_tall", "pine_default", "pine_round", "pine_small", "log", "log_large", "log_stack",
			"rock_a", "rock_c", "rock_small", "rock_tall", "stump", "bush", "bush_small", "grass",
			"campfire", "arch", "flag_red", "flag_green", "tent", "cone", "wreck", "skidder", "tent_camp", "fire_ring"]:
		meshes[id] = load(MESH_DIR + id + ".res")
	_cheap_meshes()

	_sample_centerline()
	_build_hash()
	track = Track.new()
	track.name = "PinePanic"
	track.track_id = "pine_panic"
	track.display_name = "Pine Panic"
	track.difficulty = "easy"
	track.biome = load("res://biomes/forest.tres")
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
	_scenery()
	_egg_spots()
	_spectators()
	_roadside()
	_index_clearings()
	_forest(bb)
	_ground_tints() # after the forest: shade follows the canopy
	_map_overlay()

	var err := _save(OUT)
	print("saved %s (err %d): %d samples, %.0f m, bounds %s, %d corners" % [OUT, err, n, track.length_m, bb, corners.size()])
	track.free()
	quit(0 if err == OK else 1)


# --- stream helpers -----------------------------------------------------------

func _stream_dist(x: float, z: float) -> float:
	if not _stream_rect.has_point(Vector2(x, z)):
		return INF
	var best := INF
	for p in stream:
		best = minf(best, Vector2(x - p.x, z - p.z).length())
	return best


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
	for sc in SCENERY:
		var i := clampi(int(float(sc[1]) / STEP), 0, n - 1)
		var sside: float = sc[2]
		if sside == 0.0:
			sside = -1.0 if _turn(i, 10) < 0 else 1.0 # outside of the bend
		var p := pts[i] + _right(i) * sside * float(sc[3])
		scenery_sites[sc[0]] = [i, sside, p]
		if float(sc[4]) > 0.0:
			flats.append([Vector2(p.x, p.z), float(sc[4])])
	# The fire tower stands on a knoll: higher than the crest the road takes.
	var tw: Vector3 = scenery_sites["tower"][2]
	mounds.append([Vector2(tw.x, tw.z), 22.0, 4.5])


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
	# Knolls rise from just past the ditch, on top of whatever's there.
	var mound := 0.0
	for m in mounds:
		var md := Vector2(x, z).distance_to(m[0])
		if md < m[1]:
			mound += float(m[2]) * (0.5 + 0.5 * cos(PI * md / float(m[1]))) * smoothstep(7.0, 21.0, d)
	if w_road <= 0.0:
		return t + mound
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
	return lerpf(t, road_h, w_road) + mound


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


# --- service park and stop control ----------------------------------------------


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


# --- scenery callouts --------------------------------------------------------------

## Smaller landmarks the Navigator can call (SCENERY): fire tower, hunting
## stand, logging landing, outhouse, wreck, forestry gate, campsite. Each is a
## track_landmark with a label and a map icon, solid where a car could reach
## it, and the trees keep out of its footprint. Placed off the road, past the
## ditch, so nothing narrows the road or sits on a recovery anchor.
func _scenery() -> void:
	_forestry_gate()
	_wreck()
	_fire_tower()
	_hunting_stand()
	_landing()
	_outhouse()
	_campsite()
	# Nothing near the three big landmarks, a checkpoint gate or a spectator spot.
	var big := [track.get_node("WoodenBridge"), _landmarks().get_node("RangerCabin"), _landmarks().get_node("Sawmill")]
	for id in scenery_sites:
		var site: Array = scenery_sites[id]
		var p: Vector3 = site[2]
		var nearest := INF
		for b in big:
			nearest = minf(nearest, Vector2(p.x, p.z).distance_to(Vector2(b.position.x, b.position.z)))
		var cp_gap := INF
		for k in CP_FRACTIONS.size():
			cp_gap = minf(cp_gap, absf(site[0] - int(CP_FRACTIONS[k] * n)) * STEP)
		print("  %-9s at %4.0f m, %s, %4.1f m off the road, %3.0f m from the nearest big landmark, %3.0f m from a checkpoint" % [
			id, site[0] * STEP, "right" if site[1] > 0 else "left", _road_dist(p.x, p.z), nearest, cp_gap])
		assert(nearest > 50.0 and cp_gap > 12.0)


## Forestry gate, swung open along the verge, and the forest's board facing
## the cars coming in. Right after the start.
func _forestry_gate() -> void:
	var site: Array = scenery_sites["gate"]
	var i: int = site[0]
	var side: float = site[1]
	var edge := half_w[i] + verge_w[i] + 0.5
	var p := _g(pts[i] + _right(i) * side * edge)
	var body := _solid("ForestryGate", "landmark", Transform3D(Basis.looking_at(tans[i], Vector3.UP), p), Vector3(0.6, 1.4, 0.6))
	var st := _st()
	# Hinge post, the striped bar folded back along the verge, its rest post.
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.65, 0)), Vector3(0.22, 1.3, 0.22), C_STEEL_DARK)
	const BAR := 5.4
	for k in 9:
		var z := 0.3 + k * BAR / 9.0
		_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.98, z + BAR / 18.0)), Vector3(0.13, 0.13, BAR / 9.0), C_TAPE_RED if k % 2 == 0 else C_TAPE_WHITE)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.45, BAR + 0.1)), Vector3(0.16, 0.9, 0.16), C_STEEL_DARK)
	# Opposite post with the latch: the road's other edge.
	var far := -side * (edge * 2.0)
	var right_local := Vector3(-1, 0, 0) # looking_at(tan): local +X is the road's left
	_box(st, Transform3D(Basis.IDENTITY, right_local * -far + Vector3(0, 0.65, 0)), Vector3(0.22, 1.3, 0.22), C_STEEL_DARK)
	# The board, off the road past the hinge, turned a little toward the
	# cars coming in and tilted back so it reads from above too.
	var board_at := Vector3(side * 2.6, 0, -1.8)
	var bxf := Transform3D(Basis(Vector3.UP, -side * 0.4), board_at)
	for x in [-1.3, 1.3]:
		_box(st, bxf * Transform3D(Basis.IDENTITY, Vector3(x, 1.1, 0)), Vector3(0.16, 2.2, 0.16), C_LOG_DARK)
	var tilt := Basis(Vector3.RIGHT, deg_to_rad(-18))
	_box(st, bxf * Transform3D(tilt, Vector3(0, 1.85, 0.1)), Vector3(3.2, 1.3, 0.1), C_FOREST_GREEN)
	_box(st, bxf * Transform3D(tilt, Vector3(0, 1.85, 0.06)), Vector3(3.36, 1.46, 0.06), Color("e9dfc4"))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	var label := Label3D.new()
	label.name = "Sign"
	label.text = "PINE PANIC\nSTATE FOREST"
	label.font_size = 56
	label.pixel_size = 0.0085
	label.outline_size = 0
	label.modulate = Color("f2e6c8")
	label.transform = bxf * Transform3D(tilt, Vector3(0, 1.85, 0.17))
	body.add_child(label)
	clearings.append([Vector2(p.x, p.z), 2.5])
	var bw := body.transform * board_at
	clearings.append([Vector2(bw.x, bw.z), 3.0])
	var tail := body.transform * Vector3(0, 0, BAR)
	clearings.append([Vector2(tail.x, tail.z), 1.5])
	_callout(body, "forestry gate", site, "gate", Color("f1c40f"))


## A rusted sedan nose-down in the ferns, just past the ditch.
func _wreck() -> void:
	var site: Array = scenery_sites["wreck"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.32)
	var yaw := Basis.looking_at(tans[i], Vector3.UP).rotated(Vector3.UP, site[1] * 1.15)
	var basis := yaw * Basis(Vector3.FORWARD, deg_to_rad(7.0)) * Basis(Vector3.RIGHT, deg_to_rad(-6.0))
	var body := _solid("Wreck", "landmark", Transform3D(basis, p), Vector3(2.6, 1.2, 4.4))
	body.add_child(_mesh_node("Mesh", meshes["wreck"]))
	# Ferns over the sills and wheel arches: about half the car is under them.
	var st := _st()
	for k in 16:
		var a := TAU * k / 16.0 + srng.randf_range(-0.2, 0.2)
		var r := Vector2(1.5 * absf(cos(a)) + 0.4, 2.4 * absf(sin(a)) + 0.4).length() * srng.randf_range(0.55, 0.85)
		var q := Vector3(cos(a) * minf(r, 1.9), 0.25, sin(a) * minf(r * 1.3, 2.7))
		var s := srng.randf_range(1.5, 2.3)
		_merge(st, meshes["fern"], Transform3D(Basis(Vector3.UP, srng.randf() * TAU).scaled(Vector3(s, s * 1.15, s)), q), Color(1, 1, 1).darkened(srng.randf_range(0.0, 0.15)))
	for k in 6:
		var q := Vector3(srng.randf_range(-2.6, 2.6), 0.3, srng.randf_range(-3.2, 3.2))
		var s := srng.randf_range(1.2, 1.8)
		_merge(st, meshes["fern"], Transform3D(Basis(Vector3.UP, srng.randf() * TAU).scaled(Vector3.ONE * s), q))
	var ferns := _mesh_node("Ferns", _commit(st))
	ferns.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(ferns)
	clearings.append([Vector2(p.x, p.z), 4.6])
	_callout(body, "wrecked car", site, "wreck", Color("c0392b"))


## Steel fire-watch tower on a knoll by the stage's highest crest: 23 m to
## the cab roof, a red beacon that pulses slowly (3.2 s, never flashes).
## Above the canopy, so it's the one thing you can see coming at eye level;
## EyeForest draws a haze silhouette of it past the far plane.
func _fire_tower() -> void:
	var site: Array = scenery_sites["tower"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.1)
	var body := _solid("FireTower", "landmark", Transform3D(_facing_road(i, p), p), Vector3(5.8, 3.0, 5.8))
	var st := _st()
	const H := 19.0
	const B := 2.6
	const T := 1.55
	var at := func(sx: float, sz: float, y: float) -> Vector3:
		var w := lerpf(B, T, y / H)
		return Vector3(sx * w, y, sz * w)
	var corners := [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]]
	for c in corners:
		_beam(st, at.call(c[0], c[1], -0.4), at.call(c[0], c[1], H), 0.26, C_STEEL)
		_box(st, Transform3D(Basis.IDENTITY, at.call(c[0], c[1], 0.15)), Vector3(0.7, 0.3, 0.7), Color("7c7a74")) # footing
	var levels := [0.4, 6.5, 12.8, H]
	for f in 4:
		var c0: Array = corners[f]
		var c1: Array = corners[(f + 1) % 4]
		for l in range(1, levels.size()):
			_beam(st, at.call(c0[0], c0[1], levels[l]), at.call(c1[0], c1[1], levels[l]), 0.14, C_STEEL_DARK)
			_beam(st, at.call(c0[0], c0[1], levels[l - 1]), at.call(c1[0], c1[1], levels[l]), 0.09, C_STEEL)
			_beam(st, at.call(c1[0], c1[1], levels[l - 1]), at.call(c0[0], c0[1], levels[l]), 0.09, C_STEEL)
	# Zig-zag stairs up the middle, so it reads as climbable, not a pylon.
	for k in 6:
		var y0 := k * H / 6.0
		var x := 0.7 if k % 2 == 0 else -0.7
		_beam(st, Vector3(x, y0, -0.6), Vector3(-x, y0 + H / 6.0, -0.6), 0.5, C_PLANK_DARK)
	# Cab: deck, wooden walls, a band of windows all round, red pyramid roof.
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 0.1, 0)), Vector3(4.4, 0.25, 4.4), C_PLANK_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 1.35, 0)), Vector3(3.4, 2.4, 3.4), C_PLANK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 1.75, 0)), Vector3(3.48, 0.95, 3.48), C_GLASS)
	for x in [-2.15, 2.15]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, H + 0.75, 0)), Vector3(0.08, 0.08, 4.4), C_STEEL_DARK)
		_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 0.75, x)), Vector3(4.4, 0.08, 0.08), C_STEEL_DARK)
	var roof := CylinderMesh.new()
	roof.top_radius = 0.0
	roof.bottom_radius = 3.1
	roof.height = 1.5
	roof.radial_segments = 4
	roof.rings = 1
	roof.cap_bottom = true
	_prim(st, roof, Transform3D(Basis(Vector3.UP, PI * 0.25), Vector3(0, H + 3.3, 0)), C_ROOF_RED)
	# Beacon lamp on a short mast above the roof.
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 4.3, 0)), Vector3(0.1, 1.0, 0.1), C_STEEL_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 4.9, 0)), Vector3(0.42, 0.42, 0.42), C_BEACON)
	var mesh := _commit(st)
	body.add_child(_mesh_node("Mesh", mesh))
	body.add_child(_glow("Beacon", 3.2, _glow_mat(Color(1.0, 0.25, 0.15), 1.4, 3.2, Vector2(180.0, 400.0)), Vector3(0, H + 4.9, 0)))
	body.add_to_group("track_tall", true)
	body.set_meta("proxy_mesh", mesh)
	clearings.append([Vector2(p.x, p.z), 6.5])
	_callout(body, "fire tower", site, "tower", Color("ecf0f1"))
	print("fire tower: base %.1f m, %.1f m above the road beside it" % [p.y, p.y - pts[i].y])


## Hunting stand at the forest edge: four legs, a camo box with a slot
## facing the road, a ladder.
func _hunting_stand() -> void:
	var site: Array = scenery_sites["stand"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.05)
	var body := _solid("HuntingStand", "landmark", Transform3D(_facing_road(i, p), p), Vector3(2.2, 3.0, 2.2))
	var st := _st()
	const Y := 3.6
	for c in [[-1, -1], [1, -1], [1, 1], [-1, 1]]:
		_beam(st, Vector3(c[0] * 1.05, -0.2, c[1] * 1.05), Vector3(c[0] * 0.8, Y, c[1] * 0.8), 0.16, C_LOG_DARK)
	_beam(st, Vector3(-1.0, 1.6, 1.0), Vector3(1.0, 1.6, 1.0), 0.09, C_LOG)
	_beam(st, Vector3(-1.0, 1.6, -1.0), Vector3(1.0, 1.6, -1.0), 0.09, C_LOG)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, Y, 0)), Vector3(2.0, 0.14, 2.0), C_PLANK_DARK)
	var camo := [C_CAMO, C_CAMO.darkened(0.25), Color("6e6440")]
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, Y + 0.7, -0.9)), Vector3(1.9, 1.4, 0.08), camo[0])
	for x in [-0.92, 0.92]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, Y + 0.7, 0)), Vector3(0.08, 1.4, 1.9), camo[1])
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, Y + 0.35, 0.92)), Vector3(1.9, 0.7, 0.08), camo[0])
	for x in [-0.8, 0.8]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, Y + 1.15, 0.92)), Vector3(0.3, 0.5, 0.08), camo[2])
	for k in 5: # camo blotches
		_box(st, Transform3D(Basis.IDENTITY, Vector3(srng.randf_range(-0.6, 0.6), Y + srng.randf_range(0.2, 1.2), -0.95)), Vector3(0.45, 0.3, 0.03), camo[2 if k % 2 else 1])
	_box(st, Transform3D(Basis(Vector3.RIGHT, deg_to_rad(10)), Vector3(0, Y + 1.5, 0.05)), Vector3(2.3, 0.1, 2.4), C_ROOF_TIN.darkened(0.2))
	# Ladder up the road side.
	var l0 := Vector3(0, -0.1, 2.0)
	var l1 := Vector3(0, Y, 0.95)
	for x in [-0.28, 0.28]:
		_beam(st, l0 + Vector3(x, 0, 0), l1 + Vector3(x, 0, 0), 0.07, C_LOG)
	for k in 8:
		var q := l0.lerp(l1, (k + 0.5) / 8.0)
		_box(st, Transform3D(Basis.IDENTITY, q), Vector3(0.6, 0.05, 0.05), C_LOG)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	clearings.append([Vector2(p.x, p.z), 3.0])
	_callout(body, "hunting stand", site, "stand", Color("7d9a3a"))


## Logging landing: stacked logs beside the road and the skidder that
## dragged them out, rusting where it stopped.
func _landing() -> void:
	var site: Array = scenery_sites["landing"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.05)
	# +Z toward the road, so the piles line up along it (local X).
	var body := _solid("LogLanding", "landmark", Transform3D(_facing_road(i, p), p), Vector3(10.0, 1.8, 3.6))
	for k in 3:
		var lp := Vector3(-3.4 + k * 3.4, 0, srng.randf_range(-0.3, 0.3))
		body.add_child(_mesh_node("Logs%d" % k, meshes["log_stack"], Transform3D(Basis(Vector3.UP, PI * 0.5 + srng.randf_range(-0.06, 0.06)), lp)))
	body.add_child(_mesh_node("Log", meshes["log_large"], Transform3D(Basis(Vector3.UP, 0.15), Vector3(-1.0, 0, 2.6))))
	var sk := Transform3D(Basis(Vector3.UP, -PI * 0.5 - 0.35), Vector3(8.4, 0, -0.6))
	body.add_child(_mesh_node("Skidder", meshes["skidder"], sk))
	var cs := CollisionShape3D.new()
	cs.name = "SkidderShape"
	var bs := BoxShape3D.new()
	bs.size = Vector3(3.2, 2.6, 4.6)
	cs.shape = bs
	cs.transform = sk * Transform3D(Basis.IDENTITY, Vector3(0, 1.3, 0))
	body.add_child(cs)
	clearings.append([Vector2(p.x, p.z), 7.0])
	var skw := body.transform * sk.origin
	clearings.append([Vector2(skw.x, skw.z), 4.0])
	_callout(body, "log pile", site, "logs", Color("a0522d"))


## The outhouse. A plank box, a tin lean-to roof, a moon in the door.
func _outhouse() -> void:
	var site: Array = scenery_sites["outhouse"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.05)
	var body := _solid("Outhouse", "landmark", Transform3D(_facing_road(i, p), p), Vector3(1.5, 2.4, 1.5))
	var st := _st()
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 1.1, 0)), Vector3(1.4, 2.2, 1.4), C_PLANK)
	for k in 5:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(-0.56 + k * 0.28, 1.1, 0.71)), Vector3(0.04, 2.2, 0.02), C_PLANK_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 1.0, 0.72)), Vector3(0.8, 1.8, 0.04), C_PLANK_DARK)
	_box(st, Transform3D(Basis(Vector3.BACK, 0.5), Vector3(0.05, 1.6, 0.75)), Vector3(0.1, 0.22, 0.02), C_STRAW) # the moon, roughly
	_box(st, Transform3D(Basis(Vector3.BACK, -0.5), Vector3(-0.03, 1.6, 0.75)), Vector3(0.1, 0.22, 0.02), C_STRAW)
	_box(st, Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-12)), Vector3(0, 2.32, 0.05)), Vector3(1.7, 0.08, 1.8), C_ROOF_TIN)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	clearings.append([Vector2(p.x, p.z), 3.6])
	_callout(body, "outhouse", site, "outhouse", Color("d4b483"))


## A camper's tent with a small fire in a stone ring. The flame and its
## glow are on the 3D-only layer (they flicker; the map is one still image).
## The campers themselves are easter eggs: markers here, people at runtime.
func _campsite() -> void:
	var site: Array = scenery_sites["camp"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.05)
	var basis := _facing_road(i, p)
	var body := _solid("Campsite", "landmark", Transform3D(basis, p), Vector3(4.2, 2.6, 3.4), Vector3(0, 0, -1.5))
	body.add_child(_mesh_node("Tent", meshes["tent_camp"], Transform3D(Basis(Vector3.UP, 0.0), Vector3(0, 0, -1.5))))
	var fire := Vector3(0.6, 0, 2.6)
	body.add_child(_mesh_node("FireRing", meshes["fire_ring"], Transform3D(Basis.IDENTITY, fire)))
	body.add_child(_mesh_node("Campfire", meshes["campfire"], Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.6), fire)))
	body.add_child(_mesh_node("Bench", meshes["log"], Transform3D(Basis(Vector3.UP, PI * 0.5).scaled(Vector3.ONE * 0.45), fire + Vector3(-2.0, 0, 0.3))))
	# Flame: three crossed quads that sway in the shader; a glow sprite over it.
	var st := _st()
	for k in 3:
		var b := Basis(Vector3.UP, k * PI / 3.0)
		var v := [Vector3(-0.35, 0, 0), Vector3(0.35, 0, 0), Vector3(0.35, 0.9, 0), Vector3(-0.35, 0.9, 0)]
		var uv := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
		for t in [0, 1, 2, 0, 2, 3]:
			st.set_uv(uv[t])
			st.set_normal(b * Vector3.BACK)
			st.add_vertex(b * v[t])
	var flame := _mesh_node("Flame", st.commit(), Transform3D(Basis.IDENTITY, fire + Vector3(0, 0.1, 0)), RENDER_EGG)
	flame.material_override = _glow_mat(Color(1.0, 0.55, 0.15), 1.2, 0.0, Vector2(60.0, 115.0), true)
	flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(flame)
	body.add_child(_glow("Glow", 3.0, _glow_mat(Color(1.0, 0.5, 0.18), 0.55, 0.0, Vector2(60.0, 115.0)), fire + Vector3(0, 0.6, 0)))
	for k in 2:
		var m := Marker3D.new()
		m.name = "Camper%d" % k
		var cp := fire + Vector3(-1.5 if k == 0 else 2.0, 0, -0.6 if k == 0 else 0.4)
		m.transform = Transform3D(Basis.looking_at(Vector3(0, 0, 1).rotated(Vector3.UP, -0.4 if k == 0 else 0.5), Vector3.UP), cp)
		m.add_to_group("track_egg", true)
		m.set_meta("kind", "camper")
		body.add_child(m)
	clearings.append([Vector2(p.x, p.z), 8.0])
	yards.append([Vector2(p.x, p.z), 6.5, C_YARD.lerp(C_GRASS, 0.5)])
	_callout(body, "campsite", site, "tent", Color("ff7f2a"))


# --- easter-egg spots ---------------------------------------------------------------

## Markers for scripts/easter_eggs.gd (group track_egg, meta kind). Deer
## markers sit on the centreline, facing along the road, with meta "edge"
## (metres to the forest); the rest sit where the creature does. The fake
## junction for the wrong-way sign is real gravel (3D layer only), so the
## sign has something to point down.
func _egg_spots() -> void:
	var g := _group("EggSpots")
	var k := 0
	for spot in EGG_SPOTS:
		var kind: String = spot[0]
		var i := clampi(int(float(spot[1]) / STEP), 0, n - 1)
		var side: float = spot[2]
		if side == 0.0:
			side = -1.0 if _turn(i, 10) < 0 else 1.0
		var m := Marker3D.new()
		m.name = "%s%d" % [kind.capitalize().replace(" ", ""), k]
		m.add_to_group("track_egg", true)
		m.set_meta("kind", kind)
		m.set_meta("distance_m", i * STEP)
		m.set_meta("side", side)
		m.set_meta("edge", half_w[i] + verge_w[i] + DITCH)
		var p := pts[i] + _right(i) * side * float(spot[3])
		p = _g(p)
		m.transform = Transform3D(Basis.looking_at(tans[i], Vector3.UP), p)
		match kind:
			"moose":
				# A glade from the road edge to where it stands, so it can be seen.
				m.transform = Transform3D(_facing_road(i, p), p)
				for s in 6:
					var q := pts[i] + _right(i) * side * lerpf(8.0, float(spot[3]) + 4.0, s / 5.0)
					clearings.append([Vector2(q.x, q.z), 5.5])
				yards.append([Vector2(p.x, p.z), 9.0, C_GRASS.darkened(0.05)])
				# ...and a lane back along the approach: the glade alone only
				# opens once you're level with it, which is too late to look.
				_sightline([i, side, p])
			"bigfoot":
				m.transform = Transform3D(_facing_road(i, p), p)
				clearings.append([Vector2(p.x, p.z), 1.6])
				var walk := p + tans[i] * 5.0
				clearings.append([Vector2(walk.x, walk.z), 1.4])
			"wrongway":
				_fake_junction(g, m, i, side)
		g.add_child(m)
		k += 1
	print("egg spots: %d" % k)


## Gravel spur forking off at 35 deg into the trees and fading out after
## 24 m: a junction that goes nowhere. Render layer 5 only.
func _fake_junction(g: Node3D, m: Marker3D, i: int, side: float) -> void:
	var edge := half_w[i] + verge_w[i]
	var dir := tans[i].rotated(Vector3.UP, -side * deg_to_rad(35.0)).normalized()
	var start := pts[i] + _right(i) * side * (edge - 0.6)
	var st := _st()
	const LEN := 24.0
	var segs := 12
	for s in segs:
		var t0 := float(s) / segs
		var t1 := float(s + 1) / segs
		var c0 := start + dir * LEN * t0
		var c1 := start + dir * LEN * t1
		var r := Vector3(-dir.z, 0, dir.x)
		var w0 := lerpf(2.2, 1.3, t0)
		var w1 := lerpf(2.2, 1.3, t1)
		var col0 := C_TRACK.lerp(C_FLOOR_REF, smoothstep(0.3, 1.0, t0))
		var col1 := C_TRACK.lerp(C_FLOOR_REF, smoothstep(0.3, 1.0, t1))
		var a := _g(c0 - r * w0, 0.06)
		var b := _g(c0 + r * w0, 0.06)
		var c := _g(c1 - r * w1, 0.06)
		var d := _g(c1 + r * w1, 0.06)
		for v in [[a, col0], [c, col1], [b, col0], [b, col0], [c, col1], [d, col1]]:
			st.set_color(v[1])
			st.set_normal(terrain.normal_at(v[0].x, v[0].z))
			st.add_vertex(v[0])
		clearings.append([Vector2(c1.x, c1.z), 3.2])
	var spur := _mesh_node("FakeJunction", _commit(st), Transform3D.IDENTITY, RENDER_EGG)
	spur.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(spur)
	# The sign stands in the fork's mouth, facing the cars coming (the
	# marker looks down the road); its arrow points along the spur.
	var at := _g(start + dir * 1.8 + _right(i) * side * 1.6)
	# Turned a little toward the oncoming car so the board isn't edge-on.
	m.transform = Transform3D(Basis.looking_at(tans[i].rotated(Vector3.UP, side * 0.35), Vector3.UP), at)
	clearings.append([Vector2(at.x, at.z), 2.4])
	_sightline([i, side, at])


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


# --- cheap scenery meshes -----------------------------------------------------------


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
	_callout_icon_layer(g, y)


