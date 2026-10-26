extends "res://tools/stage_builder.gd"
## Generates scenes/tracks/dust_devil.scn: Dust Devil, the medium stage
## (spec §6: desert canyon, sandy shoulder, deceptive forks; stone arch, fuel
## drums, radio tower). Deterministic. Run after tools/bake_assets.gd:
##   godot --headless --path . --script res://tools/build_dust_devil.gd
##
## Red dirt cut into a plateau. The road runs in a network of canyons and one
## wide basin: start canyon, the slot canyon north, the basin (stone arch at
## its mouth, the fuel depot, a butte the road splits around), the climb, the
## descent to the finish. Everything outside the floors is plateau behind
## cliffs too steep to drive (that's the eye-level cover, and it's also what
## keeps the forks honest: see SPURS).
##
## Terrain, one height per 4 m vertex: the floor (the road's own height,
## blended between nearby samples, plus low dunes away from it), the plateau
## (the floor's height plus the section's wall height, blurred so it doesn't
## step between branches), and a wall between them where the floor runs out.
## Floor half width and wall height are per section along the stage.
##
## Saved binary, like Pine Panic: it's mostly numbers.

const OUT := "res://scenes/tracks/dust_devil.scn"
const BIOME := "res://biomes/desert.tres"
const SEED := 23
const SCALE := 1.25
const ROAD_HALF_WIDTH := 3.2 ## a touch wider than the forest's: it's faster
const SHOULDER := 1.5 ## loose sand verge, both sides: surface "sand"
const BERM := 1.1 ## sand windrowed past the verge by the grader (the base's "ditch")
const APRON := 1.4
## Metres over which a wall rises from floor to plateau: about a terrain
## cell, so every triangle on a wall's face is far past what the car can
## stand on (CarController is a CharacterBody3D: floor_max_angle 45 deg).
const WALL_W := 4.5
## Steepest ground the gate check lets the car drive (gradient; 46 deg, a
## shade more than the car manages, so the check errs towards finding leaks).
const MAX_GRADE := 1.036

## Route control points (x, z), start to finish, before SCALE. South-west
## start, east along the start canyon, north up the slot canyon, east across
## the basin, round the north and down to the finish in the west.
const CONTROL := [
	Vector2(-450, 300), Vector2(-415, 298), Vector2(-380, 285), Vector2(-345, 296), Vector2(-312, 315),
	Vector2(-280, 308), Vector2(-258, 282), Vector2(-232, 265), Vector2(-200, 268), Vector2(-175, 288),
	Vector2(-140, 296), Vector2(-105, 290), Vector2(-80, 292),
	Vector2(-66, 270), Vector2(-80, 240), Vector2(-52, 220), Vector2(-78, 192), Vector2(-50, 165),
	Vector2(-62, 128), Vector2(-40, 100), Vector2(-62, 70), Vector2(-50, 40),
	Vector2(-35, 10), Vector2(-5, -15), Vector2(35, -20), Vector2(70, -5), Vector2(110, -15),
	Vector2(150, -40), Vector2(185, -45), Vector2(212, -72), Vector2(240, -98), Vector2(247, -128), Vector2(220, -150),
	Vector2(225, -185), Vector2(200, -215), Vector2(165, -205), Vector2(130, -218), Vector2(118, -240),
	Vector2(140, -262), Vector2(165, -282), Vector2(150, -305), Vector2(118, -298), Vector2(85, -280),
	Vector2(50, -262), Vector2(20, -275), Vector2(-15, -300), Vector2(-50, -285), Vector2(-70, -255),
	Vector2(-100, -240), Vector2(-135, -262), Vector2(-170, -250),
	Vector2(-200, -225), Vector2(-230, -200), Vector2(-250, -165), Vector2(-285, -150), Vector2(-310, -120),
	Vector2(-330, -85), Vector2(-365, -70), Vector2(-400, -75),
]
## Spurs: real road that leaves the stage and goes nowhere useful. Each
## leaves where `from` is nearest the centreline, at most ~30 deg off the
## road's heading (so from the car it reads as the road carrying on), through
## `via` (before SCALE). A dead end stops in a box canyon; the loop comes
## back to the road at `to`. No checkpoint sits between a loop's two ends,
## and the dead ends are walled in, so no spur can skip a checkpoint (the
## builder floods the terrain from each gate to prove it; so do the tests).
const SPURS := [
	{"name": "MineRoad", "kind": "dead_end", "from": Vector2(-80, 292),
		"via": [Vector2(-50, 296), Vector2(-15, 288), Vector2(20, 298), Vector2(50, 290)], "rise": 3.0, "F": 10.0, "H": 16.0},
	{"name": "ButteLoop", "kind": "loop", "from": Vector2(212, -72),
		"via": [Vector2(205, -110)], "to": Vector2(220, -150), "rise": 1.5, "F": 30.0, "H": 13.0},
	{"name": "TowerRoad", "kind": "dead_end", "from": Vector2(-135, -262),
		"via": [Vector2(-160, -285), Vector2(-180, -310), Vector2(-205, -322)], "rise": 6.0, "F": 11.0, "H": 15.0},
]
## Canyon sections along the stage: [metres, floor half width F, wall height H].
## Linear between keys. F is from the centreline to the foot of the wall.
const SECTIONS := [
	[0.0, 26.0, 13.0], [60.0, 13.0, 13.0], [480.0, 13.0, 14.0], [540.0, 9.5, 16.0],
	[860.0, 9.5, 17.0], [930.0, 12.0, 15.0], [990.0, 36.0, 13.0], [1400.0, 36.0, 13.0],
	[1470.0, 12.0, 14.0], [2050.0, 12.0, 15.0], [2120.0, 14.0, 13.0], [2560.0, 14.0, 13.0], [2620.0, 24.0, 13.0],
]
## Height profile: cosine bumps [centre m, half length m, rise m] and ramps
## [start m, end m, rise m]. Crests in the start canyon, the long climb.
const PROFILE := [
	[140.0, 38.0, 2.6], [250.0, 42.0, -3.0], [370.0, 36.0, 3.4], [455.0, 30.0, -1.8],
	[640.0, 45.0, 2.2], [760.0, 40.0, -2.4], [1100.0, 70.0, 1.6],
	[1560.0, 30.0, 2.8], [1690.0, 34.0, -2.2], [1840.0, 30.0, 3.0], [2230.0, 34.0, 3.2], [2380.0, 36.0, -2.6],
]
const RAMPS := [[1480.0, 2020.0, 16.0], [2120.0, 2560.0, -11.0]]
## Checkpoints by stage metres: in canyon, never between a loop's ends.
const CP_AT := [330.0, 880.0, 1560.0, 1900.0, 2300.0]
const ARCH_AT := 945.0
const DEPOT_AT := 1130.0
## Smaller callouts: [id, stage metres, side (0 = outside of the bend),
## metres off the centreline, flat-ground radius].
const SCENERY := [
	["windpump", 420.0, 0.0, 12.0, 8.0],
	["shack", 1045.0, 0.0, 15.0, 9.0],
	["wreck", 1700.0, 0.0, 7.4, 0.0],
	["tank", 2440.0, 0.0, 11.0, 8.0],
]
## Easter-egg spots: [kind, stage metres, side, metres off the centreline].
const EGG_SPOTS := [
	["tumbleweed", 205.0, 0.0, 0.0], ["tumbleweed", 600.0, 0.0, 0.0], ["tumbleweed", 1010.0, 0.0, 0.0],
	["tumbleweed", 1490.0, 0.0, 0.0], ["tumbleweed", 1985.0, 0.0, 0.0], ["tumbleweed", 2400.0, 0.0, 0.0],
	["roadrunner", 150.0, 1.0, 0.0], ["roadrunner", 1200.0, -1.0, 0.0], ["roadrunner", 2180.0, 1.0, 0.0],
	["vultures", 1170.0, 0.0, 24.0], ["vultures", 1760.0, 0.0, 26.0],
	["skull", -1.0, 0.0, 0.0], # at the mine road's mouth
	["ufo", 1290.0, 0.0, 0.0], # in the basin, well off the road
]

## Palette (sRGB).
const C_CROWN := Color("a87b58")
const C_TRACK := Color("9a6e4e")
const C_RUT := Color("80583f")
const C_VERGE := Color("bf9670")
const C_BERM := Color("c9a27a")
const C_SAND := Color("b98c66")
const C_YARD := Color("b08660")
const C_FLOOR_REF := Color("5a4a36") ## ground.gdshader's REF: tints are value relative to it
const C_PLANK := Color("9a7a55")
const C_PLANK_DARK := Color("6f5538")
const C_TIN := Color("9aa0a4")
const C_RUST := Color("8a4a2a")
const C_STEEL := Color("8a9096")
const C_STEEL_DARK := Color("5c6066")
const C_WHITE := Color("e8e2d4")
const C_RED := Color("b8352a")
const C_ROCK := Color("a3573a")
const C_ROCK_DARK := Color("7c3f2a")


var spurs: Array = [] # {name, kind, pts, tans, h, F, H, j, k, len, keep}
var all_xz := PackedVector2Array() # every road sample, main then spurs
var all_h := PackedFloat32Array() # its height before baking
var all_bank := PackedFloat32Array()
var all_tan := PackedVector2Array()
var all_F := PackedFloat32Array()
var all_H := PackedFloat32Array()
var _ahash := {}
var _near := PackedInt32Array() # per terrain vertex: nearest road sample (all_*)
var _plateau := PackedFloat32Array()
var _grid_origin := Vector2.ZERO
var _gw := 0
var _gd := 0
var mesas: Array = [] # [Vector2 centre, radius, height]
var wall_noise := FastNoiseLite.new()
var dune_noise := FastNoiseLite.new()
var depot_spot: Array
var ufo_spot: Array # [sample, side, Vector3]
var arch_i := 0


func _init() -> void:
	stage_seed = SEED
	control = CONTROL
	route_scale = SCALE
	wobble = 0.9
	kink_count = 11
	gate_width = 20.0
	ditch = BERM
	road_half_width = ROAD_HALF_WIDTH
	shoulder = SHOULDER
	verge_surface = "sand"
	terrain_flips = true # the canyon walls run every which way across the grid
	rng.seed = SEED
	srng.seed = SEED + 21
	noise.seed = SEED
	noise.frequency = 0.02
	wall_noise.seed = SEED + 31
	wall_noise.frequency = 0.045
	dune_noise.seed = SEED + 37
	dune_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	dune_noise.frequency = 0.03
	vc_mat = load(VC_MAT)
	road_mat = ShaderMaterial.new()
	road_mat.shader = load(ROAD_SHADER)
	terrain = Terrain.new()
	terrain.name = "Ground"
	map_mat = StandardMaterial3D.new()
	map_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	map_mat.vertex_color_use_as_albedo = true
	map_mat.vertex_color_is_srgb = true
	map_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	for id in ["saguaro", "cactus_short", "red_rock_b", "red_rock_d", "red_rock_e", "hoodoo_b", "hoodoo_g",
			"hoodoo_h", "hoodoo_e", "pebble", "flat_rock", "scrub", "scrub_tri", "dry_grass", "sand_rock_a",
			"sand_rock_b", "drums", "drum", "drum_yellow", "dish", "radio_box", "wreck", "arch", "flag_red",
			"flag_green", "tent", "cone", "signpost"]:
		meshes[id] = load(MESH_DIR + id + ".res")

	_sample_centerline()
	_build_hash()
	cp_fractions = []
	for m in CP_AT:
		cp_fractions.append((float(m) / STEP + 0.5) / n)
	track = Track.new()
	track.name = "DustDevil"
	track.track_id = "dust_devil"
	track.display_name = "Dust Devil"
	track.difficulty = "medium"
	track.biome = load(BIOME)
	track.centerline = pts
	track.length_m = (n - 1) * STEP
	_find_corners()
	_plan()
	_shape_road()
	_build_spurs()
	var bb := _road_bounds()
	for s in spurs:
		for p in s.pts:
			bb = bb.expand(Vector2(p.x, p.z))
	bb = bb.grow(30.0)
	track.bounds = bb
	_plan_sites()
	_collect_samples()
	var extra := PackedVector3Array()
	for s in spurs:
		extra.append_array(s.pts)
	_build_dist_grid(bb.grow(90.0), extra)
	_prepare_grid(bb)
	_bake_heights(bb)
	for s in spurs:
		var sp: PackedVector3Array = s.pts
		for i in sp.size():
			sp[i].y = terrain.height_at(sp[i].x, sp[i].z)
		s.pts = sp
	track.centerline = pts
	_env()
	_road()
	_spur_roads()
	_world_walls(bb)
	_markers()
	_forks()
	_arches()
	_service_and_stop()
	_corner_furniture()
	_merge_chevrons()
	_stone_arch()
	_fuel_depot()
	_radio_tower()
	_mine()
	_scenery()
	_egg_spots()
	_spectators()
	_index_clearings()
	_scatter(bb)
	_ground_tints()
	_map_overlay()
	var leaks := _check_gates()

	var err := _save(OUT)
	print("saved %s (err %d): %d samples, %.0f m, bounds %s, %d corners, %d gate leaks" % [OUT, err, n, track.length_m, bb, corners.size(), leaks])
	track.free()
	quit(0 if err == OK and leaks == 0 else 1)


# --- road shape ------------------------------------------------------------------

func _section(s: float) -> Vector2:
	for k in SECTIONS.size() - 1:
		var a: Array = SECTIONS[k]
		var b: Array = SECTIONS[k + 1]
		if s <= b[0]:
			var t := clampf((s - float(a[0])) / (float(b[0]) - float(a[0])), 0.0, 1.0)
			return Vector2(lerpf(a[1], b[1], t), lerpf(a[2], b[2], t))
	var last: Array = SECTIONS[SECTIONS.size() - 1]
	return Vector2(last[1], last[2])


func _profile_at(s: float) -> float:
	var h := 0.0
	for p in PROFILE:
		h += float(p[2]) * _bump(s, p[0], p[1])
	for r in RAMPS:
		h += float(r[2]) * smoothstep(float(r[0]), float(r[1]), s)
	return h


## Width, verge, height and camber per sample, smoothed along the stage.
func _shape_road() -> void:
	var wn := FastNoiseLite.new()
	wn.seed = SEED + 7
	wn.frequency = 1.0
	var raw_w := PackedFloat32Array()
	var raw_b := PackedFloat32Array()
	for i in n:
		var s := i * STEP
		var r := _radius(i)
		raw_w.append(ROAD_HALF_WIDTH + wn.get_noise_1d(s / 70.0) * 0.35 + 0.4 * (1.0 - smoothstep(18.0, 30.0, r)))
		raw_b.append(signf(_turn(i)) * 0.035 * (1.0 - smoothstep(30.0, 90.0, r)))
		profile_h.append(_profile_at(s))
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
		# The sand verge breathes: wide where the grader got lazy.
		verge_w.append(clampf(SHOULDER + wn.get_noise_1d(i * STEP / 31.0 + 100.0) * 0.6, 0.8, 2.3))


## Spur centrelines, from the stage's own samples at the junctions.
func _build_spurs() -> void:
	for def in SPURS:
		var from: Vector2 = def.from * SCALE
		var j := _nearest_sample(from.x, from.y)
		var p0 := Vector2(pts[j].x, pts[j].z)
		var via: Array = def.via
		var first: Vector2 = via[0] * SCALE
		var t0 := tans[j]
		var a := t0.signed_angle_to(Vector3(first.x - p0.x, 0, first.y - p0.y), Vector3.UP)
		var d0 := t0.rotated(Vector3.UP, clampf(a, -0.5, 0.5))
		var c: Array[Vector2] = [p0, p0 + Vector2(d0.x, d0.z) * 16.0]
		for v in via:
			c.append(v * SCALE)
		var k := -1
		if def.kind == "loop":
			var to: Vector2 = def.to * SCALE
			k = _nearest_sample(to.x, to.y)
			var pk := Vector2(pts[k].x, pts[k].z)
			var prev: Vector2 = c[c.size() - 1]
			var ak := tans[k].signed_angle_to(Vector3(pk.x - prev.x, 0, pk.y - prev.y), Vector3.UP)
			var dk := tans[k].rotated(Vector3.UP, clampf(ak, -0.5, 0.5))
			c.append(pk - Vector2(dk.x, dk.z) * 16.0)
			c.append(pk)
		c.push_front(c[0] * 2.0 - c[1])
		c.append(c[c.size() - 1] * 2.0 - c[c.size() - 2])
		var dense: Array[Vector2] = []
		for i in range(1, c.size() - 2):
			for q in 40:
				dense.append(_catmull(c[i - 1], c[i], c[i + 1], c[i + 2], q / 40.0))
		dense.append(c[c.size() - 2])
		var line := _resample(dense)
		if def.kind == "loop":
			line.append(Vector2(pts[k].x, pts[k].z))
		var sp := PackedVector3Array()
		for p in line:
			sp.append(Vector3(p.x, 0, p.y))
		var st := PackedVector3Array()
		var m := sp.size()
		var h := PackedFloat32Array()
		var length := (m - 1) * STEP
		for i in m:
			st.append((sp[mini(i + 1, m - 1)] - sp[maxi(i - 1, 0)]).normalized())
			var s := i * STEP
			var y: float
			if def.kind == "loop":
				y = lerpf(profile_h[j], profile_h[k], s / length) + float(def.rise) * _bump(s, length * 0.5, length * 0.45)
			else:
				y = profile_h[j] + float(def.rise) * smoothstep(0.0, length, s)
			h.append(y)
		# Which way the stage goes, seen from the fork: the side to keep.
		var main_dir := (pts[mini(j + 12, n - 1)] - pts[j]).normalized()
		var keep := "left" if d0.signed_angle_to(main_dir, Vector3.UP) > 0.0 else "right"
		spurs.append({"name": def.name, "kind": def.kind, "pts": sp, "tans": st, "h": h, "F": def.F, "H": def.H,
			"j": j, "k": k, "len": length, "keep": keep})
		print("spur %s: %s, leaves at %.0f m%s, %.0f m long, keep %s" % [def.name, def.kind, j * STEP,
			(", back at %.0f m" % (k * STEP)) if k >= 0 else "", length, keep])
	# No checkpoint between a loop's ends.
	for s in spurs:
		if s.kind == "loop":
			for m in CP_AT:
				assert(not (float(m) > s.j * STEP - 20.0 and float(m) < s.k * STEP + 20.0), "checkpoint inside a loop")


func _plan_sites() -> void:
	spawn_i = int(24.0 / STEP)
	finish_i = n - 1 - int(60.0 / STEP)
	arch_i = _straightest_near(ARCH_AT / track.length_m, 12)
	for sc in SCENERY:
		var i := clampi(int(float(sc[1]) / STEP), 0, n - 1)
		var side: float = sc[2]
		if side == 0.0:
			side = -1.0 if _turn(i, 10) < 0 else 1.0
		var p := pts[i] + _right(i) * side * float(sc[3])
		scenery_sites[sc[0]] = [i, side, p]
		if float(sc[4]) > 0.0:
			flats.append([Vector2(p.x, p.z), float(sc[4])])
	depot_spot = _side_spot(DEPOT_AT / track.length_m, 22.0)
	flats.append([Vector2(depot_spot[2].x, depot_spot[2].z), 16.0])
	# The UFO's crater: out on the basin floor, flattened, in sight of the road.
	for spot in EGG_SPOTS:
		if spot[0] == "ufo":
			var ui := int(float(spot[1]) / STEP)
			var us := -1.0 if _turn(ui, 10) < 0 else 1.0
			var up := pts[ui] + _right(ui) * us * (_section(ui * STEP).x - 12.0)
			ufo_spot = [ui, us, up]
			flats.append([Vector2(up.x, up.z), 12.0])
	var start := pts[0] - tans[0] * 6.0
	flats.append([Vector2(start.x, start.z), 30.0])
	var stop := pts[n - 1] + tans[n - 1] * 12.0
	flats.append([Vector2(stop.x, stop.z), 24.0])
	for s in spurs:
		if s.kind == "dead_end":
			var e: Vector3 = s.pts[s.pts.size() - 1]
			flats.append([Vector2(e.x, e.z), 15.0])
	# The butte inside the loop: halfway between the two roads round it.
	for s in spurs:
		if s.kind == "loop":
			var mid: Vector3 = s.pts[s.pts.size() / 2]
			var mi := _nearest_sample(mid.x, mid.z)
			var other := pts[int((s.j + s.k) / 2)]
			var c := Vector2((mid.x + other.x) * 0.5, (mid.z + other.z) * 0.5)
			var gap := Vector2(mid.x - other.x, mid.z - other.z).length()
			mesas.append([c, gap * 0.5 - 13.0, 24.0])
			print("butte: %.0f m across, between roads %.0f m apart (main sample %d)" % [gap - 26.0, gap, mi])
	# Buttes standing in the basin and on the plateau, for the skyline.
	for b in [[Vector2(40, 25), 18.0, 20.0], [Vector2(135, 20), 22.0, 26.0], [Vector2(95, -90), 15.0, 18.0],
			[Vector2(-160, 120), 30.0, 14.0], [Vector2(-250, 40), 40.0, 12.0], [Vector2(60, -170), 24.0, 16.0],
			[Vector2(-200, -330), 22.0, 14.0], [Vector2(-330, 220), 26.0, 12.0]]:
		mesas.append([b[0] * SCALE, float(b[1]), float(b[2])])


# --- terrain ------------------------------------------------------------------

func _collect_samples() -> void:
	for i in n:
		var sec := _section(i * STEP)
		all_xz.append(Vector2(pts[i].x, pts[i].z))
		all_h.append(profile_h[i])
		all_bank.append(bank[i])
		all_tan.append(Vector2(tans[i].x, tans[i].z))
		all_F.append(sec.x)
		all_H.append(sec.y)
	for s in spurs:
		var m: int = s.pts.size()
		for i in m:
			var p: Vector3 = s.pts[i]
			all_xz.append(Vector2(p.x, p.z))
			all_h.append(s.h[i])
			all_bank.append(0.0)
			all_tan.append(Vector2(s.tans[i].x, s.tans[i].z))
			# Blend into the stage's section where the spur leaves it.
			var t := smoothstep(0.0, 40.0, i * STEP)
			var sec := _section(s.j * STEP)
			all_F.append(lerpf(sec.x, s.F, t))
			all_H.append(lerpf(sec.y, s.H, t))
	for i in all_xz.size():
		var k := Vector2i(floori(all_xz[i].x / HASH_CELL), floori(all_xz[i].y / HASH_CELL))
		if not _ahash.has(k):
			_ahash[k] = PackedInt32Array()
		_ahash[k].append(i)


## Nearest road sample per terrain vertex (two-pass vector chamfer), then the
## plateau: floor + wall height of the nearest sample, blurred so branches at
## different heights don't leave a step in the tableland between them.
func _prepare_grid(bb: Rect2) -> void:
	var area := bb.grow(80.0)
	_grid_origin = area.position
	_gw = int(ceil(area.size.x / TERRAIN_CELL)) + 1
	_gd = int(ceil(area.size.y / TERRAIN_CELL)) + 1
	_near.resize(_gw * _gd)
	_near.fill(-1)
	var dist := PackedFloat32Array()
	dist.resize(_gw * _gd)
	dist.fill(1e9)
	for i in all_xz.size():
		var cx := roundi((all_xz[i].x - _grid_origin.x) / TERRAIN_CELL)
		var cz := roundi((all_xz[i].y - _grid_origin.y) / TERRAIN_CELL)
		for dz in range(-1, 2):
			for dx in range(-1, 2):
				var x := cx + dx
				var z := cz + dz
				if x < 0 or z < 0 or x >= _gw or z >= _gd:
					continue
				var d := _gp(x, z).distance_to(all_xz[i])
				if d < dist[z * _gw + x]:
					dist[z * _gw + x] = d
					_near[z * _gw + x] = i
	for pass_k in 2:
		var fwd := pass_k == 0
		var zs := range(_gd) if fwd else range(_gd - 1, -1, -1)
		var xs := range(_gw) if fwd else range(_gw - 1, -1, -1)
		var nb := [Vector2i(-1, 0), Vector2i(-1, -1), Vector2i(0, -1), Vector2i(1, -1)] if fwd else [Vector2i(1, 0), Vector2i(1, 1), Vector2i(0, 1), Vector2i(-1, 1)]
		for z in zs:
			for x in xs:
				var o: int = z * _gw + x
				var p := _gp(x, z)
				for d in nb:
					var nx: int = x + d.x
					var nz: int = z + d.y
					if nx < 0 or nz < 0 or nx >= _gw or nz >= _gd:
						continue
					var cand := _near[nz * _gw + nx]
					if cand < 0:
						continue
					var dd := p.distance_to(all_xz[cand])
					if dd < dist[o]:
						dist[o] = dd
						_near[o] = cand
	# Plateau base, then a box blur (three passes of 13 x 13: ~100 m wide).
	var base := PackedFloat32Array()
	base.resize(_gw * _gd)
	for o in base.size():
		var i := _near[o]
		base[o] = all_h[i] + all_H[i]
	for b in 3:
		var tmp := PackedFloat32Array()
		tmp.resize(base.size())
		for z in _gd:
			for x in _gw:
				var s := 0.0
				var c := 0
				for dx in range(-6, 7):
					var xx := clampi(x + dx, 0, _gw - 1)
					s += base[z * _gw + xx]
					c += 1
				tmp[z * _gw + x] = s / c
		for z in _gd:
			for x in _gw:
				var s := 0.0
				var c := 0
				for dz in range(-6, 7):
					var zz := clampi(z + dz, 0, _gd - 1)
					s += tmp[zz * _gw + x]
					c += 1
				base[z * _gw + x] = s / c
	_plateau = base


func _gp(x: int, z: int) -> Vector2:
	return _grid_origin + Vector2(x, z) * TERRAIN_CELL


## Floor height at (x, z), d metres from the nearest road sample: the road's
## height and camber, blended over the samples about as near (so the floor
## between two legs of a bend, or a spur and the stage, ramps, not steps).
func _floor_at(x: float, z: float, d: float, nearest: int) -> float:
	if d > 60.0:
		return all_h[nearest]
	var sum := 0.0
	var wsum := 0.0
	var reach := d + 10.0
	var width := 3.0 + d * 0.3
	var r := ceili(reach / HASH_CELL)
	var cx := floori(x / HASH_CELL)
	var cz := floori(z / HASH_CELL)
	for ddx in range(-r, r + 1):
		for ddz in range(-r, r + 1):
			var k := Vector2i(cx + ddx, cz + ddz)
			if not _ahash.has(k):
				continue
			for i in _ahash[k]:
				var off := Vector2(x, z) - all_xz[i]
				var di := off.length()
				if di > reach:
					continue
				var wi := exp(-pow((di - d) / width, 2.0))
				var t := all_tan[i]
				var lat := clampf(off.dot(Vector2(-t.y, t.x)), -9.0, 9.0)
				sum += wi * (all_h[i] + all_bank[i] * lat)
				wsum += wi
	return sum / wsum if wsum > 0.0 else all_h[nearest]


func _height(x: float, z: float) -> float:
	var gx := clampi(roundi((x - _grid_origin.x) / TERRAIN_CELL), 0, _gw - 1)
	var gz := clampi(roundi((z - _grid_origin.y) / TERRAIN_CELL), 0, _gd - 1)
	var o := gz * _gw + gx
	var ni := _near[o]
	var d := Vector2(x, z).distance_to(all_xz[ni])
	var fl := _floor_at(x, z, d, ni)
	var big_f := all_F[ni]
	# How far past the floor's edge: the road's floor, or a yard's.
	var w := d - big_f
	var flat := 0.0
	for f in flats:
		var fd: float = Vector2(x, z).distance_to(f[0]) - float(f[1])
		w = minf(w, fd)
		flat = maxf(flat, 1.0 - smoothstep(0.0, 14.0, fd))
	# The wall's foot wanders outward (never in toward the road) by up to 4 m.
	var foot := (wall_noise.get_noise_2d(x, z) * 0.5 + 0.5) * 4.0
	var s := smoothstep(0.0, WALL_W, w - foot)
	# Low dunes on the floor away from the road, none on the yards.
	# (and none near a wall's foot, so they can't eat into its height).
	var dune := dune_noise.get_noise_2d(x, z) * 1.3 * smoothstep(8.0, 22.0, d) * (1.0 - flat) * (1.0 - smoothstep(-8.0, -2.0, w - foot))
	var floor_h := fl + dune
	var rim := maxf(_plateau[o], fl + all_H[ni]) if d < big_f + 30.0 else _plateau[o] + (terrain_noise.get_noise_2d(x * 1.7, z * 1.7) * 0.5 + 0.5) * 3.0
	var h := lerpf(floor_h, rim, s)
	# Buttes: steep sides, a flat cap, a ragged footprint.
	for m in mesas:
		var md := Vector2(x, z).distance_to(m[0]) + wall_noise.get_noise_2d(x * 1.6 + 50.0, z * 1.6) * 5.0
		var r: float = m[1]
		if md < r + 6.0:
			var ms := smoothstep(r + 1.5, r - 1.5, md)
			h = maxf(h, fl + float(m[2]) * ms + (all_H[ni] if s > 0.5 else 0.0))
	return h


## Cross-section at sample i: berm and apron outside a sand verge.
func _profile(i: int) -> Array:
	return _section_cols(half_w[i], verge_w[i])


func _section_cols(h: float, vw: float) -> Array:
	var v := h + vw
	return [
		[-(v + BERM + APRON), C_SAND, 0.5], [-(v + BERM), C_BERM, 0.45], [-(v + 0.4), C_BERM.darkened(0.04), 0.3], [-v, C_VERGE, 0.25],
		[-h, C_VERGE.darkened(0.05), 0.2], [-1.9, C_TRACK, 0.0], [-1.25, C_RUT, 0.0], [-0.5, C_CROWN, 0.0],
		[0.5, C_CROWN, 0.0], [1.25, C_RUT, 0.0], [1.9, C_TRACK, 0.0], [h, C_VERGE.darkened(0.05), 0.2],
		[v, C_VERGE, 0.25], [v + 0.4, C_BERM.darkened(0.04), 0.3], [v + BERM, C_BERM, 0.45], [v + BERM + APRON, C_SAND, 0.5],
	]


func _env() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	# High and hot, a little west of south: short shadows, bright faces.
	sun.rotation_degrees = Vector3(-55, -120, 0)
	sun.light_color = Color(1.0, 0.9, 0.76)
	sun.light_energy = 1.15
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 110.0
	sun.shadow_opacity = 0.65
	sun.shadow_blur = 1.5
	track.add_child(sun)
	var we := WorldEnvironment.new()
	we.name = "Environment"
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("6b4a33")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.78, 0.68, 0.6)
	env.ambient_light_energy = 0.5
	we.environment = env
	track.add_child(we)


## Ground tint: value relative to the shader's REF, alpha = how much floor
## detail. Dusty and pale along the road, darker on the plateau, the yards
## compacted and plain.
func _ground_tints() -> void:
	var bytes := PackedByteArray()
	bytes.resize(terrain.w * terrain.d * 4)
	for iz in terrain.d:
		for ix in terrain.w:
			var x := terrain.origin.x + ix * TERRAIN_CELL
			var z := terrain.origin.y + iz * TERRAIN_CELL
			var k := noise.get_noise_2d(x, z) * 0.5 + 0.5
			var d := _fast_dist(x, z)
			var shade := 0.9 + k * 0.16 + (1.0 - smoothstep(6.0, 18.0, d)) * 0.12
			var up := terrain.normal_at(x, z).y
			var o_near := _near[clampi(iz, 0, _gd - 1) * _gw + clampi(ix, 0, _gw - 1)]
			# Up on the tableland: older, darker, varnished.
			if terrain.h(ix, iz) > all_h[o_near] + 6.0 and up > 0.85:
				shade *= 0.8
			var c := Color(C_FLOOR_REF.r * shade, C_FLOOR_REF.g * shade, C_FLOOR_REF.b * shade)
			var detail := 1.0
			for y in yards:
				var t := clampf((y[1] - Vector2(x, z).distance_to(y[0])) / 8.0, 0.0, 1.0)
				c = c.lerp(y[2], t)
				detail = lerpf(detail, 0.25, t)
			var o := (iz * terrain.w + ix) * 4
			bytes[o] = clampi(roundi(c.r * 255.0), 0, 255)
			bytes[o + 1] = clampi(roundi(c.g * 255.0), 0, 255)
			bytes[o + 2] = clampi(roundi(c.b * 255.0), 0, 255)
			bytes[o + 3] = clampi(roundi(detail * 255.0), 0, 255)
	terrain.tints = bytes
	terrain.collision_layer = LAYER_WORLD
	terrain.set_meta("surface", "offroad")
	track.add_child(terrain)
	print("ground: %d x %d vertices, %.0f m cells" % [terrain.w, terrain.d, TERRAIN_CELL])


# --- spurs --------------------------------------------------------------------

## Spur roads: the stage's cross-section and shader, meshes and probe under
## the Road body (so Track.world_materials finds them), sand verges under
## Verge. Where a spur overlaps the stage's own road, the stage draws on top
## (the spur sinks under it) and the stage's probe answers; past the stage's
## verge the spur is on top, so its mouth reads as road carrying on.
func _spur_roads() -> void:
	var road: Node3D = track.get_node("Road")
	var verge: Node3D = track.get_node("Verge")
	for s in spurs:
		var sp: PackedVector3Array = s.pts
		var m := sp.size()
		var rows: Array = []
		var hw := ROAD_HALF_WIDTH - 0.15
		var vw := SHOULDER
		for i in m:
			var row: Array = []
			var r := Vector3(-s.tans[i].z, 0, s.tans[i].x)
			var shade := 1.0 + noise.get_noise_2d(sp[i].x * 2.0, sp[i].z * 2.0) * 0.12
			for p in _section_cols(hw, vw):
				var c: Color = (p[1] as Color).darkened(rng.randf_range(-0.05, 0.09))
				var lat: float = float(p[0]) + rng.randf_range(-1.0, 1.0) * float(p[2])
				var q := sp[i] + r * lat
				var on_main := _road_dist(q.x, q.z, 12.0) < ROAD_HALF_WIDTH + SHOULDER + 0.6
				var pos := _g(q, 0.0 if on_main else 0.06)
				# Fade the far end into the sand: nobody grades a road to nowhere.
				var fade := smoothstep(s.len - 30.0, s.len, i * STEP) * (0.6 if s.kind == "dead_end" else 0.0)
				c = c.lerp(C_SAND, fade)
				row.append([pos, Color(c.r * shade, c.g * shade, c.b * shade), Vector2(lat, i * STEP), Vector2(hw, hw + vw)])
			rows.append(row)
		var cols: int = (rows[0] as Array).size()
		for i0 in range(0, m - 1, ROAD_PIECE):
			var st := _st()
			for i in range(i0, mini(i0 + ROAD_PIECE, m - 1)):
				for jj in cols - 1:
					var a: Array = rows[i][jj]
					var b: Array = rows[i][jj + 1]
					var c: Array = rows[i + 1][jj]
					var d: Array = rows[i + 1][jj + 1]
					for v in [a, c, b, b, c, d]:
						st.set_color(v[1])
						st.set_uv(v[2])
						st.set_uv2(v[3])
						st.set_normal(terrain.normal_at(v[0].x, v[0].z))
						st.add_vertex(v[0])
			st.index()
			var mi := _mesh_node("%sMesh%d" % [s.name, i0 / ROAD_PIECE], _commit(st, road_mat))
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			road.add_child(mi)
		# Probes: a hair above the ground, so where the spur's road meets the
		# stage's sand verge the road answers.
		var faces := PackedVector3Array()
		var vfaces := PackedVector3Array()
		for i in m - 1:
			var r0 := Vector3(-s.tans[i].z, 0, s.tans[i].x)
			var r1 := Vector3(-s.tans[i + 1].z, 0, s.tans[i + 1].x)
			for k in 3:
				var f0 := -1.0 + k * 2.0 / 3.0
				var f1 := -1.0 + (k + 1) * 2.0 / 3.0
				var a := _g(sp[i] + r0 * hw * f0, 0.02)
				var b := _g(sp[i] + r0 * hw * f1, 0.02)
				var c := _g(sp[i + 1] + r1 * hw * f0, 0.02)
				var d := _g(sp[i + 1] + r1 * hw * f1, 0.02)
				faces.append_array([a, c, b, b, c, d])
			for side: float in [-1.0, 1.0]:
				var a := sp[i] + r0 * side * hw
				if _road_dist(a.x, a.z, 12.0) < ROAD_HALF_WIDTH + SHOULDER + 0.6:
					continue
				var b := sp[i] + r0 * side * (hw + vw)
				var c := sp[i + 1] + r1 * side * hw
				var d := sp[i + 1] + r1 * side * (hw + vw)
				vfaces.append_array([_g(a), _g(c), _g(b), _g(b), _g(c), _g(d)])
		for pair in [[road, faces, "Shape"], [verge, vfaces, "Shape"]]:
			var shape := ConcavePolygonShape3D.new()
			shape.set_faces(pair[1])
			shape.backface_collision = true
			var cs := CollisionShape3D.new()
			cs.name = "%s%s" % [s.name, pair[2]]
			cs.shape = shape
			(pair[0] as Node3D).add_child(cs)


## A marker per fork (group track_fork) where the stage meets a spur: pace
## notes say which way to keep.
func _forks() -> void:
	var g := _group("Forks")
	for s in spurs:
		var ends := [[s.j, s.keep, 0]]
		for e in ends:
			var i: int = e[0]
			var m := Marker3D.new()
			m.name = "Fork%s" % s.name
			m.transform = _xf_at(i)
			m.add_to_group("track_fork", true)
			m.set_meta("distance_m", i * STEP)
			m.set_meta("keep", e[1])
			m.set_meta("spur", s.name)
			m.set_meta("kind", s.kind)
			m.set_meta("spur_length_m", s.len)
			if s.kind == "loop":
				m.set_meta("rejoin_m", s.k * STEP)
			g.add_child(m)


## Checkpoint gates span the canyon floor wall to wall: out to where the
## ground is a wall the car can't climb, both sides, whichever is wider.
func _gate_width_at(i: int) -> float:
	var reach := 0.0
	for side: float in [-1.0, 1.0]:
		var out := 0.0
		var y := pts[i].y
		while out < 45.0:
			out += 1.0
			var q := pts[i] + _right(i) * side * out
			if terrain.height_at(q.x, q.z) > y + 4.0:
				break
		reach = maxf(reach, out)
	return clampf(reach * 2.0 + 4.0, 16.0, 70.0)


## Flood fill over the terrain from just before each gate, with the gate's
## footprint blocked and only slopes the car can climb: if it reaches the road
## past the gate, there's a way round. Returns how many gates leak.
func _check_gates() -> int:
	var leaks := 0
	var gates: Array = []
	for cp in track.get_node("Markers").get_children():
		if cp is Area3D:
			gates.append(cp)
	for gate in gates:
		var i := int(float(gate.get_meta("distance_m")) / STEP)
		var reached := flood_from_gate(terrain, gate, pts[maxi(i - 15, 0)])
		var leak := -1
		for j in range(i + 12, n, 4):
			if reached.has(_cell_of(terrain, pts[j])):
				leak = j
				break
		if leak >= 0:
			leaks += 1
			print("  LEAK: past %s at %.0f m the road at %.0f m is reachable" % [gate.name, i * STEP, leak * STEP])
		else:
			print("  %s at %.0f m: sealed (%d cells reachable before it, width %.0f m)" % [gate.name, i * STEP, reached.size(), (gate.get_node("Shape").shape as BoxShape3D).size.x])
	return leaks


static func _cell_of(t: Terrain, p: Vector3) -> Vector2i:
	return Vector2i(roundi((p.x - t.origin.x) / t.cell), roundi((p.z - t.origin.y) / t.cell))


## Cells reachable from `from` without crossing the gate's box (grown by a
## cell) or touching ground steeper than MAX_GRADE: a vertex is drivable when
## every terrain triangle around it is. Steepness, not rise per step, is what
## stops a CharacterBody, whatever direction it drives across a face.
## Shared with the tests.
static func flood_from_gate(t: Terrain, gate: Node3D, from: Vector3) -> Dictionary:
	var box: Vector3 = (gate.get_node("Shape").shape as BoxShape3D).size
	var xf: Transform3D = gate.global_transform if gate.is_inside_tree() else gate.transform
	var inv := xf.affine_inverse()
	var seen := {}
	var start := _cell_of(t, from)
	var queue: Array[Vector2i] = [start]
	seen[start] = true
	var head := 0
	var dirs := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1), Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, 1), Vector2i(-1, -1)]
	var ok := {}
	while head < queue.size():
		var c := queue[head]
		head += 1
		for d in dirs:
			var nc: Vector2i = c + d
			if nc.x < 1 or nc.y < 1 or nc.x >= t.w - 1 or nc.y >= t.d - 1 or seen.has(nc):
				continue
			if not ok.has(nc):
				ok[nc] = drivable(t, nc.x, nc.y)
			if not ok[nc]:
				continue
			var wp := Vector3(t.origin.x + nc.x * t.cell, 0, t.origin.y + nc.y * t.cell)
			var lp := inv * Vector3(wp.x, xf.origin.y, wp.z)
			if absf(lp.x) < box.x * 0.5 + t.cell and absf(lp.z) < box.z * 0.5 + t.cell:
				continue
			seen[nc] = true
			queue.append(nc)
	return seen


## Every triangle touching vertex (x, z) no steeper than MAX_GRADE. Same
## split as Terrain.height_at.
static func drivable(t: Terrain, x: int, z: int) -> bool:
	for qz in [z - 1, z]:
		for qx in [x - 1, x]:
			var a := t.h(qx, qz)
			var b := t.h(qx + 1, qz)
			var c := t.h(qx, qz + 1)
			var e := t.h(qx + 1, qz + 1)
			if t.flipped(qx, qz):
				if Vector2(b - a, c - a).length() > MAX_GRADE * t.cell or Vector2(e - c, e - b).length() > MAX_GRADE * t.cell:
					return false
			elif Vector2(b - a, e - b).length() > MAX_GRADE * t.cell or Vector2(e - c, c - a).length() > MAX_GRADE * t.cell:
				return false
	return true


# --- start and finish ------------------------------------------------------------

func _service_and_stop() -> void:
	var g := _group("ServiceAndStop")
	var start := _g(pts[0] - tans[0] * 6.0)
	yards.append([Vector2(start.x, start.z), 26.0, C_YARD])
	clearings.append([Vector2(start.x, start.z), 30.0])
	for k in 3:
		var side := -1.0 if k < 2 else 1.0
		var p := _g(pts[spawn_i] + _right(spawn_i) * side * 12.0 + tans[spawn_i] * (k * 8.0 - 22.0))
		var tent := _solid("Tent%d" % k, "tent", Transform3D(Basis.looking_at(tans[spawn_i], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)
	for k in 6:
		var p := _g(pts[0] + _right(0) * (k * 1.4 - 3.5))
		g.add_child(_mesh_node("Cone%d" % k, meshes["cone"], Transform3D(Basis.IDENTITY, p)))
	var end := _g(pts[n - 1] + tans[n - 1] * 12.0)
	clearings.append([Vector2(end.x, end.z), 22.0])
	yards.append([Vector2(end.x, end.z), 20.0, C_YARD])
	for k in 2:
		var p := _g(end + _right(n - 1) * (k * 10.0 - 5.0) + tans[n - 1] * 6.0)
		var tent := _solid("StopTent%d" % k, "tent", Transform3D(Basis.looking_at(tans[n - 1], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)


## Eighteen corners make 54 chevron boards, one draw each; the slot canyon's
## esses would show a dozen at once. Merged into one mesh per scatter chunk
## (culling still works per chunk). They're scenery, not solid.
func _merge_chevrons() -> void:
	var g: Node3D = track.get_node("Corners")
	var by_cell := {}
	for c in g.get_children():
		if c is MeshInstance3D and String(c.name).begins_with("Chevron"):
			var k := Vector2i(floori(c.position.x / CHUNK), floori(c.position.z / CHUNK))
			if not by_cell.has(k):
				by_cell[k] = []
			by_cell[k].append(c)
	var keys := by_cell.keys()
	keys.sort()
	for k in keys:
		var st := _st()
		for c in by_cell[k]:
			_merge(st, (c as MeshInstance3D).mesh, (c as MeshInstance3D).transform)
			g.remove_child(c)
			c.free()
		g.add_child(_mesh_node("Chevrons_%d_%d" % [k.x, k.y], _commit(st)))


# --- landmarks -------------------------------------------------------------------

## The stone arch: a natural sandstone bridge over the road where the slot
## canyon opens into the basin. Two legs of stacked boulders and a sagging
## span of rock blocks, ~11 m to the underside. Legs are solid.
func _stone_arch() -> void:
	var i := arch_i
	var xf := _xf_at(i)
	var body := StaticBody3D.new()
	body.name = "StoneArch"
	body.collision_layer = LAYER_WORLD
	body.add_to_group("track_landmark", true)
	body.add_to_group("track_obstacle", true)
	body.set_meta("label", "stone arch")
	body.set_meta("kind", "landmark")
	body.transform = xf
	var st := _st()
	var half := half_w[i] + verge_w[i] + BERM + 2.6
	const TOP := 11.5
	for side: float in [-1.0, 1.0]:
		var base := Vector3(side * half, 0, 0)
		# Each leg: big blocks at the bottom, narrowing up, leaning in.
		for k in 6:
			var y := k * 2.1
			var lean := side * -0.9 * (k / 5.0)
			var s := lerpf(2.2, 1.35, k / 5.0)
			var id: String = ["red_rock_d", "red_rock_b", "hoodoo_e"][(k + (1 if side > 0 else 0)) % 3]
			_merge(st, meshes[id], Transform3D(Basis(Vector3.UP, srng.randf() * TAU).scaled(Vector3(s, s * 0.95, s)), base + Vector3(lean, y - 0.4, srng.randf_range(-0.4, 0.4))), Color(1, 1, 1).darkened(srng.randf_range(0.0, 0.12)))
		var cs := CollisionShape3D.new()
		cs.name = "Leg%s" % ("L" if side < 0 else "R")
		var bs := BoxShape3D.new()
		bs.size = Vector3(4.2, 9.0, 5.2)
		cs.shape = bs
		cs.position = Vector3(side * (half + 0.4), 4.5, 0)
		body.add_child(cs)
	# The span: blocks along a flattened arc, thicker at the shoulders.
	var segs := 11
	for k in segs + 1:
		var t := float(k) / segs
		var x := lerpf(-half + 0.8, half - 0.8, t)
		var y := TOP + sin(t * PI) * 1.6 - 0.8
		var thick := lerpf(3.6, 2.2, sin(t * PI))
		_box(st, Transform3D(Basis(Vector3.FORWARD, (t - 0.5) * -0.5).rotated(Vector3.UP, srng.randf_range(-0.08, 0.08)), Vector3(x, y, srng.randf_range(-0.3, 0.3))),
			Vector3(2.4, thick, 3.4 + srng.randf_range(-0.4, 0.6)), (C_ROCK if k % 2 == 0 else C_ROCK_DARK).lightened(srng.randf_range(0.0, 0.08)))
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, y + thick * 0.5 + 0.1, 0)), Vector3(2.5, 0.3, 3.0), Color("d8b083")) # sand on top
	var mesh := _commit(st)
	body.add_child(_mesh_node("Mesh", mesh))
	track.add_child(body)
	clearings.append([Vector2(xf.origin.x, xf.origin.z), half + 4.0])
	print("stone arch at %.0f m, %.1f m between the legs" % [i * STEP, half * 2.0 - 4.2])


## Fuel depot: a yard in the basin, drums stacked and scattered, a pump on an
## island, a tank on a stand and the attendant's hut.
func _fuel_depot() -> void:
	var i: int = depot_spot[0]
	var p: Vector3 = _g(depot_spot[2], -0.05)
	var body := _solid("FuelDepot", "landmark", Transform3D(_facing_road(i, p), p), Vector3(8.0, 2.4, 3.0), Vector3(0, 0, -5.0))
	body.add_to_group("track_landmark", true)
	body.set_meta("label", "fuel drums")
	# Drum pyramid and rows, red and yellow.
	var st := _st()
	for k in 4:
		_merge(st, meshes["drums"], Transform3D(Basis(Vector3.UP, k * 0.9), Vector3(-6.0 + k * 3.0, 0, -5.0)))
	for k in 3:
		_merge(st, meshes["drum_yellow" if k % 2 else "drum"], Transform3D(Basis(Vector3.UP, k), Vector3(-4.5 + k * 3.0, 1.2, -5.0)))
	for k in 7:
		var q := Vector3(srng.randf_range(-8.0, 8.0), 0, srng.randf_range(-1.5, 4.5))
		if absf(q.x) < 2.6 and q.z > 0.0:
			continue
		var lying := srng.randf() < 0.4
		var b := Basis(Vector3.UP, srng.randf() * TAU)
		if lying:
			b = b * Basis(Vector3.RIGHT, PI * 0.5)
		_merge(st, meshes["drum_yellow" if k % 3 == 0 else "drum"], Transform3D(b, q + (Vector3(0, 0.45, 0) if lying else Vector3.ZERO)))
	# Tank on a stand, behind.
	for c in [[-1, -1], [1, -1], [1, 1], [-1, 1]]:
		_beam(st, Vector3(7.5 + c[0] * 1.2, 0, -8.0 + c[1] * 1.2), Vector3(7.5 + c[0] * 1.1, 3.0, -8.0 + c[1] * 1.1), 0.2, C_STEEL_DARK)
	var tank := CylinderMesh.new()
	tank.top_radius = 1.5
	tank.bottom_radius = 1.5
	tank.height = 4.6
	tank.radial_segments = 10
	tank.rings = 1
	_prim(st, tank, Transform3D(Basis(Vector3.FORWARD, PI * 0.5), Vector3(7.5, 4.6, -8.0)), C_WHITE)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(7.5, 4.6, -6.45)), Vector3(4.0, 0.7, 0.05), C_RED) # stripe
	# Pump island.
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.15, 1.5)), Vector3(3.2, 0.3, 1.4), Color("b9b2a4"))
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 1.2, 1.5)), Vector3(0.8, 1.8, 0.6), C_RED)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 1.75, 1.82)), Vector3(0.5, 0.35, 0.05), C_WHITE)
	# Hut.
	_box(st, Transform3D(Basis.IDENTITY, Vector3(-8.5, 1.3, -8.0)), Vector3(3.6, 2.6, 3.0), C_PLANK)
	_box(st, Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-8)), Vector3(-8.5, 2.75, -7.9)), Vector3(4.2, 0.12, 3.8), C_TIN)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(-8.5, 1.1, -6.46)), Vector3(1.0, 2.0, 0.05), C_PLANK_DARK)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	for spec in [["Tank", Vector3(7.5, 0, -8.0), Vector3(3.2, 6.2, 5.0)], ["Hut", Vector3(-8.5, 0, -8.0), Vector3(3.8, 2.8, 3.2)], ["Pump", Vector3(0, 0, 1.5), Vector3(3.2, 2.0, 1.4)]]:
		var cs := CollisionShape3D.new()
		cs.name = spec[0]
		var bs := BoxShape3D.new()
		bs.size = spec[2]
		cs.shape = bs
		cs.position = spec[1] + Vector3(0, bs.size.y * 0.5, 0)
		body.add_child(cs)
	var sign_label := Label3D.new()
	sign_label.name = "Sign"
	sign_label.text = "FUEL"
	sign_label.font_size = 96
	sign_label.pixel_size = 0.012
	sign_label.outline_size = 0
	sign_label.modulate = C_RED
	sign_label.transform = Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-20)), Vector3(-8.5, 3.4, -6.3))
	body.add_child(sign_label)
	_landmarks().add_child(body)
	clearings.append([Vector2(p.x, p.z), 16.0])
	yards.append([Vector2(p.x, p.z), 13.0, C_YARD.darkened(0.06)])
	_sightline(depot_spot)
	print("fuel depot at %.0f m" % (i * STEP))


## Radio tower: a 32 m lattice mast at the end of the tower road (a dead
## end: it's what the road looks like it's going to), a dish half way up,
## an equipment box at the foot, a red lamp on top (EyeForest keys the far
## silhouette's lamp on C_BEACON). Taller than any wall, so it's seen from
## the stage long before and after.
func _radio_tower() -> void:
	var s: Dictionary = spurs.filter(func(q: Dictionary) -> bool: return q.name == "TowerRoad")[0]
	var sp: PackedVector3Array = s.pts
	var end := sp[sp.size() - 1] + (s.tans[sp.size() - 1] as Vector3) * 8.0
	var p := _g(end, -0.1)
	var i := _nearest_sample(p.x, p.z)
	var body := _solid("RadioTower", "landmark", Transform3D(_facing_road(i, p), p), Vector3(3.6, 3.0, 3.6))
	body.add_to_group("track_landmark", true)
	body.set_meta("label", "radio tower")
	var st := _st()
	const H := 32.0
	const B := 1.7
	var leg := func(k: int, y: float) -> Vector3:
		var a := TAU * k / 3.0 + 0.3
		var w := lerpf(B, 0.35, y / H)
		return Vector3(cos(a) * w, y, sin(a) * w)
	for k in 3:
		_beam(st, leg.call(k, -0.3), leg.call(k, H), 0.16, C_RED if k == 0 else C_WHITE)
	var levels := 10
	for l in levels:
		var y0 := H * l / levels
		var y1 := H * (l + 1) / levels
		for k in 3:
			_beam(st, leg.call(k, y0), leg.call((k + 1) % 3, y1), 0.07, C_STEEL)
			_beam(st, leg.call(k, y1), leg.call((k + 1) % 3, y1), 0.07, C_RED if l % 2 == 0 else C_WHITE)
	_merge(st, meshes["dish"], Transform3D(Basis(Vector3.UP, 0.6).scaled(Vector3.ONE * 0.9), Vector3(0.6, H * 0.55, 0.6)))
	_merge(st, meshes["radio_box"], Transform3D(Basis(Vector3.UP, 0.4), Vector3(-3.4, 0, 1.0)))
	# Guy wires (thin beams) to three anchors.
	for k in 3:
		var a := TAU * k / 3.0 + 0.3 + PI / 3.0
		_beam(st, Vector3(cos(a) * 12.0, 0.2, sin(a) * 12.0), leg.call(k, H * 0.7), 0.04, C_STEEL_DARK)
		_box(st, Transform3D(Basis.IDENTITY, Vector3(cos(a) * 12.0, 0.2, sin(a) * 12.0)), Vector3(0.6, 0.4, 0.6), Color("8c8478"))
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 0.4, 0)), Vector3(0.45, 0.45, 0.45), C_BEACON)
	var mesh := _commit(st)
	body.add_child(_mesh_node("Mesh", mesh))
	body.add_child(_glow("Beacon", 3.4, _glow_mat(Color(1.0, 0.25, 0.15), 1.4, 2.6, Vector2(180.0, 420.0)), Vector3(0, H + 0.4, 0)))
	body.add_to_group("track_tall", true)
	body.set_meta("proxy_mesh", mesh)
	_landmarks().add_child(body)
	clearings.append([Vector2(p.x, p.z), 14.0])
	yards.append([Vector2(p.x, p.z), 10.0, C_YARD])
	print("radio tower at the end of %s (%.0f m off the stage at %.0f m)" % [s.name, _road_dist(p.x, p.z, 400.0), i * STEP])


## The old mine at the end of the mine road: a timber portal into the box
## canyon's wall, rails, a tipped ore cart, drums. Scenery, not a callout:
## it's off the stage.
func _mine() -> void:
	var s: Dictionary = spurs.filter(func(q: Dictionary) -> bool: return q.name == "MineRoad")[0]
	var sp: PackedVector3Array = s.pts
	var m := sp.size()
	var t: Vector3 = s.tans[m - 1]
	var p := _g(sp[m - 1] + t * 9.0, -0.1)
	var body := _solid("OldMine", "mine", Transform3D(Basis.looking_at(-t, Vector3.UP), p), Vector3(5.0, 4.0, 1.6), Vector3(0, 0, -1.0))
	var st := _st()
	for x in [-1.8, 1.8]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, 1.7, -1.0)), Vector3(0.4, 3.4, 0.4), C_PLANK_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 3.5, -1.0)), Vector3(4.6, 0.45, 0.5), C_PLANK_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 1.6, -1.3)), Vector3(3.2, 3.2, 0.1), Color("1d1410"))
	for k in 8:
		var z := 1.0 + k * 1.2
		_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 0.05, z)), Vector3(1.6, 0.1, 0.25), C_PLANK_DARK)
	for x in [-0.55, 0.55]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, 0.14, 5.2)), Vector3(0.08, 0.08, 9.6), C_STEEL_DARK)
	_box(st, Transform3D(Basis(Vector3.FORWARD, 0.5), Vector3(1.6, 0.7, 6.0)), Vector3(1.3, 0.9, 1.8), C_RUST)
	_merge(st, meshes["drums"], Transform3D(Basis(Vector3.UP, 0.4), Vector3(-3.6, 0, 2.0)))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	var sign_label := Label3D.new()
	sign_label.name = "Sign"
	sign_label.text = "KEEP OUT"
	sign_label.font_size = 48
	sign_label.pixel_size = 0.01
	sign_label.outline_size = 0
	sign_label.modulate = C_WHITE
	sign_label.position = Vector3(0, 3.5, -0.7)
	body.add_child(sign_label)
	track.add_child(body)
	clearings.append([Vector2(p.x, p.z), 8.0])


# --- callouts ------------------------------------------------------------------

func _scenery() -> void:
	_windpump()
	_shack()
	_wreck()
	_water_tank()
	var big := [track.get_node("StoneArch"), _landmarks().get_node("FuelDepot")]
	for id in scenery_sites:
		var site: Array = scenery_sites[id]
		var p: Vector3 = site[2]
		var nearest := INF
		for b in big:
			nearest = minf(nearest, Vector2(p.x, p.z).distance_to(Vector2(b.position.x, b.position.z)))
		var cp_gap := INF
		for m in CP_AT:
			cp_gap = minf(cp_gap, absf(site[0] * STEP - float(m)))
		print("  %-9s at %4.0f m, %s, %4.1f m off the road, %3.0f m from a big landmark, %3.0f m from a checkpoint" % [
			id, site[0] * STEP, "right" if site[1] > 0 else "left", _road_dist(p.x, p.z), nearest, cp_gap])
		assert(nearest > 50.0 and cp_gap > 12.0)


## Windpump: lattice tower, a fan of blades, the tail vane, a round trough.
func _windpump() -> void:
	var site: Array = scenery_sites["windpump"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.05)
	var body := _solid("Windpump", "landmark", Transform3D(_facing_road(i, p), p), Vector3(2.4, 3.0, 2.4))
	var st := _st()
	const H := 9.0
	for c in [[-1, -1], [1, -1], [1, 1], [-1, 1]]:
		_beam(st, Vector3(c[0] * 1.1, 0, c[1] * 1.1), Vector3(c[0] * 0.25, H, c[1] * 0.25), 0.1, C_STEEL)
	for l in 3:
		var y := 2.0 + l * 2.4
		var w := lerpf(1.1, 0.25, y / H)
		for k in 4:
			var a := Vector3([-1, 1, 1, -1][k] * w, y, [-1, -1, 1, 1][k] * w)
			var b := Vector3([1, 1, -1, -1][k] * w, y, [-1, 1, 1, -1][k] * w)
			_beam(st, a, b, 0.06, C_STEEL_DARK)
	var hub := Vector3(0, H + 0.4, 0.5)
	for k in 12:
		var a := TAU * k / 12.0
		var tip := hub + Vector3(cos(a), sin(a), 0) * 2.0
		_beam(st, hub + Vector3(cos(a), sin(a), 0) * 0.4, tip, 0.22, C_TIN.lightened(0.1 * (k % 2)))
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 0.4, -1.4)), Vector3(0.08, 1.2, 2.2), C_RED)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, H + 0.4, -0.4)), Vector3(0.3, 0.3, 1.6), C_STEEL_DARK)
	var trough := CylinderMesh.new()
	trough.top_radius = 1.8
	trough.bottom_radius = 1.8
	trough.height = 0.7
	trough.radial_segments = 12
	trough.rings = 1
	_prim(st, trough, Transform3D(Basis.IDENTITY, Vector3(2.8, 0.35, 1.5)), C_TIN.darkened(0.2))
	_box(st, Transform3D(Basis.IDENTITY, Vector3(2.8, 0.66, 1.5)), Vector3(2.6, 0.02, 2.6), Color("4c6b6a"))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	clearings.append([Vector2(p.x, p.z), 5.0])
	yards.append([Vector2(p.x, p.z), 6.0, C_YARD])
	_callout(body, "windpump", site, "windpump", Color("b9c0c6"))


## Prospector's shack: plank walls, a sagging tin roof, a porch.
func _shack() -> void:
	var site: Array = scenery_sites["shack"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.1)
	var body := _solid("Shack", "landmark", Transform3D(_facing_road(i, p), p), Vector3(5.2, 2.8, 4.0))
	var st := _st()
	_box(st, Transform3D(Basis.IDENTITY, Vector3(0, 1.4, 0)), Vector3(5.0, 2.8, 3.8), C_PLANK)
	for k in 9:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(-2.2 + k * 0.55, 1.4, 1.91)), Vector3(0.05, 2.8, 0.02), C_PLANK_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(-0.9, 1.1, 1.93)), Vector3(1.0, 2.1, 0.04), C_PLANK_DARK)
	_box(st, Transform3D(Basis.IDENTITY, Vector3(1.2, 1.7, 1.93)), Vector3(1.0, 0.8, 0.04), Color("2c2a26"))
	_box(st, Transform3D(Basis(Vector3.RIGHT, deg_to_rad(10)) * Basis(Vector3.FORWARD, 0.04), Vector3(0, 3.05, 0.6)), Vector3(5.8, 0.1, 5.4), C_RUST.lightened(0.15))
	for x in [-2.4, 2.4]:
		_box(st, Transform3D(Basis.IDENTITY, Vector3(x, 1.2, 3.1)), Vector3(0.15, 2.4, 0.15), C_PLANK_DARK)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	body.add_child(_mesh_node("Drums", meshes["drums"], Transform3D(Basis(Vector3.UP, 1.0), Vector3(3.6, 0, -0.5))))
	clearings.append([Vector2(p.x, p.z), 5.5])
	yards.append([Vector2(p.x, p.z), 7.0, C_YARD])
	_callout(body, "shack", site, "outhouse", Color("c08a5a"))


func _wreck() -> void:
	var site: Array = scenery_sites["wreck"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.25)
	var yaw := Basis.looking_at(tans[i], Vector3.UP).rotated(Vector3.UP, site[1] * 1.3)
	var basis := yaw * Basis(Vector3.FORWARD, deg_to_rad(-5.0)) * Basis(Vector3.RIGHT, deg_to_rad(4.0))
	var body := _solid("Wreck", "landmark", Transform3D(basis, p), Vector3(2.6, 1.2, 4.4))
	body.add_child(_mesh_node("Mesh", meshes["wreck"]))
	# Half buried: a drift banked up against the windward side.
	var st := _st()
	for k in 9:
		var q := Vector3(srng.randf_range(-1.6, -0.6), 0.0, -2.2 + k * 0.55)
		_merge(st, meshes["flat_rock"], Transform3D(Basis(Vector3.UP, srng.randf() * TAU).scaled(Vector3(1.3, 2.2, 1.3)), q), Color(1.2, 1.15, 1.1))
	body.add_child(_mesh_node("Drift", _commit(st)))
	clearings.append([Vector2(p.x, p.z), 4.6])
	_callout(body, "wrecked car", site, "wreck", Color("c0392b"))


## Water tank on stilts beside the road, a ladder up one leg.
func _water_tank() -> void:
	var site: Array = scenery_sites["tank"]
	var i: int = site[0]
	var p: Vector3 = _g(site[2], -0.05)
	var body := _solid("WaterTank", "landmark", Transform3D(_facing_road(i, p), p), Vector3(3.6, 3.0, 3.6))
	var st := _st()
	const Y := 5.0
	for c in [[-1, -1], [1, -1], [1, 1], [-1, 1]]:
		_beam(st, Vector3(c[0] * 1.6, 0, c[1] * 1.6), Vector3(c[0] * 1.3, Y, c[1] * 1.3), 0.22, C_PLANK_DARK)
	_beam(st, Vector3(-1.5, 1.0, -1.5), Vector3(1.4, 3.6, -1.4), 0.1, C_PLANK_DARK)
	_beam(st, Vector3(1.5, 1.0, -1.5), Vector3(-1.4, 3.6, -1.4), 0.1, C_PLANK_DARK)
	var tank := CylinderMesh.new()
	tank.top_radius = 2.2
	tank.bottom_radius = 2.3
	tank.height = 3.2
	tank.radial_segments = 12
	tank.rings = 1
	_prim(st, tank, Transform3D(Basis.IDENTITY, Vector3(0, Y + 1.6, 0)), C_PLANK)
	for y in [0.4, 1.6, 2.8]:
		var hoop := CylinderMesh.new()
		hoop.top_radius = 2.34
		hoop.bottom_radius = 2.34
		hoop.height = 0.12
		hoop.radial_segments = 12
		hoop.rings = 1
		_prim(st, hoop, Transform3D(Basis.IDENTITY, Vector3(0, Y + y, 0)), C_STEEL_DARK)
	var roof := CylinderMesh.new()
	roof.top_radius = 0.2
	roof.bottom_radius = 2.6
	roof.height = 1.0
	roof.radial_segments = 12
	roof.rings = 1
	_prim(st, roof, Transform3D(Basis.IDENTITY, Vector3(0, Y + 3.7, 0)), C_TIN)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	clearings.append([Vector2(p.x, p.z), 5.0])
	_callout(body, "water tank", site, "tank", Color("8fb3c4"))


# --- easter eggs ----------------------------------------------------------------

## Markers for scripts/easter_eggs.gd. Tumbleweeds and roadrunners sit on the
## centreline, facing along it, with meta "edge" (metres to the sand); the
## rest where the thing is.
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
		m.set_meta("side", side)
		var p := _g(pts[i] + _right(i) * side * float(spot[3]))
		m.transform = Transform3D(Basis.looking_at(tans[i], Vector3.UP), p)
		match kind:
			"skull":
				# In the mouth of the mine road, on the spur's far side, turned
				# to the cars coming: the LOST COW sign at the fork.
				var s: Dictionary = spurs[0]
				i = s.j
				var sp: PackedVector3Array = s.pts
				var q: Vector3 = sp[mini(9, sp.size() - 1)]
				var r := Vector3(-s.tans[9].z, 0, s.tans[9].x)
				var sd := -1.0 if r.dot(pts[i + 10] - q) > 0.0 else 1.0 # away from the stage
				p = _g(q + r * sd * (ROAD_HALF_WIDTH + SHOULDER + BERM + 1.2))
				m.transform = Transform3D(Basis.looking_at(-tans[maxi(i - 20, 0)], Vector3.UP).rotated(Vector3.UP, -sd * 0.3), p)
				clearings.append([Vector2(p.x, p.z), 2.0])
			"vultures":
				p = _g(pts[i] + _right(i) * side * float(spot[3]))
				m.transform = Transform3D(Basis.IDENTITY, p)
			"ufo":
				side = ufo_spot[1]
				p = _g(ufo_spot[2])
				m.transform = Transform3D(_facing_road(i, p), p)
				clearings.append([Vector2(p.x, p.z), 15.0])
				_sightline([i, side, p])
		m.set_meta("distance_m", i * STEP)
		m.set_meta("edge", half_w[i] + verge_w[i] + BERM)
		g.add_child(m)
		k += 1
	print("egg spots: %d" % k)


# --- scatter --------------------------------------------------------------------

const TALL_IDS := ["saguaro", "cactus_short", "hoodoo_b", "hoodoo_g", "hoodoo_h", "red_rock_b", "red_rock_d"]
const TALL_RADII := [0.45, 0.4, 2.6, 1.9, 2.1, 2.0, 2.2]
const FLOOR_IDS := ["scrub", "scrub_tri", "dry_grass", "pebble", "sand_rock_b", "red_rock_e", "sand_rock_a"]
const FLOOR_RADII := [0.0, 0.0, 0.0, 0.0, 1.4, 2.0, 0.9]
const SOLID_R := 40.0


## Cacti, hoodoos and boulders, scrub and stones. Sparse on the floors, a
## band of fallen boulders at the foot of every wall (talus, which is also
## what makes the walls read as rock at eye level), sparser on the tableland.
## Nothing on a cliff face.
func _scatter(bb: Rect2) -> void:
	var area := bb.grow(60.0)
	var chunks := {}
	var counts := {}
	var edge := ROAD_HALF_WIDTH + SHOULDER + BERM + 0.6
	const CELL := 5.0
	var x := area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, CELL)
			var pz := z + rng.randf_range(0.0, CELL)
			z += CELL
			var d := _fast_dist(px, pz)
			var r := rng.randf()
			var yaw := rng.randf() * TAU
			if d < edge or not _clear(px, pz):
				continue
			var up := terrain.normal_at(px, pz).y
			var y := terrain.height_at(px, pz)
			var ni := _near[clampi(roundi((pz - _grid_origin.y) / TERRAIN_CELL), 0, _gd - 1) * _gw + clampi(roundi((px - _grid_origin.x) / TERRAIN_CELL), 0, _gw - 1)]
			var above := y - all_h[ni]
			var solid := d < SOLID_R
			var sgn := 1.0 if solid else -1.0
			if up < 0.72:
				continue # cliff face
			# Talus: where the ground starts to rise into a wall.
			var foot := up < 0.93 and above < 6.0
			if foot:
				if r < 0.3:
					var id: String = ["red_rock_b", "red_rock_d", "hoodoo_e"][rng.randi() % 3] if r < 0.18 else "red_rock_e"
					var s := rng.randf_range(0.6, 1.3)
					if id == "hoodoo_e":
						_add(chunks, counts, "hoodoo_h", px, y - 0.4, pz, yaw, s * sgn)
					elif id == "red_rock_e":
						_add(chunks, counts, id, px, y - 0.2, pz, yaw, s * sgn)
					else:
						_add(chunks, counts, id, px, y - 0.3, pz, yaw, s * sgn)
				continue
			var plateau := above > 6.0
			var k := 0.45 if plateau else 1.0
			if r < 0.035 * k:
				_add(chunks, counts, "saguaro", px, y - 0.1, pz, yaw, rng.randf_range(0.75, 1.25) * sgn)
			elif r < 0.07 * k:
				_add(chunks, counts, "cactus_short", px, y - 0.05, pz, yaw, rng.randf_range(0.8, 1.2) * sgn)
			elif r < 0.08 * k and d > 14.0:
				_add(chunks, counts, ["hoodoo_b", "hoodoo_g", "hoodoo_h"][rng.randi() % 3], px, y - 0.5, pz, yaw, rng.randf_range(0.7, 1.3) * sgn)
			elif r < 0.25 * k:
				_add(chunks, counts, "scrub" if r < 0.17 * k else "scrub_tri", px, y - 0.05, pz, yaw, rng.randf_range(0.7, 1.3))
			elif r < 0.29 * k:
				_add(chunks, counts, "dry_grass", px, y, pz, yaw, rng.randf_range(0.6, 1.1))
			elif r < 0.36 * k:
				_add(chunks, counts, "pebble", px, y - 0.05, pz, yaw, rng.randf_range(0.6, 1.4))
			elif r < 0.38 * k:
				_add(chunks, counts, "sand_rock_a" if r < 0.37 * k else "sand_rock_b", px, y - 0.1, pz, yaw, rng.randf_range(0.6, 1.1) * sgn)
		x += CELL
	# Tufts and stones along the berms.
	for i in range(0, n, 3):
		for side: float in [-1.0, 1.0]:
			if rng.randf() < 0.45:
				var q := pts[i] + _right(i) * side * (half_w[i] + verge_w[i] + BERM * rng.randf_range(0.4, 1.4))
				if _clear(q.x, q.z):
					_add(chunks, counts, "dry_grass" if rng.randf() < 0.5 else "pebble", q.x, terrain.height_at(q.x, q.z), q.z, rng.randf() * TAU, rng.randf_range(0.5, 0.9))
	var g := _group("Forest")
	var keys := chunks.keys()
	keys.sort()
	var solid_total := 0
	for key in keys:
		var by_id: Dictionary = chunks[key]
		for kind in ["trees", "floor"]:
			var ids: Array = TALL_IDS if kind == "trees" else FLOOR_IDS
			var radii: Array = TALL_RADII if kind == "trees" else FLOOR_RADII
			var sc := Scatter.new()
			sc.name = "%s_%d_%d" % [kind.capitalize(), key.x, key.y]
			sc.collision_layer = LAYER_WORLD
			sc.collision_mask = 0
			sc.add_to_group("track_obstacle", true)
			sc.set_meta("kind", "tree" if kind == "trees" else "floor")
			sc.collider_height = 6.0 if kind == "trees" else 1.4
			sc.tint_jitter = 0.08
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
					for q in range(4, data.size(), Scatter.STRIDE):
						solid_total += 1 if data[q] > 0.0 else 0
			if any:
				g.add_child(sc)
			else:
				sc.free()
	print("scatter: %s in %d chunks, %d solid" % [counts, keys.size(), solid_total])


# --- map overlay -------------------------------------------------------------------

func _map_overlay() -> void:
	var g := _group("MapOverlay")
	var y := Vector3(0, 40.0, 0)
	var st := _st()
	_ribbon(st, pts, 4.5, Color("f1e2c0"), y)
	for s in spurs:
		_ribbon(st, s.pts, 4.5, Color("f1e2c0"), y)
	var bodies := [[track.get_node("StoneArch"), "arch", Color("b5532f")], [_landmarks().get_node("FuelDepot"), "drums", Color("e8c21c")],
		[_landmarks().get_node("RadioTower"), "mast", Color("ecf0f1")]]
	for b in bodies:
		var at: Vector3 = (b[0] as Node3D).transform.origin
		at.y = y.y + 0.6
		for part in _big_icon(b[1]):
			for o in Geometry2D.offset_polygon(part, 2.6, Geometry2D.JOIN_MITER):
				_flat_poly(st, o, at - Vector3(0, 0.15, 0), Color("1a1a1a"))
		for part in _big_icon(b[1]):
			_flat_poly(st, part, at, b[2])
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


## Big-landmark icons (before ICON_SCALE): an arch, a drum seen from above, a mast.
func _big_icon(kind: String) -> Array:
	match kind:
		"arch":
			var out := PackedVector2Array()
			for k in 9:
				var a := PI + PI * k / 8.0
				out.append(Vector2(cos(a), sin(a) * 1.1) * 13.0)
			for k in 9:
				var a := TAU - PI * k / 8.0
				out.append(Vector2(cos(a), sin(a) * 1.1) * 7.0)
			return [out]
		"drums":
			var parts: Array = []
			for c in [Vector2(-7, 4), Vector2(7, 4), Vector2(0, -7)]:
				var o := PackedVector2Array()
				for k in 10:
					o.append(c + Vector2(cos(TAU * k / 10.0), sin(TAU * k / 10.0)) * 6.5)
				parts.append(o)
			return parts
		"mast":
			return [PackedVector2Array([Vector2(-8, 13), Vector2(8, 13), Vector2(0, -15)])]
	return []
