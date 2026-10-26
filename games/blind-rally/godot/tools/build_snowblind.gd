extends "res://tools/stage_builder.gd"
## Generates scenes/tracks/snowblind.scn: Snowblind, the hard stage (spec
## §6: icy alpine switchbacks and tight hairpins; frozen pond, chalet, ski
## lift). Deterministic. Run after tools/bake_assets.gd:
##   godot --headless --path . --script res://tools/build_snowblind.gd
## (`-- preview` stops after the route and writes its plan to user://.)
##
## A hill climb up one mountainside: out of the valley past the chalet, up a
## stack of four switchback hairpins, a long fast traverse under the ski
## lift and past the frozen pond on its shelf, two more hairpins, then the
## last climb to the top station. About 100 m of height, nearly all of it in
## the hairpins' legs.
##
## The road is packed snow ("snow": slides more than gravel), with patches of
## sheet ice ("ice": hardly grips) on the fast stretches and gritted gravel
## ("road": full grip) through every hairpin, each its own surface probe a
## hair above the road's. Snowbanks line both sides (low, solid, you lean on
## them, they don't stop you dead), with gaps only where a yard is. Rock cuts
## between the stacked legs (the ground's own rock shading on the steep
## ground, plus snow-capped granite) and snow-loaded spruce do the hiding at
## eye level.
##
## Terrain: near the road, the road's own height (blended over nearby
## samples, so the ground between two legs ramps up as a rock cut); further
## out, a plane fitted to the whole road plus the road's residual smoothed
## outward, so the mountain carries on the way the road climbs it; ridges
## and peaks rise with distance from the road.
##
## Saved binary, like the other two: it's mostly numbers.

const OUT := "res://scenes/tracks/snowblind.scn"
const BIOME := "res://biomes/snow.tres"
const SEED := 37
const ROAD_HALF_WIDTH := 2.8 ## the narrowest stage: 5.6 m of packed snow
const SHOULDER := 0.6
const BANK_W := 2.0 ## snowbank, inner foot to outer foot (the base's "ditch")
const BANK_H := 1.0 ## nominal bank height; ±20% along the stage
const TERRAIN_AMP := 2.2

## The route as a turtle: start, heading (0 = east, + turns right, seen from
## above with north up), then segments ["S", metres, degrees of bend over
## them, grade] or ["H", radius, degrees, grade] for a hairpin (negative =
## left). The grade is rise per metre; it eases between segments.
const START := Vector2(-330, 250)
const ROUTE := [
	["S", 170.0, 0.0, 0.0], ["S", 90.0, 0.0, 0.03], # the valley, past the chalet
	["H", 13.0, -180.0, 0.04], # H1: into the stack
	["S", 160.0, 5.0, 0.085],
	["H", 12.0, 180.0, 0.04], # H2
	["S", 160.0, -5.0, 0.085],
	["H", 13.0, -180.0, 0.04], # H3
	["S", 160.0, 5.0, 0.085],
	["H", 14.0, 178.0, 0.04], # H4: out onto the traverse
	["S", 150.0, -8.0, 0.03], ["S", 160.0, 14.0, 0.05], ["S", 160.0, -6.0, 0.03], # under the lift, past the pond
	["H", 13.0, -180.0, 0.04], # H5
	["S", 130.0, 4.0, 0.085],
	["H", 12.0, 180.0, 0.04], # H6
	["S", 130.0, -4.0, 0.085],
	["H", 13.0, -180.0, 0.04], # H7
	["S", 120.0, 10.0, 0.06], ["S", 140.0, -20.0, 0.04], ["S", 120.0, 25.0, 0.03], ["S", 60.0, 0.0, 0.0], # the top
]


## Checkpoints by stage metres: mid-leg, on the straights, never in a hairpin.
const CP_AT := [380.0, 790.0, 1090.0, 1480.0, 1940.0]
const CHALET_AT := 84.0
## The lift: bottom station in the valley east of the first hairpin, top
## station just over the last climb. The road passes under it twice.
const LIFT_BASE := Vector2(-5, 236)
const LIFT_TOP := Vector2(-5, 14)
const POND := Vector2(98, 186) ## on its shelf below the traverse
const POND_R := 16.0
## Smaller callouts: [id, stage metres, side (+1 right of travel, -1 left),
## metres off the centreline, flat-ground radius].
const SCENERY := [
	["shrine", 172.0, 1.0, 6.6, 0.0],
	["plough", 1012.0, -1.0, 9.5, 9.0],
	["fence", 1868.0, 1.0, 19.0, 0.0],
	["skihut", 2072.0, -1.0, 12.0, 8.0],
]
## Easter-egg spots: [kind, stage metres, side, metres off the centreline].
## The skiers come down the piste under the lift (they cross where it does).
const EGG_SPOTS := [
	["snowman", 150.0, 1.0, 0.0], ["snowman", 1036.0, -1.0, 0.0], ["snowman", 1904.0, -1.0, 0.0],
	["skier", -1.0, -1.0, 0.0], ["skier", -2.0, 1.0, 0.0],
	["elk", 206.0, 1.0, 17.0], ["elk", 1984.0, -1.0, 18.0],
	["snowmobile", 940.0, -1.0, 0.0], ["snowmobile", 1846.0, 1.0, 0.0],
	["yeti", 2094.0, 1.0, 24.0],
]
const TRAIL_LEN := 150.0 ## the groomed snowmobile trail beside the road
const TRAIL_LAT := 11.0

## Palette (sRGB).
const C_PACK := Color("d3d8dd") ## packed snow
const C_RUT := Color("b1b3b0") ## polished wheel tracks, a little dirt showing
const C_CROWN := Color("dde1e5")
const C_VERGE := Color("e4e8ec")
const C_EDGE := Color("ccd2d8")
const C_FOOT := Color("bfc6cd")
const C_ICE := Color("8099ad")
const C_GRIT := Color("958b7f")
const C_GRIT_RUT := Color("776e63")
const C_BANK := Color("eef1f4")
const C_BANK_FACE := Color("dce2e7")
const C_FLOOR_REF := Color("5a4a36") ## ground.gdshader's REF: tints are value relative to it
const C_YARD := Color("bfc4c8")
const C_PISTE := Color("e9edf1")
const C_TIMBER := Color("7a5134")
const C_TIMBER_DARK := Color("553823")
const C_STONE := Color("8b8c8e")
const C_SHUTTER := Color("2f5d3a")
const C_ROOF := Color("4a3a30")
const C_SNOW := Color("f3f5f7")
const C_STEEL := Color("8a9096")
const C_STEEL_DARK := Color("5c6066")
const C_CHAIR := Color("c0392b")
const C_ORANGE := Color("e67e22")
const C_YELLOW := Color("f1c40f")
const C_GLASS := Color("2c3a40")
const C_RED := Color("b8352a")


var preview := false
var ice_w := PackedFloat32Array() ## per sample: 1 on sheet ice
var grit_w := PackedFloat32Array() ## per sample: 1 on gritted gravel
var ice_patches: Array = [] ## [first sample, last sample]
var grit_patches: Array = []
var bank_gaps: Array = [] ## [s0, s1, side (0 = both)] in stage metres
var pads: Array = [] ## [Vector2 centre, radius, height]: flat ground off the road
var _plane := Vector3.ZERO ## far-field plane: h = x + y*px + z*pz
var _res := PackedFloat32Array() ## smoothed residual on a coarse grid
var _res_rect := Rect2()
var _res_w := 0
var _res_h := 0
var _hmin := 0.0
var _hmax := 0.0
var ridge_noise := FastNoiseLite.new()
var chalet_spot: Array
var lift_line: Array = [] ## pylon tops, base to top (Vector3)
var lift_cross: Array = [] ## stage metres where the road passes under the lift
var trails: Array = [] ## [first sample, last sample, side]


func _init() -> void:
	preview = OS.get_cmdline_user_args().has("preview")
	stage_seed = SEED
	control = _route_points()
	route_scale = 1.0
	wobble = 0.7
	kink_count = 8
	gate_width = ROAD_HALF_WIDTH * 2 + 8
	ditch = BANK_W
	road_half_width = ROAD_HALF_WIDTH
	shoulder = SHOULDER
	road_surface = "snow"
	hay = false
	rng.seed = SEED
	srng.seed = SEED + 21
	noise.seed = SEED
	noise.frequency = 0.02
	ridge_noise.seed = SEED + 41
	ridge_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	ridge_noise.frequency = 0.006
	_sample_centerline()
	_build_hash()
	track = Track.new()
	track.name = "Snowblind"
	track.track_id = "snowblind"
	track.display_name = "Snowblind"
	track.difficulty = "hard"
	track.centerline = pts
	track.length_m = (n - 1) * STEP
	_find_corners()
	_shape_road()
	if preview:
		_preview()
		track.free()
		quit(0)
		return
	track.biome = load(BIOME)
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
	for id in ["snow_pine_a", "snow_pine_b", "snow_pine_c", "snow_pine_small", "granite_l", "granite_m", "granite_s",
			"snow_pile", "lantern", "bench", "arch", "flag_red", "flag_green", "tent", "cone", "log_stack"]:
		meshes[id] = load(MESH_DIR + id + ".res")
	_cheap_meshes()
	cp_fractions = []
	for m in CP_AT:
		cp_fractions.append((float(m) / STEP + 0.5) / n)
	var bb := _road_bounds()
	bb = bb.expand(LIFT_BASE).expand(LIFT_TOP).expand(POND + Vector2(0, POND_R))
	bb = bb.expand(Vector2(pts[int(CHALET_AT / STEP)].x, pts[int(CHALET_AT / STEP)].z) + Vector2(0, 16.0))
	bb = bb.grow(30.0)
	track.bounds = bb
	_plan()
	_plan_sites()
	_patches()
	_build_dist_grid(bb.grow(90.0))
	_far_field(bb.grow(80.0))
	_bake_heights(bb)
	track.centerline = pts
	_plan_lift()
	_env()
	_road()
	_patch_probes()
	_banks()
	_world_walls(bb)
	_markers()
	_arches()
	_service_and_stop()
	_corner_furniture()
	_merge_chevrons()
	_chalet()
	_ski_lift()
	_frozen_pond()
	_scenery()
	_egg_spots()
	_spectators()
	_merge_props()
	_rock_walls()
	_index_clearings()
	_forest(bb)
	_ground_tints()
	_map_overlay()
	var err := _save(OUT)
	print("saved %s (err %d): %d samples, %.0f m, bounds %s, %d corners" % [OUT, err, n, track.length_m, bb, corners.size()])
	track.free()
	quit(0 if err == OK else 1)


var seg_ends := PackedFloat32Array() ## turtle metres where each ROUTE segment ends


## Control points every ~8 m along the turtle route.
func _route_points() -> Array:
	var p := START
	var a := 0.0
	var out: Array = [p]
	var total := 0.0
	for seg in ROUTE:
		var turn := deg_to_rad(float(seg[2]))
		var length: float = float(seg[1]) * absf(turn) if seg[0] == "H" else float(seg[1])
		var steps := maxi(ceili(length / 8.0), 1)
		for k in steps:
			var da := turn / steps
			var mid := a + da * 0.5
			p += Vector2(cos(mid), sin(mid)) * (length / steps)
			a += da
			out.append(p)
		total += length
		seg_ends.append(total)
	return out


## Grade at stage metres s: the segment's, eased over 30 m into the next.
## (The wobble stretches the stage a little; the ends are scaled to fit.)
func _grade_at(s: float) -> float:
	var u := s * seg_ends[seg_ends.size() - 1] / track.length_m
	for k in seg_ends.size():
		if u <= seg_ends[k] or k == seg_ends.size() - 1:
			var g := float(ROUTE[k][3])
			if k + 1 < ROUTE.size():
				g = lerpf(g, float(ROUTE[k + 1][3]), smoothstep(seg_ends[k] - 15.0, seg_ends[k] + 15.0, u))
			if k > 0:
				g = lerpf(float(ROUTE[k - 1][3]), g, smoothstep((seg_ends[k - 1]) - 15.0, seg_ends[k - 1] + 15.0, u))
			return g
	return 0.0


## Width, verge, camber and height per sample. Height is the grade
## integrated along the stage, eased off in the hairpins.
func _shape_road() -> void:
	var wn := FastNoiseLite.new()
	wn.seed = SEED + 7
	wn.frequency = 1.0
	var raw_w := PackedFloat32Array()
	var raw_b := PackedFloat32Array()
	var h := 0.0
	for i in n:
		var s := i * STEP
		var r := _radius(i)
		# Hairpins get room to swing the tail round (and the cars cut them).
		raw_w.append(ROAD_HALF_WIDTH + wn.get_noise_1d(s / 70.0) * 0.25 + 1.3 * (1.0 - smoothstep(14.0, 28.0, r)))
		raw_b.append(signf(_turn(i)) * 0.03 * (1.0 - smoothstep(30.0, 90.0, r)))
		if i > 0:
			h += _grade_at(s) * STEP
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
		verge_w.append(clampf(SHOULDER + wn.get_noise_1d(i * STEP / 29.0 + 100.0) * 0.25, 0.35, 0.9))


## The plan as numbers and a picture (user://snowblind_plan.png): the route
## coloured by height, hairpins marked, and how far apart stacked legs run.
func _preview() -> void:
	var bb := _road_bounds().grow(20.0)
	print("length %.0f m, bounds %s, climb %.1f m" % [track.length_m, bb, profile_h[n - 1]])
	for c in corners:
		print("  corner at %4d m r %4.1f %s  h %.1f" % [c[0] * STEP, c[1], "R" if c[2] < 0 else "L", profile_h[c[0]]])
	# Nearest other part of the road (more than 60 m of stage away), per 50 m.
	for i in range(0, n, 25):
		var best := INF
		var bj := 0
		for j in n:
			if absi(j - i) * STEP < 60.0:
				continue
			var d := Vector2(pts[i].x - pts[j].x, pts[i].z - pts[j].z).length()
			if d < best:
				best = d
				bj = j
		print("  %4d m (%4.0f, %4.0f) h %5.1f: nearest other road %.0f m away (at %d m, %+.1f m height)" % [i * STEP, pts[i].x, pts[i].z, profile_h[i], best, bj * STEP, profile_h[bj] - profile_h[i]])
	var k := 2.0
	var img := Image.create(int(bb.size.x / k) + 1, int(bb.size.y / k) + 1, false, Image.FORMAT_RGB8)
	img.fill(Color(0.1, 0.1, 0.12))
	var top := profile_h[n - 1]
	for i in n:
		var c := Color.from_hsv(0.66 * (1.0 - profile_h[i] / maxf(top, 1.0)), 0.8, 1.0)
		for dx in range(-1, 2):
			for dz in range(-1, 2):
				img.set_pixel(clampi(int((pts[i].x - bb.position.x) / k) + dx, 0, img.get_width() - 1), clampi(int((pts[i].z - bb.position.y) / k) + dz, 0, img.get_height() - 1), c)
	for c in corners:
		var p := pts[c[0]]
		for dx in range(-3, 4):
			img.set_pixel(clampi(int((p.x - bb.position.x) / k) + dx, 0, img.get_width() - 1), clampi(int((p.z - bb.position.y) / k), 0, img.get_height() - 1), Color.WHITE)
	img.save_png("user://snowblind_plan.png")
	print("plan: ", ProjectSettings.globalize_path("user://snowblind_plan.png"))


# --- sites, patches ----------------------------------------------------------------

## Where things go, decided before the ground is shaped (it flattens for them).
func _plan_sites() -> void:
	spawn_i = int(24.0 / STEP)
	finish_i = n - 1 - int(60.0 / STEP)
	var ci := int(CHALET_AT / STEP)
	chalet_spot = [ci, 1.0, pts[ci] + _right(ci) * 23.0]
	pads.append([Vector2(chalet_spot[2].x, chalet_spot[2].z), 13.0, profile_h[ci]])
	bank_gaps.append([CHALET_AT - 8.0, CHALET_AT + 8.0, 1.0])
	var start := pts[0] - tans[0] * 8.0
	pads.append([Vector2(start.x, start.z), 26.0, 0.0])
	var stop := pts[n - 1] + tans[n - 1] * 12.0
	pads.append([Vector2(stop.x, stop.z), 22.0, profile_h[n - 1]])
	# Banks open for the service park, the arches, the stop yard.
	bank_gaps.append([-10.0, 44.0, 0.0])
	bank_gaps.append([(spawn_i + 8) * STEP - 10.0, (spawn_i + 8) * STEP + 10.0, 0.0])
	bank_gaps.append([finish_i * STEP - 10.0, finish_i * STEP + 10.0, 0.0])
	bank_gaps.append([(n - 1) * STEP - 16.0, (n - 1) * STEP + 10.0, 0.0])
	# Where the lift line crosses the road: a piste crossing, banks cut back.
	for i in n - 1:
		var hit = Geometry2D.segment_intersects_segment(Vector2(pts[i].x, pts[i].z), Vector2(pts[i + 1].x, pts[i + 1].z), LIFT_BASE, LIFT_TOP)
		if hit != null:
			lift_cross.append(i * STEP)
			bank_gaps.append([i * STEP - 6.0, i * STEP + 6.0, 0.0])
	print("lift crosses the road at %s m" % [lift_cross])
	pads.append([LIFT_BASE, 12.0, profile_h[_nearest_sample(LIFT_BASE.x, LIFT_BASE.y)] - 1.0])
	pads.append([LIFT_TOP, 10.0, profile_h[_nearest_sample(LIFT_TOP.x, LIFT_TOP.y)] + 1.0])
	pads.append([POND, POND_R + 5.0, profile_h[_nearest_sample(POND.x, POND.y)] - 1.2])
	for sc in SCENERY:
		var i := clampi(int(float(sc[1]) / STEP), 0, n - 1)
		var side: float = sc[2]
		var p := pts[i] + _right(i) * side * float(sc[3])
		scenery_sites[sc[0]] = [i, side, p]
		if float(sc[4]) > 0.0:
			pads.append([Vector2(p.x, p.z), float(sc[4]), profile_h[i]])
			bank_gaps.append([i * STEP - 7.0, i * STEP + 7.0, side])
	for spot in EGG_SPOTS:
		if spot[0] == "snowmobile":
			var i0 := int(float(spot[1]) / STEP)
			trails.append([i0, mini(i0 + int(TRAIL_LEN / STEP), n - 1), float(spot[2])])


## Gritted gravel through every hairpin (full grip: the hairpins are
## makeable), sheet ice on some of the fast stretches between (hardly any).
## Each a weight per sample, eased over 6 m, for the road colours; the
## probes take the middle of each.
func _patches() -> void:
	ice_w.resize(n)
	grit_w.resize(n)
	ice_w.fill(0.0)
	grit_w.fill(0.0)
	var spans: Array = []
	for c in corners:
		if c[1] >= 22.0:
			continue
		var apex: int = c[0]
		var last: int = c[3]
		var first := 2 * apex - last
		spans.append([minf(apex * STEP - 30.0, first * STEP - 14.0), maxf(apex * STEP + 22.0, last * STEP + 10.0)])
	for sp in spans:
		grit_patches.append([int(sp[0] / STEP), int(sp[1] / STEP)])
		for i in n:
			var s := i * STEP
			grit_w[i] = maxf(grit_w[i], smoothstep(sp[0] - 6.0, sp[0], s) * (1.0 - smoothstep(sp[1], sp[1] + 6.0, s)))
	var avoid: Array = [] # stage metres to keep ice away from
	for m in CP_AT:
		avoid.append(m)
	for m in lift_cross:
		avoid.append(m)
	avoid.append((spawn_i + 8) * STEP)
	avoid.append(finish_i * STEP)
	var s := 120.0
	while s < finish_i * STEP - 60.0:
		s += srng.randf_range(80.0, 150.0)
		var half := srng.randf_range(8.0, 16.0)
		var ok := true
		for sp in spans:
			ok = ok and (s + half + 18.0 < sp[0] or s - half - 18.0 > sp[1])
		for a in avoid:
			ok = ok and absf(s - a) > half + 20.0
		for i in range(int((s - half - 6.0) / STEP), int((s + half + 6.0) / STEP)):
			ok = ok and _radius(clampi(i, 0, n - 1)) > 45.0
		if not ok:
			s -= 60.0 # try again a little further on
			continue
		ice_patches.append([int((s - half) / STEP), int((s + half) / STEP)])
		for i in n:
			ice_w[i] = maxf(ice_w[i], 1.0 - smoothstep(half, half + 6.0, absf(i * STEP - s)))
	var ice_m := 0.0
	for p in ice_patches:
		ice_m += (p[1] - p[0]) * STEP
	print("grit: %d hairpins; ice: %d patches, %.0f m: %s" % [grit_patches.size(), ice_patches.size(), ice_m, ice_patches.map(func(p: Array) -> String: return "%d-%d" % [p[0] * STEP, p[1] * STEP])])


## Surface probes for the patches, a hair above the road's, so the car's
## ray (closest hit) reads them first. Road width only: the verge is snow.
func _patch_probes() -> void:
	var k := 0
	for p in ice_patches:
		_probe_body("Ice%d" % k, "ice", p[0], p[1])
		k += 1
	k = 0
	for p in grit_patches:
		_probe_body("Grit%d" % k, "road", p[0], p[1])
		k += 1


func _probe_body(name: String, surface: String, i0: int, i1: int) -> void:
	var faces := PackedVector3Array()
	for i in range(clampi(i0, 0, n - 2), clampi(i1, 1, n - 1)):
		for k in 3:
			var f0 := -1.0 + k * 2.0 / 3.0
			var f1 := -1.0 + (k + 1) * 2.0 / 3.0
			var a := _g(pts[i] + _right(i) * half_w[i] * f0, 0.03)
			var b := _g(pts[i] + _right(i) * half_w[i] * f1, 0.03)
			var c := _g(pts[i + 1] + _right(i + 1) * half_w[i + 1] * f0, 0.03)
			var d := _g(pts[i + 1] + _right(i + 1) * half_w[i + 1] * f1, 0.03)
			faces.append_array([a, c, b, b, c, d])
	var body := StaticBody3D.new()
	body.name = name
	body.add_to_group("track_road", true)
	body.set_meta("surface", surface)
	body.set_meta("from_m", i0 * STEP)
	body.set_meta("to_m", i1 * STEP)
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


# --- terrain ------------------------------------------------------------------------

## The mountain away from the road: a plane fitted to the whole road (it
## climbs north), plus what's left of the road's height after the plane,
## smoothed outward on a 16 m grid, so the slope carries on the way the road
## climbs it. Clamped, so the far corners don't run off to the sky.
func _far_field(area: Rect2) -> void:
	# Least squares h = a + b x + c z over every 4th sample.
	var m := Basis(Vector3.ZERO, Vector3.ZERO, Vector3.ZERO)
	var r := Vector3.ZERO
	var sx := 0.0
	var sz := 0.0
	var sxx := 0.0
	var szz := 0.0
	var sxz := 0.0
	var sh := 0.0
	var sxh := 0.0
	var szh := 0.0
	var cnt := 0.0
	_hmin = INF
	_hmax = -INF
	for i in range(0, n, 4):
		var x := pts[i].x
		var z := pts[i].z
		var h := profile_h[i]
		sx += x; sz += z; sxx += x * x; szz += z * z; sxz += x * z
		sh += h; sxh += x * h; szh += z * h
		cnt += 1.0
		_hmin = minf(_hmin, h)
		_hmax = maxf(_hmax, h)
	m = Basis(Vector3(cnt, sx, sz), Vector3(sx, sxx, sxz), Vector3(sz, sxz, szz))
	r = Vector3(sh, sxh, szh)
	_plane = m.inverse() * r
	print("far plane: h = %.1f %+.3f x %+.3f z" % [_plane.x, _plane.y, _plane.z])
	const CELL := 16.0
	_res_rect = area.grow(CELL)
	_res_w = int(ceil(_res_rect.size.x / CELL)) + 1
	_res_h = int(ceil(_res_rect.size.y / CELL)) + 1
	_res.resize(_res_w * _res_h)
	for gz in _res_h:
		for gx in _res_w:
			var x := _res_rect.position.x + gx * CELL
			var z := _res_rect.position.y + gz * CELL
			var sw := 0.6 # prior: far from the road, the plane alone
			var sr := 0.0
			for i in range(0, n, 4):
				var d2 := Vector2(x - pts[i].x, z - pts[i].z).length_squared()
				if d2 > 14400.0:
					continue
				var w := exp(-d2 / 1600.0)
				sw += w
				sr += w * (profile_h[i] - _plane_at(pts[i].x, pts[i].z))
			_res[gz * _res_w + gx] = sr / sw


func _plane_at(x: float, z: float) -> float:
	return _plane.x + _plane.y * x + _plane.z * z


func _far_at(x: float, z: float) -> float:
	var fx := clampf((x - _res_rect.position.x) / 16.0, 0.0, _res_w - 1.001)
	var fz := clampf((z - _res_rect.position.y) / 16.0, 0.0, _res_h - 1.001)
	var ix := int(fx)
	var iz := int(fz)
	var tx := fx - ix
	var tz := fz - iz
	var a := lerpf(_res[iz * _res_w + ix], _res[iz * _res_w + ix + 1], tx)
	var b := lerpf(_res[(iz + 1) * _res_w + ix], _res[(iz + 1) * _res_w + ix + 1], tx)
	return clampf(_plane_at(x, z) + lerpf(a, b, tz), _hmin - 10.0, _hmax + 22.0)


## Ground height before baking. Near the road: the road's own height (and
## camber), blended over nearby samples by distance, so between two stacked
## legs the ground ramps from one to the other in a few metres: a rock cut,
## too steep to drive (that's the eye-level cover between the legs, and
## what stops anyone cutting a hairpin). Further out: the far field, rolling
## snowfields, and ridges that rise the further you get from the road.
## Flat pads for the yards, the pond's shelf and the lift stations.
func _height(x: float, z: float) -> float:
	var d := _fast_dist(x, z)
	var far := _far_at(x, z)
	var roll := TERRAIN_AMP * smoothstep(8.0, 40.0, d) * (terrain_noise.get_noise_2d(x, z) * 0.8 + terrain_noise.get_noise_2d(x * 2.7 + 300.0, z * 2.7) * 0.2)
	var rn := 1.0 - absf(ridge_noise.get_noise_2d(x, z))
	var ridge := 18.0 * smoothstep(40.0, 170.0, d) * rn * rn
	far += roll + ridge
	for pd in pads:
		var w := 1.0 - smoothstep(float(pd[1]), float(pd[1]) + 14.0, Vector2(x, z).distance_to(pd[0]))
		far = lerpf(far, float(pd[2]), w)
	far = minf(far, _hmax + 38.0)
	var w_road := 1.0 - smoothstep(9.0, 30.0, d)
	if w_road <= 0.0:
		return far
	var sum := 0.0
	var wsum := 0.0
	var reach := d + 10.0
	var sig := 3.0 + d * 0.12
	var rr := ceili(reach / HASH_CELL)
	var cx := floori(x / HASH_CELL)
	var cz := floori(z / HASH_CELL)
	for ddx in range(-rr, rr + 1):
		for ddz in range(-rr, rr + 1):
			var k := Vector2i(cx + ddx, cz + ddz)
			if not _hash.has(k):
				continue
			for i in _hash[k]:
				var off := Vector2(x - pts[i].x, z - pts[i].z)
				var di := off.length()
				if di > reach:
					continue
				var wi := exp(-pow((di - d) / sig, 2.0))
				var lat := clampf(off.dot(Vector2(_right(i).x, _right(i).z)), -9.0, 9.0)
				sum += wi * (profile_h[i] + bank[i] * lat)
				wsum += wi
	var road_h := sum / wsum if wsum > 0.0 else far
	return lerpf(far, road_h, w_road)


## Road cross-section: packed snow with polished wheel tracks; brown-grey
## grit through the hairpins; blue-grey sheet ice (vertex alpha under 1, so
## the road shader glosses it and drops the loose stones).
func _profile(i: int) -> Array:
	var h := half_w[i]
	var v := h + verge_w[i]
	var cols := [
		[-(v + 0.7), C_FOOT, 0.15], [-v, C_EDGE, 0.12], [-h, C_VERGE, 0.15], [-1.9, C_PACK, 0.0], [-1.25, C_RUT, 0.0], [-0.5, C_CROWN, 0.0],
		[0.5, C_CROWN, 0.0], [1.25, C_RUT, 0.0], [1.9, C_PACK, 0.0], [h, C_VERGE, 0.15], [v, C_EDGE, 0.12], [v + 0.7, C_FOOT, 0.15],
	]
	var gw := grit_w[i]
	var iw := ice_w[i]
	for k in range(2, 10):
		var c: Color = cols[k][1]
		var rut := k == 4 or k == 7
		var verge := k == 2 or k == 9
		if gw > 0.0:
			c = c.lerp(C_GRIT_RUT if rut else C_GRIT, gw * (0.45 if verge else 0.85))
		if iw > 0.0 and not verge:
			c = c.lerp(C_ICE.darkened(0.08) if rut else C_ICE, iw * 0.9)
			c.a = lerpf(1.0, 0.08, iw)
		cols[k][1] = c
	return cols


# --- world -----------------------------------------------------------------------

func _env() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	# Low winter sun from the south: long blue shadows across the snow.
	sun.rotation_degrees = Vector3(-30, -160, 0)
	sun.light_color = Color(1.0, 0.95, 0.88)
	sun.light_energy = 1.05
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 110.0
	sun.shadow_opacity = 0.6
	sun.shadow_blur = 1.5
	track.add_child(sun)
	var we := WorldEnvironment.new()
	we.name = "Environment"
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("9fb2c6")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.77, 0.86)
	env.ambient_light_energy = 0.62
	we.environment = env
	track.add_child(we)


## How much bank stands at stage metres s on `side` (0 in a gap, eased over 5 m).
func _bank_open(s: float, side: float) -> float:
	var g := 1.0
	for gp in bank_gaps:
		if float(gp[2]) != 0.0 and float(gp[2]) != side:
			continue
		var out := maxf(float(gp[0]) - s, s - float(gp[1]))
		g = minf(g, smoothstep(0.0, 5.0, out))
	return g


## Snowbanks, both sides, the whole stage bar the gaps: what the plough
## threw up. Low (about a metre, ±20%), steep on the road side, rounded on
## top. Solid: the inner face and the top are a trimesh per road piece, so
## you lean on them and slide along; nothing stops you dead.
func _banks() -> void:
	const OFF := [0.0, 0.3, 0.75, 1.35, 2.0]
	const FR := [0.02, 0.62, 0.96, 0.88, -0.05]
	var cols := [C_BANK_FACE.darkened(0.06), C_BANK_FACE.lerp(C_BANK, 0.5), C_BANK, C_BANK, C_BANK.darkened(0.03)]
	var bn := FastNoiseLite.new()
	bn.seed = SEED + 51
	bn.frequency = 1.0
	var body := StaticBody3D.new()
	body.name = "Snowbanks"
	body.collision_layer = LAYER_WORLD
	body.collision_mask = 0
	body.add_to_group("track_obstacle", true)
	body.set_meta("kind", "snowbank")
	var total := 0.0
	var all_rows := {}
	var all_hbs := {}
	for side: float in [-1.0, 1.0]:
		var rows: Array = []
		var hbs := PackedFloat32Array()
		for i in n:
			# Long swells and short lumps: ploughed, not poured.
			var hb := BANK_H * (1.0 + 0.2 * bn.get_noise_1d(i * STEP / 23.0 + side * 50.0) + 0.14 * bn.get_noise_1d(i * STEP / 3.5 + side * 90.0)) * _bank_open(i * STEP, side)
			hbs.append(hb)
			var e0 := half_w[i] + verge_w[i] - 0.1
			var row: Array = []
			for k in OFF.size():
				var wob := bn.get_noise_2d(i * STEP / 2.5, k * 7.0 + side * 30.0) * 0.12 * float(k > 0 and k < 4)
				var p := _g(pts[i] + _right(i) * side * (e0 + float(OFF[k]) * (0.7 + 0.3 * hb / BANK_H) + wob))
				p.y += hb * float(FR[k]) + (0.02 if k == 0 else 0.0)
				row.append(p)
			rows.append(row)
			if hb > 0.25:
				total += STEP
		all_rows[side] = rows
		all_hbs[side] = hbs
	# Both sides, two road pieces' worth (240 m) per mesh: one draw. The
	# switchbacks stack the road in view of itself, so finer culling bought
	# little and cost a draw a piece.
	const BANK_PIECE := ROAD_PIECE * 2
	for i0 in range(0, n - 1, BANK_PIECE):
		var st := _st()
		var faces := PackedVector3Array()
		var any := false
		for side: float in [-1.0, 1.0]:
			var rows: Array = all_rows[side]
			var hbs: PackedFloat32Array = all_hbs[side]
			for i in range(i0, mini(i0 + BANK_PIECE, n - 1)):
				if hbs[i] < 0.05 and hbs[i + 1] < 0.05:
					continue
				any = true
				var shade := 1.0 + noise.get_noise_2d(pts[i].x * 3.0, pts[i].z * 3.0) * 0.04
				for k in OFF.size() - 1:
					var a: Vector3 = rows[i][k]
					var b: Vector3 = rows[i][k + 1]
					var c: Vector3 = rows[i + 1][k]
					var d: Vector3 = rows[i + 1][k + 1]
					var ca: Color = (cols[k] as Color) * shade
					var cb: Color = (cols[k + 1] as Color) * shade
					var quad := [[a, ca], [c, ca], [b, cb], [b, cb], [c, ca], [d, cb]] if side > 0 else [[a, ca], [b, cb], [c, ca], [b, cb], [d, cb], [c, ca]]
					for v in quad:
						st.set_color(Color(v[1].r, v[1].g, v[1].b, 1.0))
						st.add_vertex(v[0])
					if k < 2 and hbs[i] > 0.25:
						faces.append_array([a, c, b, b, c, d])
		if not any:
			continue
		st.index()
		st.generate_normals()
		var mi := _mesh_node("Bank%d" % (i0 / BANK_PIECE), _commit(st))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		body.add_child(mi)
		if not faces.is_empty():
			var shape := ConcavePolygonShape3D.new()
			shape.set_faces(faces)
			shape.backface_collision = true
			var cs := CollisionShape3D.new()
			cs.name = "Shape%d" % (i0 / BANK_PIECE)
			cs.shape = shape
			body.add_child(cs)
	track.add_child(body)
	print("snowbanks: %.0f m of bank, %d gaps" % [total, bank_gaps.size()])


## Service park in the valley before the start, stop control in the yard past
## the finish.
func _service_and_stop() -> void:
	var g := _group("ServiceAndStop")
	var start := _g(pts[0] - tans[0] * 8.0)
	yards.append([Vector2(start.x, start.z), 24.0, C_YARD])
	clearings.append([Vector2(start.x, start.z), 30.0])
	for k in 3:
		var side := -1.0 if k < 2 else 1.0
		var p := _g(pts[spawn_i] + _right(spawn_i) * side * 11.0 + tans[spawn_i] * (k * 8.0 - 26.0))
		var tent := _solid("Tent%d" % k, "tent", Transform3D(Basis.looking_at(tans[spawn_i], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)
	for k in 6:
		var p := _g(pts[0] + _right(0) * (k * 1.4 - 3.5))
		g.add_child(_mesh_node("Cone%d" % k, meshes["cone"], Transform3D(Basis.IDENTITY, p)))
	var end := _g(pts[n - 1] + tans[n - 1] * 12.0)
	clearings.append([Vector2(end.x, end.z), 22.0])
	yards.append([Vector2(end.x, end.z), 18.0, C_YARD])
	for k in 2:
		var p := _g(end + _right(n - 1) * (k * 10.0 - 5.0) + tans[n - 1] * 6.0)
		var tent := _solid("StopTent%d" % k, "tent", Transform3D(Basis.looking_at(tans[n - 1], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)


## Chevron boards merged per scatter chunk (as Dust Devil): seven hairpins
## stacked in view of each other would be a lot of draws otherwise.
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


## One mesh per landmark and per fan group: the benches, lanterns and flags
## all share the vertex-colour material, so as separate nodes they were just
## extra draws (twice over, with the shadow pass), and the switchbacks keep
## most of them in view at once.
func _merge_props() -> void:
	for g: Node in [track.get_node("Landmarks"), track.get_node("Spectators")]:
		for body in g.get_children():
			var parts: Array = body.get_children().filter(func(n: Node) -> bool:
				return n is MeshInstance3D and n.mesh and n.mesh.get_surface_count() == 1 \
					and n.mesh.surface_get_material(0) == vc_mat and n.layers == RENDER_WORLD \
					and n.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_ON)
			if parts.size() < 2:
				continue
			var st := _st()
			for mi: MeshInstance3D in parts:
				_merge(st, mi.mesh, mi.transform)
				body.remove_child(mi)
				mi.free()
			body.add_child(_mesh_node("Mesh", _commit(st)))


# --- landmarks --------------------------------------------------------------------

## A box with a snow cap on it: roofs, sills, everything up here wears one.
func _capped(st: SurfaceTool, xf: Transform3D, size: Vector3, col: Color, cap := 0.18) -> void:
	_box(st, xf, size, col)
	_box(st, xf * Transform3D(Basis.IDENTITY, Vector3(0, size.y * 0.5 + cap * 0.5, 0)), Vector3(size.x + 0.08, cap, size.z + 0.08), C_SNOW)


## The chalet: stone ground floor, timber above, a balcony across the gable
## end facing the road, deep eaves heavy with snow, green shutters, lanterns.
## Beside the valley road just after the start.
func _chalet() -> void:
	var i: int = chalet_spot[0]
	var p: Vector3 = _g(chalet_spot[2], -0.1)
	var body := _solid("Chalet", "landmark", Transform3D(_facing_road(i, p), p), Vector3(10.0, 6.0, 8.0))
	body.add_to_group("track_landmark", true)
	body.set_meta("label", "chalet")
	var st := _st()
	_box(st, _at(Vector3(0, 0.75, 0)), Vector3(10.0, 1.5, 8.0), C_STONE)
	for k in 7:
		_box(st, _at(Vector3(0, 1.75 + k * 0.42, 0)), Vector3(9.8 + (0.25 if k % 2 == 0 else 0.0), 0.42, 7.8 + (0.0 if k % 2 == 0 else 0.25)), C_TIMBER if k % 2 == 0 else C_TIMBER_DARK)
	# Gable: a prism, ridge along Z, so the front (+Z, the road) shows the triangle.
	var gable := PrismMesh.new()
	gable.size = Vector3(9.8, 2.6, 7.8)
	_prim(st, gable, _at(Vector3(0, 6.0, 0)), C_TIMBER)
	var roof := PrismMesh.new()
	roof.size = Vector3(12.4, 3.4, 10.6)
	_prim(st, roof, _at(Vector3(0, 6.15, 0)), C_ROOF)
	var snow := PrismMesh.new()
	snow.size = Vector3(12.2, 3.3, 10.8)
	_prim(st, snow, _at(Vector3(0, 6.45, 0)), C_SNOW)
	# Balcony across the front at the first floor, and its posts.
	_capped(st, _at(Vector3(0, 3.0, 4.75)), Vector3(10.4, 0.18, 1.5), C_TIMBER_DARK, 0.12)
	for x in [-4.9, -2.45, 0.0, 2.45, 4.9]:
		_box(st, _at(Vector3(x, 3.55, 5.4)), Vector3(0.12, 0.9, 0.12), C_TIMBER_DARK)
	_box(st, _at(Vector3(0, 4.0, 5.4)), Vector3(10.2, 0.1, 0.1), C_TIMBER_DARK)
	for x in [-4.9, 4.9]:
		_box(st, _at(Vector3(x, 1.5, 5.4)), Vector3(0.22, 3.0, 0.22), C_TIMBER_DARK)
	# Windows with shutters, the door, a chimney.
	for x in [-3.0, 3.0]:
		for y in [2.2, 4.4]:
			_box(st, _at(Vector3(x, y, 3.94)), Vector3(1.0, 1.0, 0.08), Color("d9c38a") if y < 3.0 else C_GLASS)
			for sx: float in [-0.8, 0.8]:
				_box(st, _at(Vector3(x + sx, y, 3.96)), Vector3(0.5, 1.1, 0.06), C_SHUTTER)
	_box(st, _at(Vector3(0, 1.1, 4.02)), Vector3(1.3, 2.2, 0.1), C_TIMBER_DARK)
	_capped(st, _at(Vector3(2.6, 7.6, -1.5)), Vector3(0.9, 2.4, 0.9), C_STONE, 0.2)
	# Firewood under the eaves.
	_merge(st, meshes["log_stack"], Transform3D(Basis(Vector3.UP, PI * 0.5), Vector3(-5.6, 0, -1.0)))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	for x in [-1.2, 1.2]:
		body.add_child(_mesh_node("Lantern", meshes["lantern"], Transform3D(Basis.IDENTITY, Vector3(x, 0, 5.9))))
	body.add_child(_mesh_node("Bench", meshes["bench"], Transform3D(Basis.IDENTITY, Vector3(-3.4, 0, 6.2))))
	var sign_label := Label3D.new()
	sign_label.name = "Sign"
	sign_label.text = "GASTHAUS"
	sign_label.font_size = 64
	sign_label.pixel_size = 0.012
	sign_label.outline_size = 10
	sign_label.modulate = Color("f2e6c8")
	sign_label.outline_modulate = Color("2a1e14")
	sign_label.transform = Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-25)), Vector3(0, 5.6, 4.6))
	body.add_child(sign_label)
	_landmarks().add_child(body)
	clearings.append([Vector2(p.x, p.z), 13.0])
	yards.append([Vector2(p.x, p.z), 11.0, C_YARD])
	# The drive, from the bank gap to the door.
	for k in 5:
		var q := pts[i] + _right(i) * lerpf(5.0, 17.0, k / 4.0)
		yards.append([Vector2(q.x, q.z), 3.0, C_YARD])
		clearings.append([Vector2(q.x, q.z), 3.0])
	_sightline([i, 1.0, p])
	print("chalet at %.0f m, %.1f m off the road" % [i * STEP, _road_dist(p.x, p.z)])


static func _at(p: Vector3) -> Transform3D:
	return Transform3D(Basis.IDENTITY, p)


## Pylons every ~30 m up the line, never within 9 m of the road, each tall
## enough that the cable clears the ground by 6 m (8 over the road).
func _plan_lift() -> void:
	var a := Vector3(LIFT_BASE.x, 0, LIFT_BASE.y)
	var b := Vector3(LIFT_TOP.x, 0, LIFT_TOP.y)
	var length := a.distance_to(b)
	var at: Array = [0.0]
	var t := 26.0
	while t < length - 18.0:
		var q := a.lerp(b, t / length)
		if _road_dist(q.x, q.z) < 10.0:
			t += 4.0
			continue
		at.append(t)
		t += 30.0
	at.append(length)
	var tops: Array = []
	for k in at.size():
		var q := a.lerp(b, float(at[k]) / length)
		var ground := terrain.height_at(q.x, q.z)
		tops.append(Vector3(q.x, ground + (6.0 if k == 0 or k == at.size() - 1 else 9.5), q.z))
	for _it in 4:
		for k in tops.size() - 1:
			var p0: Vector3 = tops[k]
			var p1: Vector3 = tops[k + 1]
			var worst := 0.0
			var steps := int(p0.distance_to(p1) / 2.0) + 1
			for s in steps + 1:
				var q := p0.lerp(p1, float(s) / steps)
				var need := 8.0 if _road_dist(q.x, q.z) < 6.0 else 6.0
				worst = maxf(worst, need - (q.y - terrain.height_at(q.x, q.z)))
			if worst > 0.0:
				if k > 0:
					tops[k].y += worst
				if k + 1 < tops.size() - 1:
					tops[k + 1].y += worst
	lift_line = tops
	var hs := []
	for k in tops.size():
		hs.append(snappedf(tops[k].y - terrain.height_at(tops[k].x, tops[k].z), 0.1))
	print("lift: %.0f m, %d pylons, heights %s" % [length, tops.size() - 2, hs])


## The chairlift: bottom and top stations with their bullwheels, steel
## pylons with crossarms, two cables and red double chairs hanging off them.
## A piste runs down under it, cleared of trees.
func _ski_lift() -> void:
	var a: Vector3 = lift_line[0]
	var b: Vector3 = lift_line[lift_line.size() - 1]
	var dir := Vector3(b.x - a.x, 0, b.z - a.z).normalized()
	var across := Vector3(-dir.z, 0, dir.x)
	# The node sits where the road first passes under it: that's where it's called.
	var ci := int(float(lift_cross[0]) / STEP)
	var base := _g(Vector3(pts[ci].x, 0, pts[ci].z))
	var body := StaticBody3D.new()
	body.name = "SkiLift"
	body.set_meta("distance_m", ci * STEP)
	body.collision_layer = LAYER_WORLD
	body.add_to_group("track_landmark", true)
	body.add_to_group("track_obstacle", true)
	body.set_meta("label", "ski lift")
	body.set_meta("kind", "landmark")
	body.transform = Transform3D(Basis.IDENTITY, base)
	var st := _st()
	var o := base
	var face := Basis.looking_at(dir, Vector3.UP)
	# Stations: a hut, the drive frame, the bullwheel.
	for end in [0, lift_line.size() - 1]:
		var top: Vector3 = lift_line[end]
		var g := _g(Vector3(top.x, 0, top.z))
		var back := -dir if end == 0 else dir
		_box(st, Transform3D(face, g - o + Vector3(0, 0.4, 0)), Vector3(6.0, 0.8, 7.0), C_STONE)
		_capped(st, Transform3D(face, g - o + back * 5.0 + across * 4.2 + Vector3(0, 1.4, 0)), Vector3(3.2, 2.8, 3.0), C_TIMBER, 0.3)
		for s: float in [-1.0, 1.0]:
			_beam(st, g - o + across * s * 1.2 + back * 1.0, top - o + across * s * 0.4 + Vector3(0, -0.3, 0), 0.4, C_STEEL_DARK)
		var wheel := CylinderMesh.new()
		wheel.top_radius = 2.3
		wheel.bottom_radius = 2.3
		wheel.height = 0.35
		wheel.radial_segments = 14
		wheel.rings = 1
		_prim(st, wheel, Transform3D(Basis.IDENTITY, top - o), C_STEEL)
		_box(st, Transform3D(face, top - o + Vector3(0, 0.45, 0)), Vector3(1.6, 0.6, 2.6), C_YELLOW)
		var cs := CollisionShape3D.new()
		cs.name = "Station%d" % end
		var bs := BoxShape3D.new()
		bs.size = Vector3(7.0, 3.0, 9.0)
		cs.shape = bs
		cs.transform = Transform3D(face, g - o + back * 2.0 + Vector3(0, 1.5, 0))
		body.add_child(cs)
		clearings.append([Vector2(g.x, g.z), 10.0])
		yards.append([Vector2(g.x, g.z), 8.0, C_YARD])
	# Pylons.
	for k in range(1, lift_line.size() - 1):
		var top: Vector3 = lift_line[k]
		var g := _g(Vector3(top.x, 0, top.z), -0.2)
		_beam(st, g - o, top - o + Vector3(0, -0.4, 0), 0.5, C_STEEL)
		_box(st, Transform3D(face, top - o), Vector3(4.6, 0.3, 0.4), C_STEEL_DARK)
		for s: float in [-1.0, 1.0]:
			_box(st, Transform3D(face, top - o + across * s * 2.0 + Vector3(0, 0.2, 0)), Vector3(0.3, 0.3, 1.6), C_STEEL_DARK)
		_box(st, Transform3D(face, g - o + Vector3(0, 0.3, 0)), Vector3(1.4, 0.6, 1.4), C_STONE)
		var cs := CollisionShape3D.new()
		cs.name = "Pylon%d" % k
		var bs := BoxShape3D.new()
		bs.size = Vector3(1.4, 4.0, 1.4)
		cs.shape = bs
		cs.position = g - o + Vector3(0, 2.0, 0)
		body.add_child(cs)
	# Cables and chairs: up on one side, down the other; chairs every 12 m.
	var along := 0.0
	for k in lift_line.size() - 1:
		var p0: Vector3 = lift_line[k]
		var p1: Vector3 = lift_line[k + 1]
		var span := p0.distance_to(p1)
		for s: float in [-1.0, 1.0]:
			_beam(st, p0 - o + across * s * 2.0, p1 - o + across * s * 2.0, 0.07, Color("2a2a2a"))
			var first := fposmod(-along + (6.0 if s > 0 else 0.0), 12.0)
			var c := first
			while c < span:
				var q := p0.lerp(p1, c / span) - o + across * s * 2.0
				_beam(st, q, q + Vector3(0, -2.0, 0), 0.06, C_STEEL_DARK)
				var cb := Basis.looking_at(dir * -s, Vector3.UP)
				_box(st, Transform3D(cb, q + Vector3(0, -2.05, 0)), Vector3(1.4, 0.12, 0.55), C_CHAIR)
				_box(st, Transform3D(cb, q + Vector3(0, -1.75, 0) - dir * -s * 0.28), Vector3(1.4, 0.55, 0.08), C_CHAIR)
				c += 12.0
		along += span
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_landmarks().add_child(body)
	# The piste under it, groomed, trees cleared.
	var length := Vector2(a.x - b.x, a.z - b.z).length()
	var t := 0.0
	while t <= length:
		var q := a.lerp(b, t / length)
		clearings.append([Vector2(q.x, q.z), 9.0])
		yards.append([Vector2(q.x, q.z), 7.0, C_PISTE])
		t += 5.0


## The frozen pond on its shelf below the traverse: blue-grey ice with the
## road's ice shading (glossy), snow round the edge, an ice-fishing hut and
## a bench on the shore. Its own "ice" probe, should anyone get that far.
func _frozen_pond() -> void:
	var c := _g(Vector3(POND.x, 0, POND.y))
	var body := StaticBody3D.new()
	body.name = "FrozenPond"
	body.collision_layer = LAYER_WORLD
	body.add_to_group("track_landmark", true)
	body.add_to_group("track_obstacle", true)
	body.set_meta("label", "frozen pond")
	body.set_meta("kind", "landmark")
	body.transform = Transform3D(Basis.IDENTITY, c)
	var pn := FastNoiseLite.new()
	pn.seed = SEED + 61
	pn.frequency = 1.0
	const SEGS := 28
	const RINGS := 4
	var ring_pts: Array = []
	for r in RINGS + 1:
		var row: Array = []
		for k in SEGS:
			var a := TAU * k / SEGS
			var rad := POND_R * (1.0 + pn.get_noise_1d(k * 0.6) * 0.18) * float(r) / RINGS
			var q := Vector3(cos(a) * rad, 0, sin(a) * rad)
			q.y = terrain.height_at(c.x + q.x, c.z + q.z) - c.y + 0.05
			row.append(q)
		ring_pts.append(row)
	var st := _st()
	var faces := PackedVector3Array()
	for r in RINGS:
		for k in SEGS:
			var k1 := (k + 1) % SEGS
			var a: Vector3 = ring_pts[r][k]
			var b: Vector3 = ring_pts[r][k1]
			var cc: Vector3 = ring_pts[r + 1][k]
			var d: Vector3 = ring_pts[r + 1][k1]
			for v in [a, cc, b, b, cc, d]:
				var dark := 0.5 + 0.5 * pn.get_noise_2d(v.x * 4.0, v.z * 4.0)
				var col := Color("88a5b9").lerp(Color("b4c8d6"), dark)
				col = col.lerp(C_BANK, smoothstep(0.82, 1.0, v.length() / POND_R) * 0.7)
				col.a = 0.0
				st.set_color(col)
				st.set_uv(Vector2(5.0, 0.0))
				st.set_uv2(Vector2(100.0, 100.0))
				st.set_normal(Vector3.UP)
				st.add_vertex(v)
			for v in [a, cc, b, b, cc, d]:
				faces.append(v + c + Vector3(0, 0.0, 0))
	var ice := _mesh_node("Ice", _commit(st, road_mat))
	ice.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(ice)
	# The hut on the ice, a hole and a stool by it, a bench on the shore.
	var hst := _st()
	var hut_at := Vector3(4.5, ring_pts[0][0].y, -3.0)
	_capped(hst, Transform3D(Basis(Vector3.UP, 0.4), hut_at + Vector3(0, 1.1, 0)), Vector3(2.2, 2.2, 2.4), C_RED, 0.25)
	_box(hst, Transform3D(Basis(Vector3.UP, 0.4), hut_at + Vector3(0, 0.9, 1.22).rotated(Vector3.UP, 0.4)), Vector3(0.8, 1.7, 0.06), C_TIMBER_DARK)
	var hole := CylinderMesh.new()
	hole.top_radius = 0.35
	hole.bottom_radius = 0.35
	hole.height = 0.02
	hole.radial_segments = 10
	hole.rings = 1
	_prim(hst, hole, _at(hut_at + Vector3(2.4, 0.02, 1.2)), Color("1d2a33"))
	_box(hst, _at(hut_at + Vector3(2.9, 0.25, 1.9)), Vector3(0.4, 0.5, 0.4), C_TIMBER)
	body.add_child(_mesh_node("Hut", _commit(hst)))
	var cs := CollisionShape3D.new()
	cs.name = "Hut"
	var bs := BoxShape3D.new()
	bs.size = Vector3(2.4, 2.4, 2.6)
	cs.shape = bs
	cs.transform = Transform3D(Basis(Vector3.UP, 0.4), hut_at + Vector3(0, 1.2, 0))
	body.add_child(cs)
	var ni := _nearest_sample(c.x, c.z)
	var shore := Vector3(POND.x, 0, POND.y) + (pts[ni] - Vector3(POND.x, 0, POND.y)).normalized() * (POND_R + 2.2)
	shore = _g(shore) - c
	body.add_child(_mesh_node("Bench", meshes["bench"], Transform3D(Basis.looking_at(-(pts[ni] - c).normalized() * Vector3(1, 0, 1), Vector3.UP).rotated(Vector3.UP, PI), shore)))
	_landmarks().add_child(body)
	var probe := StaticBody3D.new()
	probe.name = "PondIce"
	probe.add_to_group("track_road", true)
	probe.set_meta("surface", "ice")
	probe.collision_layer = LAYER_SURFACE
	probe.collision_mask = 0
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	shape.backface_collision = true
	var pcs := CollisionShape3D.new()
	pcs.name = "Shape"
	pcs.shape = shape
	probe.add_child(pcs)
	track.add_child(probe)
	clearings.append([POND, POND_R + 3.0])
	yards.append([POND, POND_R + 3.5, C_BANK])
	var side := 1.0 if _right(ni).dot(Vector3(POND.x, 0, POND.y) - pts[ni]) > 0.0 else -1.0
	_sightline([ni, side, Vector3(POND.x, pts[ni].y, POND.y)])
	print("frozen pond at %.0f m, %.0f m off the road, %.1f m below it" % [ni * STEP, _road_dist(c.x, c.z), pts[ni].y - c.y])


# --- callouts ---------------------------------------------------------------------

func _scenery() -> void:
	_shrine()
	_plough()
	_avalanche_fence()
	_ski_hut()
	var big := [_landmarks().get_node("Chalet"), _landmarks().get_node("FrozenPond")]
	for id in scenery_sites:
		var site: Array = scenery_sites[id]
		var p: Vector3 = site[2]
		var nearest := INF
		for b in big:
			nearest = minf(nearest, Vector2(p.x, p.z).distance_to(Vector2(b.position.x, b.position.z)))
		for q in lift_line:
			nearest = minf(nearest, Vector2(p.x, p.z).distance_to(Vector2(q.x, q.z)))
		var cp_gap := INF
		for m in CP_AT:
			cp_gap = minf(cp_gap, absf(site[0] * STEP - float(m)))
		print("  %-7s at %4.0f m, %s, %4.1f m off the road, %3.0f m from the nearest big landmark, %3.0f m from a checkpoint" % [
			id, site[0] * STEP, "right" if site[1] > 0 else "left", _road_dist(p.x, p.z), nearest, cp_gap])
		assert(nearest > 45.0 and cp_gap > 12.0)


## Wayside shrine: a little roofed box on a post, a crucifix inside,
## candles, snow on the roof. Leaning a little, like they do.
func _shrine() -> void:
	var site: Array = scenery_sites["shrine"]
	var i: int = site[0]
	var p := _g(site[2], -0.05)
	var body := _solid("Shrine", "shrine", Transform3D(_facing_road(i, p).rotated(Vector3.UP, 0.25), p), Vector3(0.8, 2.6, 0.8))
	var st := _st()
	_box(st, _at(Vector3(0, 0.9, 0)), Vector3(0.22, 1.8, 0.22), C_TIMBER_DARK)
	_box(st, _at(Vector3(0, 2.15, 0)), Vector3(0.9, 0.8, 0.5), C_TIMBER)
	_box(st, _at(Vector3(0, 2.15, 0.22)), Vector3(0.7, 0.62, 0.08), Color("e9e2cf"))
	_box(st, _at(Vector3(0, 2.18, 0.27)), Vector3(0.06, 0.44, 0.04), Color("6a4a2a"))
	_box(st, _at(Vector3(0, 2.27, 0.27)), Vector3(0.26, 0.06, 0.04), Color("6a4a2a"))
	var roof := PrismMesh.new()
	roof.size = Vector3(1.25, 0.5, 0.8)
	_prim(st, roof, _at(Vector3(0, 2.8, 0)), C_ROOF)
	var cap := PrismMesh.new()
	cap.size = Vector3(1.2, 0.45, 0.86)
	_prim(st, cap, _at(Vector3(0, 2.92, 0)), C_SNOW)
	for x in [-0.25, 0.25]:
		_box(st, _at(Vector3(x, 1.86, 0.3)), Vector3(0.07, 0.14, 0.07), C_RED)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_callout(body, "wayside shrine", site, "shrine", Color("8e5a3a"))


## A snow plough parked in a lay-by: orange truck, grit in the back, the
## blade down and angled.
func _plough() -> void:
	var site: Array = scenery_sites["plough"]
	var i: int = site[0]
	var p := _g(site[2], -0.05)
	var body := _solid("SnowPlough", "plough", Transform3D(Basis.looking_at(tans[i], Vector3.UP).rotated(Vector3.UP, 0.15), p), Vector3(2.6, 3.0, 8.4), Vector3(0, 0, 0.4))
	var st := _st()
	_box(st, _at(Vector3(0, 0.95, 0.3)), Vector3(2.3, 0.35, 7.0), Color("2a2a2a")) # chassis
	_capped(st, _at(Vector3(0, 1.95, -2.3)), Vector3(2.4, 1.7, 1.9), C_ORANGE, 0.12)
	_box(st, _at(Vector3(0, 2.2, -3.26)), Vector3(2.1, 0.75, 0.05), C_GLASS)
	_box(st, _at(Vector3(0, 1.75, 1.3)), Vector3(2.4, 1.3, 4.2), C_ORANGE.darkened(0.1)) # body
	_box(st, _at(Vector3(0, 2.45, 1.3)), Vector3(2.2, 0.2, 4.0), C_GRIT)
	_box(st, _at(Vector3(0, 2.62, -2.3)), Vector3(0.5, 0.15, 0.3), C_YELLOW) # beacon
	for z in [-2.4, 1.0, 2.6]:
		for s: float in [-1.0, 1.0]:
			_box(st, _at(Vector3(s * 1.1, 0.55, z)), Vector3(0.45, 1.1, 1.1), Color("1d1d1d"))
	# The blade: a long, curved-looking board out front, at an angle.
	var blade := Transform3D(Basis(Vector3.UP, 0.35), Vector3(0, 0.75, -4.2))
	_box(st, blade, Vector3(3.6, 1.0, 0.18), C_YELLOW)
	_box(st, blade * Transform3D(Basis.IDENTITY, Vector3(0, -0.45, 0.1)), Vector3(3.6, 0.12, 0.2), Color("3a3a3a"))
	_box(st, blade * Transform3D(Basis.IDENTITY, Vector3(0, 0.5, 0.0)), Vector3(3.7, 0.16, 0.36), C_SNOW)
	_beam(st, Vector3(0, 0.9, -3.3), Vector3(0, 0.85, -4.1), 0.25, Color("2a2a2a"))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_callout(body, "snow plough", site, "plough", C_ORANGE)
	clearings.append([Vector2(p.x, p.z), 6.0])
	yards.append([Vector2(p.x, p.z), 6.5, C_YARD])


## Avalanche fence: three staggered rows of steel snow-nets on the slope
## above the road, braced downhill.
func _avalanche_fence() -> void:
	var site: Array = scenery_sites["fence"]
	var i: int = site[0]
	var side: float = site[1]
	var p := _g(site[2], -0.1)
	var body := Node3D.new()
	body.name = "AvalancheFence"
	body.transform = Transform3D(Basis.looking_at(tans[i], Vector3.UP), p)
	var st := _st()
	var inv := body.transform.affine_inverse()
	for row in 3:
		var lat := side * (row * 7.0)
		var shift := (row % 2) * 6.0 - 3.0
		var a: Vector3 = site[2] + _right(i) * lat
		for k in 5:
			var q := a + tans[i] * (shift + (k - 2) * 3.0)
			var g := _g(q, -0.1)
			var g1 := _g(q + tans[i] * 3.0, -0.1)
			var lp := inv * g
			var lp1 := inv * g1
			# Posts lean downhill (toward the road), nets between them.
			var lean := Vector3(-side * 0.6, 0, 0)
			_beam(st, lp, lp + Vector3(0, 3.2, 0) + lean, 0.14, C_STEEL_DARK)
			_beam(st, lp + Vector3(side * 1.6, 0, 0), lp + Vector3(0, 2.6, 0) + lean * 0.8, 0.08, C_STEEL)
			if k < 4:
				for y in [0.8, 1.6, 2.4, 3.1]:
					_beam(st, lp + Vector3(0, y, 0) + lean * y / 3.2, lp1 + Vector3(0, y, 0) + lean * y / 3.2, 0.05, C_STEEL)
				_box(st, Transform3D(Basis.looking_at(lp1 - lp, Vector3.UP), (lp + lp1) * 0.5 + Vector3(0, 0.2, 0) - lean * 0.2), Vector3(0.6, 0.4, 3.0), C_SNOW)
			clearings.append([Vector2(g.x, g.z), 2.2])
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_callout(body, "avalanche fence", site, "fence", Color("6b7280"))


## Ski hut: a log hut with a deep snow roof, skis and poles stuck in the
## snow out front, a bench.
func _ski_hut() -> void:
	var site: Array = scenery_sites["skihut"]
	var i: int = site[0]
	var p := _g(site[2], -0.1)
	var body := _solid("SkiHut", "hut", Transform3D(_facing_road(i, p), p), Vector3(4.6, 3.0, 3.8))
	var st := _st()
	for k in 6:
		_box(st, _at(Vector3(0, 0.22 + k * 0.42, 0)), Vector3(4.4 + (0.25 if k % 2 == 0 else 0.0), 0.42, 3.6 + (0.0 if k % 2 == 0 else 0.25)), C_TIMBER if k % 2 == 0 else C_TIMBER_DARK)
	var roof := PrismMesh.new()
	roof.size = Vector3(5.6, 1.8, 4.8)
	_prim(st, roof, _at(Vector3(0, 3.4, 0)), C_ROOF)
	var cap := PrismMesh.new()
	cap.size = Vector3(5.4, 1.75, 5.0)
	_prim(st, cap, _at(Vector3(0, 3.62, 0)), C_SNOW)
	_box(st, _at(Vector3(-0.8, 1.0, 1.84)), Vector3(0.9, 2.0, 0.08), C_TIMBER_DARK)
	_box(st, _at(Vector3(1.0, 1.5, 1.84)), Vector3(0.9, 0.7, 0.08), Color("d9c38a"))
	var skis := [Color("d8322a"), Color("2a6fd6"), Color("e8c21c"), Color("2e9e4f")]
	for k in 4:
		var x := -1.6 + k * 0.55
		_box(st, Transform3D(Basis(Vector3.FORWARD, 0.08 * (k - 1.5)), Vector3(x, 0.8, 3.0)), Vector3(0.09, 1.7, 0.03), skis[k])
		_box(st, Transform3D(Basis(Vector3.FORWARD, -0.05 * k), Vector3(x + 0.12, 0.65, 3.05)), Vector3(0.03, 1.3, 0.03), Color("3a3a3a"))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	body.add_child(_mesh_node("Bench", meshes["bench"], Transform3D(Basis.IDENTITY, Vector3(1.6, 0, 2.8))))
	_callout(body, "ski hut", site, "hut", C_RED)
	yards.append([Vector2(p.x, p.z), 6.0, C_YARD])


# --- easter-egg spots -----------------------------------------------------------------

func _egg_spots() -> void:
	var g := _group("EggSpots")
	var k := 0
	var skiers := 0
	for spot in EGG_SPOTS:
		var kind: String = spot[0]
		var i := clampi(int(float(spot[1]) / STEP), 0, n - 1)
		if kind == "skier":
			i = int(float(lift_cross[skiers]) / STEP)
			skiers += 1
		var side: float = spot[2]
		var edge := half_w[i] + verge_w[i] + BANK_W
		var off := float(spot[3])
		match kind:
			"snowman":
				off = edge + 1.4
			"snowmobile":
				off = TRAIL_LAT
		var p := _g(pts[i] + _right(i) * side * off)
		var m := Marker3D.new()
		m.name = "%s%d" % [kind.capitalize().replace(" ", ""), k]
		m.add_to_group("track_egg", true)
		m.set_meta("kind", kind)
		m.set_meta("distance_m", i * STEP)
		m.set_meta("side", side)
		m.set_meta("edge", edge)
		m.transform = Transform3D(Basis.looking_at(tans[i], Vector3.UP), p)
		match kind:
			"snowman":
				m.transform = Transform3D(_facing_road(i, p), p)
				clearings.append([Vector2(p.x, p.z), 3.5])
				_sightline([i, side, p])
			"skier":
				# Uphill side; the piste under the lift is the way down.
				m.set_meta("uphill", side)
			"elk":
				m.transform = Transform3D(_facing_road(i, p), p)
				for s in 6:
					var q := pts[i] + _right(i) * side * lerpf(8.0, off + 4.0, s / 5.0)
					clearings.append([Vector2(q.x, q.z), 5.5])
				_sightline([i, side, p])
			"snowmobile":
				m.set_meta("lat", TRAIL_LAT)
				for s in range(i, mini(i + int(TRAIL_LEN / STEP) + 6, n), 2):
					var q := pts[s] + _right(s) * side * TRAIL_LAT
					clearings.append([Vector2(q.x, q.z), 3.4])
					yards.append([Vector2(q.x, q.z), 2.6, C_PISTE])
			"yeti":
				m.transform = Transform3D(_facing_road(i, p), p)
				clearings.append([Vector2(p.x, p.z), 1.8])
				var walk := p + tans[i] * 5.0
				clearings.append([Vector2(walk.x, walk.z), 1.6])
				_sightline([i, side, p])
		g.add_child(m)
		k += 1
	print("egg spots: %d" % k)


# --- rock walls --------------------------------------------------------------------

## Granite along the cuts: wherever the ground rises steeply behind a bank,
## snow-capped boulders stand in front of it. With the cut itself they're
## the eye-level cover between stacked legs. Merged per 2x2 chunks (one
## draw each; they sit low and close, so coarse culling costs little),
## box colliders in one body per cell.
func _rock_walls() -> void:
	var g := _group("Rocks")
	var by_cell := {}
	var count := 0
	for i in range(8, n - 8, 3):
		for side: float in [-1.0, 1.0]:
			if srng.randf() > 0.5:
				continue
			var e0 := half_w[i] + verge_w[i] + BANK_W
			var big := srng.randf() < 0.55
			var id := "granite_l" if big else "granite_m"
			var s := srng.randf_range(0.32, 0.5) if big else srng.randf_range(0.7, 1.1)
			var aabb: AABB = (meshes[id] as Mesh).get_aabb()
			var reach := maxf(aabb.size.x, aabb.size.z) * s * 0.5
			var lat := e0 + 0.4 + reach * 0.8 + srng.randf_range(0.0, 1.5)
			var q := pts[i] + _right(i) * side * lat
			var gq := terrain.height_at(q.x, q.z)
			var rise := gq - pts[i].y
			var up := terrain.normal_at(q.x, q.z).y
			var steep := rise > 1.5 or terrain.height_at(q.x + _right(i).x * side * 4.0, q.z + _right(i).z * side * 4.0) - pts[i].y > 3.0
			if not steep and srng.randf() > 0.12:
				continue
			if _road_dist(q.x, q.z) < lat - 0.5 or not _clear(q.x, q.z, reach * 0.5):
				continue
			var xf := Transform3D(Basis(Vector3.UP, srng.randf() * TAU).scaled(Vector3(s, s * srng.randf_range(0.8, 1.15), s)), Vector3(q.x, gq - aabb.size.y * s * 0.15 - (1.0 - up) * 2.0, q.z))
			var key := Vector2i(floori(q.x / (CHUNK * 2.0)), floori(q.z / (CHUNK * 2.0)))
			if not by_cell.has(key):
				by_cell[key] = []
			by_cell[key].append([id, xf, aabb, s])
			clearings.append([Vector2(q.x, q.z), reach * 0.8])
			count += 1
	var keys := by_cell.keys()
	keys.sort()
	for key in keys:
		var st := _st()
		var body := StaticBody3D.new()
		body.name = "Rocks_%d_%d" % [key.x, key.y]
		body.collision_layer = LAYER_WORLD
		body.collision_mask = 0
		body.add_to_group("track_obstacle", true)
		body.set_meta("kind", "rock")
		var j := 0
		for r in by_cell[key]:
			var xf: Transform3D = r[1]
			_merge(st, meshes[r[0]], xf, Color(1, 1, 1).darkened(srng.randf_range(0.0, 0.1)))
			var aabb: AABB = r[2]
			var cs := CollisionShape3D.new()
			cs.name = "Shape%d" % j
			var bs := BoxShape3D.new()
			bs.size = aabb.size * xf.basis.get_scale() * Vector3(0.75, 1.0, 0.75)
			cs.shape = bs
			cs.transform = Transform3D(xf.basis.orthonormalized(), xf * aabb.get_center())
			body.add_child(cs)
			j += 1
		var mi := _mesh_node("Mesh", _commit(st))
		# No shadows: the cut behind is already dark, and it's a draw per chunk saved.
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		body.add_child(mi)
		g.add_child(body)
	print("rock walls: %d boulders in %d chunks" % [count, keys.size()])


# --- forest -------------------------------------------------------------------------

## Pine's order (EyeForest's SHAPES): tall, default, round, small, far, far_b.
const TREE_IDS := ["snow_pine_a", "snow_pine_b", "snow_pine_c", "snow_pine_small", "snow_far", "snow_far_b"]
const TREE_RADII := [0.45, 0.5, 0.45, 0.35, 0.45, 0.45]
const FLOOR_IDS := ["snow_pile", "granite_s", "granite_m", "stub"]
const FLOOR_RADII := [0.0, 0.9, 1.3, 0.0]
const NEAR_FOREST := 24.0
const SOLID_FOREST := 45.0


## Snow-loaded spruce, thinner than Pine Panic's forest and patchier, none
## on the rock (anything steeper than ~37 deg). Near the road the Kenney
## firs; deep in, the cheap cones. Snow piles, rocks and buried stumps on
## the floor.
func _forest(bb: Rect2) -> void:
	var area := bb.grow(50.0)
	var walls := bb.grow(20.0)
	var chunks := {}
	var counts := {}
	var edge := ROAD_HALF_WIDTH + 0.4 + SHOULDER + BANK_W + 0.6
	const CELL := 3.3
	var x := area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, CELL)
			var pz := z + rng.randf_range(0.0, CELL)
			z += CELL
			var d := _fast_dist(px, pz)
			if d < edge:
				continue
			var p := 0.62 if d < 14.0 else (0.56 if d < NEAR_FOREST else 0.5)
			p *= clampf(0.75 + noise.get_noise_2d(px * 0.5, pz * 0.5) * 1.1, 0.15, 1.15) if d > 12.0 else 1.0
			if rng.randf() > p:
				continue
			if not _clear(px, pz):
				continue
			var up := terrain.normal_at(px, pz).y
			if up < 0.8:
				continue
			var w := rng.randf()
			var id: String
			var s := rng.randf_range(0.8, 1.2)
			if d < NEAR_FOREST:
				id = "snow_pine_a" if w < 0.32 else ("snow_pine_b" if w < 0.62 else ("snow_pine_c" if w < 0.86 else "snow_pine_small"))
				if d < 10.0 and rng.randf() < 0.35:
					id = "snow_pine_small"
			else:
				id = "snow_pine_a" if w < 0.2 else ("snow_far" if w < 0.68 else "snow_far_b")
				s = rng.randf_range(0.95, 1.35)
			var solid := d < SOLID_FOREST and walls.has_point(Vector2(px, pz))
			_add(chunks, counts, id, px, terrain.height_at(px, pz) - 0.2, pz, rng.randf() * TAU, s if solid else -s)
			tree_xz.append(Vector2(px, pz))
		x += CELL
	x = area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, 5.0)
			var pz := z + rng.randf_range(0.0, 5.0)
			z += 4.4
			var d := _fast_dist(px, pz)
			if d < edge or not _clear(px, pz):
				continue
			var y := terrain.height_at(px, pz)
			var up := terrain.normal_at(px, pz).y
			var r := rng.randf()
			if up < 0.72:
				continue
			if r < 0.07:
				_add(chunks, counts, "snow_pile", px, y - 0.15, pz, rng.randf() * TAU, rng.randf_range(0.5, 1.0))
			elif r < 0.1:
				_add(chunks, counts, "granite_s", px, y - 0.2, pz, rng.randf() * TAU, rng.randf_range(0.4, 0.8) * (1.0 if d < SOLID_FOREST else -1.0))
			elif r < 0.115 or (up < 0.85 and r < 0.2):
				_add(chunks, counts, "granite_m", px, y - 0.3, pz, rng.randf() * TAU, rng.randf_range(0.4, 0.75) * (1.0 if d < SOLID_FOREST else -1.0))
			elif r < 0.14:
				_add(chunks, counts, "stub", px, y - 0.05, pz, rng.randf() * TAU, rng.randf_range(0.7, 1.2))
		x += 4.4
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
			sc.collider_height = 12.0 if kind == "trees" else 1.2
			sc.tint_jitter = 0.08 if kind == "trees" else 0.05
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
	print("forest: %s in %d chunks, %d solid" % [counts, keys.size(), solid_total])


## Two deep-forest spruce (~40 and ~30 triangles), white on the tiers, and a
## stump wearing a snow cap.
func _cheap_meshes() -> void:
	var leaf := Color("2b4a33")
	var bark := Color("4a3326")
	var st := _st()
	_cone(st, 5, 0.22, 0.0, 2.2, bark)
	_cone(st, 7, 1.8, 1.4, 5.0, leaf.darkened(0.1))
	_cone(st, 7, 1.4, 3.6, 7.2, leaf.lightened(0.02), 0.4)
	_cone(st, 6, 0.9, 5.8, 9.6, C_SNOW.darkened(0.06), 0.9)
	meshes["snow_far"] = _commit(st)
	st = _st()
	_cone(st, 5, 0.25, 0.0, 2.0, bark)
	_cone(st, 8, 2.0, 1.3, 5.8, leaf.darkened(0.08))
	_cone(st, 7, 1.3, 4.0, 8.4, C_SNOW.darkened(0.08), 0.5)
	meshes["snow_far_b"] = _commit(st)
	st = _st()
	var stump := CylinderMesh.new()
	stump.top_radius = 0.3
	stump.bottom_radius = 0.36
	stump.height = 0.5
	stump.radial_segments = 7
	stump.rings = 1
	_prim(st, stump, Transform3D(Basis.IDENTITY, Vector3(0, 0.25, 0)), C_TIMBER_DARK)
	var cap := CylinderMesh.new()
	cap.top_radius = 0.22
	cap.bottom_radius = 0.36
	cap.height = 0.16
	cap.radial_segments = 7
	cap.rings = 1
	_prim(st, cap, Transform3D(Basis.IDENTITY, Vector3(0, 0.56, 0)), C_SNOW)
	meshes["stub"] = _commit(st)


# --- ground ---------------------------------------------------------------------------

## Ground tint: the snow's value (relative to the shader's REF), a little
## greyer under the trees and along the road (spray), yards and pistes their
## own. Rock comes from the shader, on anything steep.
func _ground_tints() -> void:
	var shade_grid := {}
	for p in tree_xz:
		var k := Vector2i(roundi((p.x - terrain.origin.x) / TERRAIN_CELL), roundi((p.y - terrain.origin.y) / TERRAIN_CELL))
		shade_grid[k] = shade_grid.get(k, 0.0) + 1.0
	var bytes := PackedByteArray()
	bytes.resize(terrain.w * terrain.d * 4)
	for iz in terrain.d:
		for ix in terrain.w:
			var x := terrain.origin.x + ix * TERRAIN_CELL
			var z := terrain.origin.y + iz * TERRAIN_CELL
			var k := noise.get_noise_2d(x, z) * 0.5 + 0.5
			var d := _fast_dist(x, z)
			var dens: float = shade_grid.get(Vector2i(ix, iz), 0.0)
			var shade := (0.94 + k * 0.1) * lerpf(1.0, 0.86, clampf(dens / 2.0, 0.0, 1.0)) * (1.0 - (1.0 - smoothstep(5.0, 12.0, d)) * 0.08)
			var c := Color(C_FLOOR_REF.r * shade, C_FLOOR_REF.g * shade, C_FLOOR_REF.b * shade)
			var detail := 1.0
			for y in yards:
				var t := clampf((y[1] - Vector2(x, z).distance_to(y[0])) / 6.0, 0.0, 1.0)
				if t > 0.0:
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


# --- map overlay ------------------------------------------------------------------------

## What the static map draws over the snow: a dark road ribbon (30 m above
## each bit of road, so the canopy can't hide it), the lift line, the pond,
## and an icon per landmark. Icons sit above the highest road: the map
## camera looks straight down, so height only decides what covers what.
func _map_overlay() -> void:
	var g := _group("MapOverlay")
	var lift := Vector3(0, 30.0, 0)
	var top := Vector3(0, _hmax + 36.0, 0)
	var st := _st()
	_ribbon(st, pts, 4.5, Color("3b4454"), lift)
	var line := PackedVector3Array()
	for q in lift_line:
		line.append(Vector3(q.x, top.y - 1.0, q.z))
	_ribbon(st, line, 1.4, Color("c0392b"), Vector3.ZERO)
	var bodies := [[_landmarks().get_node("Chalet"), "chalet", Color("8a5a36")], [_landmarks().get_node("FrozenPond"), "pond", Color("7fb3d5")],
		[_landmarks().get_node("SkiLift"), "lift", Color("c0392b")]]
	for b in bodies:
		var at: Vector3 = (b[0] as Node3D).transform.origin
		if b[1] == "lift":
			var mid: Vector3 = lift_line[lift_line.size() / 2]
			at = mid
		at.y = top.y + 0.6
		for part in _big_icon(b[1]):
			for o in Geometry2D.offset_polygon(part, 2.6, Geometry2D.JOIN_MITER):
				_flat_poly(st, o, at - Vector3(0, 0.15, 0), Color("1a1a1a"))
		for part in _big_icon(b[1]):
			_flat_poly(st, part, at, b[2])
	var sp := pts[spawn_i] + lift + Vector3(0, 0.6, 0)
	_box(st, Transform3D(Basis.IDENTITY, sp), Vector3(14, 0.2, 14), Color("1a1a1a"))
	_box(st, Transform3D(Basis.IDENTITY, sp + Vector3(0, 0.2, 0)), Vector3(11, 0.2, 11), Color("2ecc71"))
	var fp := pts[finish_i] + lift + Vector3(0, 0.6, 0)
	for a in 3:
		for b in 3:
			_box(st, Transform3D(Basis.IDENTITY, fp + Vector3((a - 1) * 4.5, 0, (b - 1) * 4.5)), Vector3(4.5, 0.2, 4.5), Color("111111") if (a + b) % 2 == 0 else Color("f5f5f5"))
	var mi := _mesh_node("Mesh", _commit(st, map_mat), Transform3D.IDENTITY, RENDER_MAP_ONLY)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(mi)
	_callout_icon_layer(g, top)


## Big-landmark icons (before ICON_SCALE): a chalet front, the pond, a chair.
func _big_icon(kind: String) -> Array:
	match kind:
		"chalet":
			return [PackedVector2Array([Vector2(-11, 10), Vector2(11, 10), Vector2(11, -2), Vector2(14, -2), Vector2(0, -14), Vector2(-14, -2), Vector2(-11, -2)])]
		"pond":
			var out := PackedVector2Array()
			for k in 14:
				var a := TAU * k / 14.0
				out.append(Vector2(cos(a) * 14.0, sin(a) * 9.5))
			return [out]
		"lift":
			# A chair hanging off the cable.
			return [PackedVector2Array([Vector2(-1.5, -14), Vector2(1.5, -14), Vector2(1.5, 0), Vector2(-1.5, 0)]),
				PackedVector2Array([Vector2(-9, 0), Vector2(9, 0), Vector2(9, 4), Vector2(-9, 4)]),
				PackedVector2Array([Vector2(-9, 4), Vector2(-6, 4), Vector2(-6, 12), Vector2(-9, 12)])]
	return []
