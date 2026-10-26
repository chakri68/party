extends "res://tools/stage_builder.gd"
## Generates scenes/tracks/cliffhanger.scn: Cliffhanger, the other hard
## stage (spec §6: narrow coastal switchbacks and guarded cliff edges;
## lighthouse, sea tunnel, pier). Deterministic. Run after
## tools/bake_assets.gd:
##   godot --headless --path . --script res://tools/build_cliffhanger.gd
## (`-- preview` stops after the route and writes its plan to user://.)
##
## The sea is east. Out of the harbour past the pier, up a stack of four
## switchbacks on the cliff face, a long fast cliff-top run past the
## lighthouse on its point, through the sea tunnel under the headland, then
## two hairpins down toward the cove and a last run along the cliffs.
##
## The road is narrow gravel ("road") with stretches of old broken tarmac
## ("tarmac": grips harder, slides less), each its own probe a hair above
## the road's. On the drop side it's guarded: armco on the switchbacks, dry
## stone walls on the old road, both solid, so the sea is a view, not a
## hazard. Three gaps (the pier's foot on the quay, the lighthouse lane, a
## lay-by) open onto the edge; past it you fall, and anything down at the
## waterline goes through the same server-authorised reset as any other
## fall (Track.fall_y).
##
## Terrain: near the road the road's own height, as Snowblind (so between
## stacked legs it's a rock cut); further out a plane fitted to the road
## plus the residual, rising into heath and rock inland. The coastline
## follows the road (a set gap east of the easternmost road at each
## latitude, bulging out for the lighthouse point and the tunnel's
## headland), and east of it the ground drops in a cliff to the seabed.
## The headland's ridge stands over the tunnel; the bore is a cutting under
## a rock cap (TunnelRoof) that fades for the top-down camera.

const OUT := "res://scenes/tracks/cliffhanger.scn"
const BIOME := "res://biomes/coast.tres"
const SEED := 53
const ROAD_HALF_WIDTH := 2.6 ## narrowest yet: 5.2 m of gravel
const SHOULDER := 0.7
const TERRAIN_AMP := 2.0
const SEA_Y := 0.0
const SEABED := -9.0
## Below this the car is off the cliff or off the quay: a fall (main.gd),
## not just "in the sea". Over a cliff it can come to rest on the rocks at
## the foot, a metre above the water, where the usual "5 m under the
## ground" rule never fires. The lowest road (the harbour) is 3 m up.
const FALL_Y := 1.2
const WALL_OFF := 0.25 ## metres past the verge where the rail / wall stands

## The route as a turtle, as Snowblind: start, heading (0 = east, + turns
## right seen from above with north up), ["S", metres, degrees, grade] or
## ["H", radius, degrees, grade]. North is -90.
const START := Vector2(40, 560)
const START_HEADING := -90.0
const ROUTE := [
	["S", 150.0, 0.0, 0.0], ["S", 60.0, -10.0, 0.03], # the harbour, past the pier
	["S", 50.0, -80.0, 0.06], # left, up off the quay
	["S", 120.0, 4.0, 0.085], # leg A, west, up the cliff face
	["H", 13.0, 180.0, 0.04], # H1
	["S", 130.0, -4.0, 0.085], # leg B, back east
	["H", 12.0, -180.0, 0.04], # H2: on the cliff edge
	["S", 130.0, 4.0, 0.085], # leg C
	["H", 13.0, 180.0, 0.04], # H3
	["S", 130.0, -6.0, 0.07], # leg D
	["S", 60.0, -84.0, 0.02], # onto the cliff top, north
	["S", 140.0, 16.0, 0.0], ["S", 100.0, -24.0, 0.0], # past the lighthouse
	["S", 90.0, -62.0, -0.01], ["S", 120.0, -10.0, 0.0], ["S", 100.0, 80.0, 0.01], # inland over the heath
	["S", 50.0, 0.0, 0.0], ["S", 150.0, 6.0, 0.0], ["S", 60.0, 0.0, 0.0], # the tunnel (the 150)
	["S", 90.0, 70.0, -0.02], ["S", 120.0, 6.0, -0.06], # back out to the cliffs
	["H", 13.0, -180.0, -0.04], # H4: on the edge
	["S", 130.0, 4.0, -0.085],
	["H", 12.0, 180.0, -0.04], # H5
	["S", 150.0, -10.0, -0.04], ["S", 90.0, -50.0, -0.01], ["S", 70.0, 0.0, 0.0], # along the cliffs to the finish
]
## The tunnel: which ROUTE segment it's in (index), and how far into it the
## portals stand (turtle metres from the segment's start).
const TUNNEL_SEG := 17
const TUNNEL_IN := 10.0
const TUNNEL_LEN := 128.0

## Checkpoints by stage metres: on straights, clear of hairpins and the tunnel.
const CP_AT := [330.0, 660.0, 1150.0, 1760.0, 2100.0]
const PIER_AT := 82.0
## Headlands: [stage metres the road passes, metres of extra land east of
## the road's gap, half length along the coast (metres)].
const LIGHTHOUSE_AT := 1000.0
const LIGHTHOUSE_OFF := 46.0 ## metres east of the road
## Smaller callouts: [id, stage metres, side (+1 right of travel, -1 left),
## metres off the centreline, flat-ground radius].
const SCENERY := [
	["pots", 200.0, -1.0, 8.5, 5.0],
	["chapel", 880.0, -1.0, 17.0, 9.0],
	["wreck", 1110.0, 1.0, 0.0, 0.0], # on the rocks below the cliff; offset set from the coast
	["phone", 1810.0, -1.0, 6.5, 3.0],
]
## Lay-by on the cliff top: a gap in the wall, a bench, the view. Stage metres.
const LAYBY_AT := 1230.0
## Easter-egg spots: [kind, stage metres, side, metres off (the road for
## gulls, the cliff foot for things at sea)].
const EGG_SPOTS := [
	["gulls", 600.0, 1.0, 0.0], ["gulls", 1290.0, 1.0, 0.0], ["gulls", 2130.0, 1.0, 0.0],
	# Out at sea. From a cliff top the water under the cliff is hidden by
	# the edge in the chase and bonnet views (it's 25-55 m down), so one of
	# each is off the harbour, where the road is 3 m above the water and the
	# sea is open from 30 m out; the other is close in under the cliff-top
	# road where it runs nearest the edge, for the top-down frame (only
	# ~30 m either side of the car). All of them more than SHOW_R from the
	# start line, or they'd never switch on. Metres off the cliff foot.
	["whale", 160.0, 1.0, 14.0], ["whale", 1170.0, 1.0, 3.0],
	["boat", 200.0, 1.0, 20.0], ["boat", 1090.0, 1.0, 3.0],
	["seal", 130.0, 1.0, 0.0], ["seal", 1060.0, 1.0, 0.0],
	["serpent", 175.0, 1.0, 26.0],
]

## Palette (sRGB).
const C_GRAVEL := Color("8f8679")
const C_RUT := Color("766e63")
const C_CROWN := Color("9c9384")
const C_VERGE := Color("837b6c")
const C_EDGE := Color("6f6a55")
const C_FOOT := Color("5d6447")
const C_TARMAC := Color("47484b")
const C_TARMAC_RUT := Color("323336")
const C_PATCH := Color("4a4b4e")
const C_FLOOR_REF := Color("5a4a36")
const C_YARD := Color("8d8676")
const C_GRASS := Color("5f7044")
const C_STONE := Color("8f8c84")
const C_STONE_DARK := Color("6d6a63")
const C_STONE_CAP := Color("8d8a82")
const C_ARMCO := Color("b7bcc0")
const C_POST := Color("6a6e72")
const C_REFLECT := Color("f0ede4")
const C_WHITE := Color("eeece6")
const C_RED := Color("c0392b")
const C_TIMBER := Color("7a5e44")
const C_TIMBER_DARK := Color("4f3c2c")
const C_SLATE := Color("4a4f57")
const C_GLASS := Color("2c3a40")
const C_LAMP := Color("ffd27a")
const C_TUNNEL := Color("2b2b2c")
const C_TUNNEL_WALL := Color("3a3936")
const C_ROCK := Color("6c6860")
const C_HEATH := Color("6b6a3c")


var preview := false
var tarmac_w := PackedFloat32Array() ## per sample: 1 on tarmac
var tarmac_patches: Array = [] ## [first sample, last sample]
var wall_gaps: Array = [] ## [s0, s1, side (0 = both)] in stage metres
var pads: Array = [] ## [Vector2 centre, radius, height]: flat ground off the road
var _plane := Vector3.ZERO
var _res := PackedFloat32Array()
var _res_rect := Rect2()
var _res_w := 0
var _res_h := 0
var _hmin := 0.0
var _hmax := 0.0
var ridge_noise := FastNoiseLite.new()
var coast_noise := FastNoiseLite.new()
## The coastline: x of the cliff edge per COAST_CELL row of z, from _coast_z0.
const COAST_CELL := 4.0
var _coast := PackedFloat32Array()
var _coast_w := PackedFloat32Array() ## metres the cliff takes to reach the seabed
var _coast_z0 := 0.0
## Tunnel: first and last centreline sample inside it.
var tun_i0 := 0
var tun_i1 := 0
var tun_half := 0.0 ## interior half width
const TUN_H := 5.8 ## crown above the road
const RIDGE_H := 11.0 ## headland ridge above the road over the tunnel
var lighthouse_spot: Array
var pier_spot: Array
var drop := {} ## side (-1, 1) -> PackedFloat32Array per sample: 1 where that side drops away
var wall_kind := PackedByteArray() ## per sample: 0 armco, 1 stone


func _init() -> void:
	preview = OS.get_cmdline_user_args().has("preview")
	stage_seed = SEED
	control = _route_points()
	route_scale = 1.0
	wobble = 0.55
	kink_count = 7
	gate_width = ROAD_HALF_WIDTH * 2 + 6
	ditch = 0.9
	road_half_width = ROAD_HALF_WIDTH
	shoulder = SHOULDER
	road_surface = "road"
	hay = false
	rng.seed = SEED
	srng.seed = SEED + 21
	noise.seed = SEED
	noise.frequency = 0.02
	ridge_noise.seed = SEED + 41
	ridge_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	ridge_noise.frequency = 0.006
	coast_noise.seed = SEED + 43
	coast_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	coast_noise.frequency = 1.0
	_sample_centerline()
	_build_hash()
	track = Track.new()
	track.name = "Cliffhanger"
	track.track_id = "cliffhanger"
	track.display_name = "Cliffhanger"
	track.difficulty = "hard"
	track.centerline = pts
	track.length_m = (n - 1) * STEP
	_find_corners()
	_shape_road()
	_plan_tunnel()
	_plan_sites()
	_build_coast()
	if preview:
		_preview()
		track.free()
		quit(0)
		return
	track.biome = load(BIOME)
	track.fall_y = FALL_Y
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
	for id in ["pine_tall", "pine_default", "pine_round", "pine_small", "bush", "bush_small", "scrub", "scrub_tri", "grass",
			"rock_a", "rock_c", "rock_tall", "rock_small", "granite_l", "granite_m", "granite_s",
			"lantern", "bench", "arch", "flag_red", "flag_green", "tent", "cone", "log_stack", "drum"]:
		meshes[id] = load(MESH_DIR + id + ".res")
	_cheap_meshes()
	cp_fractions = []
	for m in CP_AT:
		cp_fractions.append((float(m) / STEP + 0.5) / n)
	var bb := _road_bounds()
	var lp: Vector3 = lighthouse_spot[2]
	bb = bb.expand(Vector2(lp.x, lp.z) + Vector2(30, 0))
	bb = bb.grow(30.0)
	bb = bb.grow_individual(0, 0, 50.0, 0) # more sea on the map
	track.bounds = bb
	_patches()
	_build_dist_grid(bb.grow(90.0))
	_far_field(bb.grow(80.0))
	_bake_heights(bb)
	track.centerline = pts
	_find_drops()
	_env()
	_road()
	_patch_probes()
	_walls()
	_world_walls(bb)
	_markers()
	_arches()
	_service_and_stop()
	_plan_spectators()
	_corner_furniture()
	_merge_chevrons()
	_tunnel()
	_lighthouse()
	_pier()
	_scenery()
	_layby()
	_egg_spots()
	_spectators()
	_merge_props()
	_rock_walls()
	_index_clearings()
	_forest(bb)
	_ground_tints()
	_sea()
	_map_overlay()
	var err := _save(OUT)
	print("saved %s (err %d): %d samples, %.0f m, bounds %s, %d corners" % [OUT, err, n, track.length_m, bb, corners.size()])
	track.free()
	quit(0 if err == OK else 1)


var seg_ends := PackedFloat32Array() ## turtle metres where each ROUTE segment ends


func _route_points() -> Array:
	var p := START
	var a := deg_to_rad(START_HEADING)
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


## Stage metres for turtle metres u (the wobble stretches the stage a little).
func _stage_m(u: float) -> float:
	return u * track.length_m / seg_ends[seg_ends.size() - 1]


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


## Width, verge, camber and height per sample, as Snowblind; the start sits
## 3 m above the sea on the quay.
func _shape_road() -> void:
	var wn := FastNoiseLite.new()
	wn.seed = SEED + 7
	wn.frequency = 1.0
	var raw_w := PackedFloat32Array()
	var raw_b := PackedFloat32Array()
	var h := 3.2
	for i in n:
		var s := i * STEP
		var r := _radius(i)
		raw_w.append(ROAD_HALF_WIDTH + wn.get_noise_1d(s / 70.0) * 0.2 + 1.4 * (1.0 - smoothstep(14.0, 28.0, r)))
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
		verge_w.append(clampf(SHOULDER + wn.get_noise_1d(i * STEP / 29.0 + 100.0) * 0.2, 0.3, 0.75))


func _plan_tunnel() -> void:
	var u0 := (seg_ends[TUNNEL_SEG - 1] if TUNNEL_SEG > 0 else 0.0) + TUNNEL_IN
	tun_i0 = int(_stage_m(u0) / STEP)
	tun_i1 = int(_stage_m(u0 + TUNNEL_LEN) / STEP)
	var hw := 0.0
	for i in range(tun_i0, tun_i1 + 1):
		hw = maxf(hw, half_w[i] + verge_w[i])
	tun_half = hw + 0.7
	var t := (pts[tun_i1] - pts[tun_i0]).normalized()
	print("tunnel: %.0f-%.0f m, heading %.0f deg (0 = north), half width %.1f m" % [tun_i0 * STEP, tun_i1 * STEP, rad_to_deg(atan2(t.x, -t.z)), tun_half])


## Where things go, decided before the ground is shaped (it flattens for them).
func _plan_sites() -> void:
	spawn_i = int(24.0 / STEP)
	finish_i = n - 1 - int(50.0 / STEP)
	var start := pts[0] - tans[0] * 8.0
	pads.append([Vector2(start.x, start.z), 20.0, profile_h[0]])
	var stop := pts[n - 1] + tans[n - 1] * 12.0
	pads.append([Vector2(stop.x, stop.z), 18.0, profile_h[n - 1]])
	# The lighthouse, out on its point east of the road, and the lane to it.
	var li := int(LIGHTHOUSE_AT / STEP)
	var lp := pts[li] + _right(li) * LIGHTHOUSE_OFF
	lighthouse_spot = [li, 1.0, lp]
	pads.append([Vector2(lp.x, lp.z), 17.0, profile_h[li] + 0.6])
	for k in 7:
		var q := pts[li] + _right(li) * lerpf(5.0, LIGHTHOUSE_OFF - 8.0, k / 6.0)
		pads.append([Vector2(q.x, q.z), 4.5, profile_h[li] + 0.3 * k / 6.0])
	wall_gaps.append([li * STEP - 5.0, li * STEP + 5.0, 1.0])
	# The pier: from the quay out into the harbour. A gap in the parapet onto
	# the quay apron.
	var pi := int(PIER_AT / STEP)
	pier_spot = [pi, 1.0, pts[pi]]
	wall_gaps.append([PIER_AT - 6.0, PIER_AT + 6.0, 1.0])
	# The lay-by on the cliff top.
	wall_gaps.append([LAYBY_AT - 8.0, LAYBY_AT + 8.0, 1.0])
	for sc in SCENERY:
		var i := clampi(int(float(sc[1]) / STEP), 0, n - 1)
		var side: float = sc[2]
		var p := pts[i] + _right(i) * side * float(sc[3])
		scenery_sites[sc[0]] = [i, side, p]
		if float(sc[4]) > 0.0:
			pads.append([Vector2(p.x, p.z), float(sc[4]), profile_h[i]])


## Distance (metres) the tunnel's headland pushes the coast out at z, and
## the lighthouse point's.
func _bulges() -> Array:
	var tm := pts[(tun_i0 + tun_i1) / 2]
	var li := int(LIGHTHOUSE_AT / STEP)
	return [
		[pts[li].z, 34.0, LIGHTHOUSE_OFF + 22.0], # the lighthouse point: narrow, long
		[tm.z, 90.0, 120.0], # the headland
		[pts[0].z + 40.0, 70.0, 0.0], # (placeholder: the harbour keeps its quay)
	]


## The coast: per 4 m of z, the easternmost road within 10 m of that z, plus
## a gap (wider where the road is high: room for a cliff-top shelf), smoothed
## along the coast, never closer to any road than the gap. Bulges for the
## lighthouse point and the headland.
func _build_coast() -> void:
	var bb := _road_bounds().grow(220.0)
	_coast_z0 = bb.position.y
	var rows := int(bb.size.y / COAST_CELL) + 1
	var need := PackedFloat32Array()
	need.resize(rows)
	need.fill(-INF)
	for i in n:
		var gap := 7.0 + smoothstep(4.0, 20.0, profile_h[i]) * 3.0
		var x := pts[i].x + half_w[i] + gap
		for r in range(int((pts[i].z - 14.0 - _coast_z0) / COAST_CELL), int((pts[i].z + 14.0 - _coast_z0) / COAST_CELL) + 1):
			if r >= 0 and r < rows:
				need[r] = maxf(need[r], x)
	# Rows past either end of the road: carry the nearest on.
	var first := 0
	while first < rows and need[first] == -INF:
		first += 1
	var last := rows - 1
	while last >= 0 and need[last] == -INF:
		last -= 1
	for r in rows:
		if r < first:
			need[r] = need[first]
		elif r > last:
			need[r] = need[last]
	_coast.resize(rows)
	_coast_w.resize(rows)
	for r in rows:
		var sum := 0.0
		var wsum := 0.0
		for k in range(-10, 11):
			var q := clampi(r + k, 0, rows - 1)
			var w := exp(-pow(k / 5.0, 2.0))
			sum += need[q] * w
			wsum += w
		var z := _coast_z0 + r * COAST_CELL
		var x := sum / wsum + 6.0 + coast_noise.get_noise_1d(z / 40.0) * 4.0 + coast_noise.get_noise_1d(z / 11.0 + 30.0) * 1.5
		for b in _bulges():
			var t := absf(z - float(b[0])) / float(b[1])
			if t < 1.0:
				x += float(b[2]) * (0.5 + 0.5 * cos(PI * t))
		_coast[r] = maxf(x, need[r])
		_coast_w[r] = 9.0 + coast_noise.get_noise_1d(z / 25.0 + 70.0) * 3.0
	# The harbour: a low quay, not a cliff.
	for r in rows:
		var z := _coast_z0 + r * COAST_CELL
		if z > pts[0].z - 230.0:
			_coast_w[r] = lerpf(_coast_w[r], 3.0, smoothstep(pts[0].z - 230.0, pts[0].z - 150.0, z))


## Metres east of the cliff edge (negative: on land).
func _sea_s(x: float, z: float) -> float:
	var f := clampf((z - _coast_z0) / COAST_CELL, 0.0, _coast.size() - 1.001)
	var r := int(f)
	var t := f - r
	return x - lerpf(_coast[r], _coast[r + 1], t)


func _coast_w_at(z: float) -> float:
	var f := clampf((z - _coast_z0) / COAST_CELL, 0.0, _coast.size() - 1.001)
	var r := int(f)
	return lerpf(_coast_w[r], _coast_w[r + 1], f - r)


func _preview() -> void:
	var bb := _road_bounds().grow(60.0)
	print("length %.0f m, bounds %s, top %.1f m, finish %.1f m" % [track.length_m, bb, _max_h(), profile_h[n - 1]])
	for c in corners:
		print("  corner at %4d m r %4.1f %s  h %.1f" % [c[0] * STEP, c[1], "R" if c[2] < 0 else "L", profile_h[c[0]]])
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
		print("  %4d m (%4.0f, %4.0f) h %5.1f: sea %.0f m east; nearest other road %.0f m (at %d m, %+.1f m)" % [i * STEP, pts[i].x, pts[i].z, profile_h[i], -_sea_s(pts[i].x, pts[i].z), best, bj * STEP, profile_h[bj] - profile_h[i]])
	var k := 2.0
	var img := Image.create(int(bb.size.x / k) + 1, int(bb.size.y / k) + 1, false, Image.FORMAT_RGB8)
	for iz in img.get_height():
		for ix in img.get_width():
			var x := bb.position.x + ix * k
			var z := bb.position.y + iz * k
			img.set_pixel(ix, iz, Color(0.1, 0.2, 0.4) if _sea_s(x, z) > 0.0 else Color(0.15, 0.17, 0.12))
	var top := _max_h()
	for i in n:
		var c := Color.from_hsv(0.66 * (1.0 - profile_h[i] / maxf(top, 1.0)), 0.8, 1.0)
		if i >= tun_i0 and i <= tun_i1:
			c = Color.WHITE
		for dx in range(-1, 2):
			for dz in range(-1, 2):
				img.set_pixel(clampi(int((pts[i].x - bb.position.x) / k) + dx, 0, img.get_width() - 1), clampi(int((pts[i].z - bb.position.y) / k) + dz, 0, img.get_height() - 1), c)
	for m in CP_AT:
		var p := pts[int(float(m) / STEP)]
		for dx in range(-4, 5):
			img.set_pixel(clampi(int((p.x - bb.position.x) / k) + dx, 0, img.get_width() - 1), clampi(int((p.z - bb.position.y) / k), 0, img.get_height() - 1), Color.YELLOW)
	img.save_png("user://cliffhanger_plan.png")
	print("plan: ", ProjectSettings.globalize_path("user://cliffhanger_plan.png"))


func _max_h() -> float:
	var m := -INF
	for v in profile_h:
		m = maxf(m, v)
	return m


# --- surfaces ---------------------------------------------------------------------

## Old broken tarmac: through the tunnel and its approaches, along the
## harbour, and a few seeded stretches between (never in a hairpin: the
## hairpins are gravel, where the cars cut them). Weight per sample, eased
## over 6 m; the probes take the middle of each.
func _patches() -> void:
	tarmac_w.resize(n)
	tarmac_w.fill(0.0)
	var spans: Array = [[0.0, 150.0], [tun_i0 * STEP - 40.0, tun_i1 * STEP + 30.0]]
	var hairpins: Array = []
	for c in corners:
		if c[1] < 22.0:
			hairpins.append(c[0] * STEP)
	var s := 300.0
	while s < finish_i * STEP - 80.0:
		s += srng.randf_range(160.0, 260.0)
		var half := srng.randf_range(30.0, 55.0)
		var ok := true
		for h in hairpins:
			ok = ok and absf(s - h) > half + 30.0
		for sp in spans:
			ok = ok and (s + half + 20.0 < sp[0] or s - half - 20.0 > sp[1])
		if not ok:
			s -= 120.0
			continue
		spans.append([s - half, s + half])
	for sp in spans:
		tarmac_patches.append([maxi(int(sp[0] / STEP), 0), mini(int(sp[1] / STEP), n - 1)])
		for i in n:
			var m := i * STEP
			tarmac_w[i] = maxf(tarmac_w[i], smoothstep(sp[0] - 6.0, sp[0], m) * (1.0 - smoothstep(sp[1], sp[1] + 6.0, m)))
	var total := 0.0
	for p in tarmac_patches:
		total += (p[1] - p[0]) * STEP
	print("tarmac: %d stretches, %.0f m: %s" % [tarmac_patches.size(), total, tarmac_patches.map(func(p: Array) -> String: return "%d-%d" % [p[0] * STEP, p[1] * STEP])])


func _patch_probes() -> void:
	var k := 0
	for p in tarmac_patches:
		_probe_body("Tarmac%d" % k, "tarmac", p[0], p[1])
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

## Far field as Snowblind's: a plane fitted to the road, plus the road's
## residual smoothed outward on a 16 m grid.
func _far_field(area: Rect2) -> void:
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
	var m := Basis(Vector3(cnt, sx, sz), Vector3(sx, sxx, sxz), Vector3(sz, sxz, szz))
	_plane = m.inverse() * Vector3(sh, sxh, szh)
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
			var sw := 0.6
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
	return clampf(_plane_at(x, z) + lerpf(a, b, tz), _hmin - 6.0, _hmax + 22.0)


## Ground height before baking. Land as Snowblind (the road's own height
## near it, so stacked legs have a rock cut between them; heath and ridges
## further out), the headland's ridge over the tunnel, then the sea: past
## the coastline the ground drops in a cliff to the seabed, which shelves
## away offshore.
func _height(x: float, z: float) -> float:
	var d := _fast_dist(x, z)
	var far := _far_at(x, z)
	var roll := TERRAIN_AMP * smoothstep(8.0, 40.0, d) * (terrain_noise.get_noise_2d(x, z) * 0.8 + terrain_noise.get_noise_2d(x * 2.7 + 300.0, z * 2.7) * 0.2)
	var rn := 1.0 - absf(ridge_noise.get_noise_2d(x, z))
	var ridge := 16.0 * smoothstep(40.0, 170.0, d) * rn * rn
	far += roll + ridge
	for pd in pads:
		var w := 1.0 - smoothstep(float(pd[1]), float(pd[1]) + 12.0, Vector2(x, z).distance_to(pd[0]))
		far = lerpf(far, float(pd[2]), w)
	far = minf(far, _hmax + 34.0)
	var land := far
	var w_road := 1.0 - smoothstep(9.0, 30.0, d)
	if w_road > 0.0:
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
		land = lerpf(far, road_h, w_road)
	land += _tunnel_ridge(x, z)
	var s := _sea_s(x, z)
	if s > -2.0:
		var cw := _coast_w_at(z)
		var t := smoothstep(-2.0, cw, s)
		var bed := SEABED - clampf((s - cw) * 0.07, 0.0, 9.0)
		# A ledge of rock just under the water at the foot, so the surf has
		# something to break on.
		bed += 7.5 * (1.0 - smoothstep(cw, cw + 7.0, s)) * smoothstep(cw - 3.0, cw, s) * (0.6 + 0.4 * coast_noise.get_noise_2d(x / 6.0, z / 6.0))
		land = lerpf(land, bed, sqrt(t))
	return land


## The headland's ridge over the tunnel: a hump across the road at the
## tunnel's middle, as long as the bore plus its approach cuttings, with the
## bore itself (the road, a little more) left at road height for the cap to
## roof over.
func _tunnel_ridge(x: float, z: float) -> float:
	var a := pts[tun_i0]
	var b := pts[tun_i1]
	var ab := Vector2(b.x - a.x, b.z - a.z)
	var len := ab.length()
	var dir := ab / len
	var q := Vector2(x - a.x, z - a.z)
	var along := q.dot(dir) - len * 0.5
	var lat := absf(q.dot(Vector2(-dir.y, dir.x)))
	var hump := 1.0 - smoothstep(len * 0.5 - 4.0, len * 0.5 + 30.0, absf(along))
	if hump <= 0.0:
		return 0.0
	# Across: flat over the headland, falling away into the sea far east and
	# into the hills west; the bore and the cuttings at road height.
	var across := 1.0 - smoothstep(110.0, 190.0, lat)
	var bore := smoothstep(tun_half + 0.6, tun_half + 4.6, lat) if absf(along) < len * 0.5 + 34.0 else 1.0
	return RIDGE_H * hump * across * bore


func _in_tunnel(i: int) -> bool:
	return i >= tun_i0 and i < tun_i1


## Road cross-section: gravel, a crown and two polished tracks; broken
## tarmac where it's tarmac (vertex alpha under 1: the road shader drops most
## of the loose stones and gives it a little sheen); dark in the tunnel.
func _profile(i: int) -> Array:
	var h := half_w[i]
	var v := h + verge_w[i]
	var cols := [
		[-(v + 0.7), C_FOOT, 0.15], [-v, C_EDGE, 0.12], [-h, C_VERGE, 0.12], [-1.9, C_GRAVEL, 0.0], [-1.25, C_RUT, 0.0], [-0.5, C_CROWN, 0.0],
		[0.5, C_CROWN, 0.0], [1.25, C_RUT, 0.0], [1.9, C_GRAVEL, 0.0], [h, C_VERGE, 0.12], [v, C_EDGE, 0.12], [v + 0.7, C_FOOT, 0.15],
	]
	var tw := tarmac_w[i]
	var dark := 1.0
	if i >= tun_i0 - 3 and i <= tun_i1 + 3:
		dark = lerpf(1.0, 0.42, smoothstep(float(tun_i0 - 3), float(tun_i0 + 3), float(i)) * (1.0 - smoothstep(float(tun_i1 - 3), float(tun_i1 + 3), float(i))))
	for k in cols.size():
		var c: Color = cols[k][1]
		if tw > 0.0 and k >= 2 and k <= 9:
			var rut := k == 4 or k == 7
			var verge := k == 2 or k == 9
			# Broken: the edges crumble back to gravel, and potholes and
			# patches show through in places.
			var hole := noise.get_noise_2d(i * 1.7, k * 3.1) * 0.5 + noise.get_noise_2d(i * 0.35, k * 0.9 + 40.0)
			var keep := tw * smoothstep(-0.2, 0.1, hole) * (0.35 if verge else 1.0)
			var tar := C_TARMAC_RUT if rut else (C_PATCH if hole > 0.35 else C_TARMAC)
			c = c.lerp(tar, keep)
			c.a = lerpf(1.0, 0.45, keep)
		cols[k][1] = Color(c.r * dark, c.g * dark, c.b * dark, c.a)
	return cols


## In the bore the edge creep would read as moss in the dark: push the
## shader's verge edge out past the walls there.
func _road_uv2(i: int) -> Vector2:
	if i >= tun_i0 - 1 and i <= tun_i1 + 1:
		var v := half_w[i] + verge_w[i] + 3.0
		return Vector2(v, v + 0.5)
	return super(i)


# --- world -----------------------------------------------------------------------

func _env() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	# Morning sun off the sea, from the south-east: the cliffs facing it lit,
	# the cuts between the legs in shade.
	sun.rotation_degrees = Vector3(-40, 130, 0)
	sun.light_color = Color(1.0, 0.96, 0.9)
	sun.light_energy = 1.05
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
	env.background_color = Color("8fa9bf")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.68, 0.74, 0.8)
	env.ambient_light_energy = 0.6
	we.environment = env
	track.add_child(we)


## Which side of each sample falls away: the ground a few metres out is
## more than 2 m under the road (the cliff, the cut down to the leg below,
## the quay). Runs are joined over short breaks and padded a little, so a
## rail doesn't stop and start along a bumpy edge.
func _find_drops() -> void:
	for side: float in [-1.0, 1.0]:
		var raw := PackedFloat32Array()
		raw.resize(n)
		for i in n:
			var e := half_w[i] + verge_w[i]
			var lo := INF
			for off in [2.5, 5.0, 8.0, 12.5]:
				var q: Vector3 = pts[i] + _right(i) * side * (e + off)
				lo = minf(lo, terrain.height_at(q.x, q.z) + off * 0.08)
			# ...and the cliff edge further out: the sea is often 20-30 m off
			# across the heath, and a car that leaves there still goes over.
			var far := INF
			for off in [20.0, 30.0]:
				var q: Vector3 = pts[i] + _right(i) * side * (e + off)
				far = minf(far, terrain.height_at(q.x, q.z))
			raw[i] = 1.0 if pts[i].y - lo > 2.0 or pts[i].y - far > 6.0 else 0.0
		var out := raw.duplicate()
		for i in n:
			if raw[i] > 0.0:
				for j in range(maxi(i - 4, 0), mini(i + 5, n)):
					out[j] = 1.0
		# Close gaps under 24 m.
		var last := -1000
		for i in n:
			if out[i] > 0.0:
				if i - last > 1 and i - last <= 12 and last >= 0:
					for j in range(last, i):
						out[j] = 1.0
				last = i
		drop[side] = out
	wall_kind.resize(n)
	for i in n:
		var m := i * STEP
		var stone := m < 240.0 or (m > 900.0 and m < 1330.0) or absf(m - tun_i0 * STEP) < 130.0 or absf(m - tun_i1 * STEP) < 110.0
		wall_kind[i] = 1 if stone else 0


func _gap_at(s: float, side: float) -> bool:
	for gp in wall_gaps:
		if float(gp[2]) != 0.0 and float(gp[2]) != side:
			continue
		if s >= float(gp[0]) and s <= float(gp[1]):
			return true
	return false


## The guard on the drop side: armco on posts (the switchbacks, the
## descent) or a dry stone wall with a cap (the harbour, the old cliff-top
## road, the tunnel approaches). Solid: a trimesh face on the road side per
## road piece, like Snowblind's banks; you scrape along it, you don't go
## through it. One mesh (one draw) per two road pieces, both sides.
func _walls() -> void:
	var body := StaticBody3D.new()
	body.name = "GuardRails"
	body.collision_layer = LAYER_WORLD
	body.collision_mask = 0
	body.add_to_group("track_obstacle", true)
	body.set_meta("kind", "rail")
	const PIECE := ROAD_PIECE * 2
	var metres := [0.0, 0.0]
	var wn := FastNoiseLite.new()
	wn.seed = SEED + 77
	wn.frequency = 1.0
	for i0 in range(0, n - 1, PIECE):
		var st := _st()
		var faces := PackedVector3Array()
		var any := false
		for side: float in [-1.0, 1.0]:
			var on: PackedFloat32Array = drop[side]
			for i in range(i0, mini(i0 + PIECE, n - 1)):
				if on[i] < 0.5 or on[i + 1] < 0.5 or _in_tunnel(i) or _gap_at(i * STEP, side) or _gap_at((i + 1) * STEP, side):
					continue
				any = true
				var a := _g(pts[i] + _right(i) * side * (half_w[i] + verge_w[i] + WALL_OFF))
				var b := _g(pts[i + 1] + _right(i + 1) * side * (half_w[i + 1] + verge_w[i + 1] + WALL_OFF))
				var dir := b - a
				var mid := (a + b) * 0.5
				var out := _right(i) * side
				if wall_kind[i] == 1:
					metres[1] += STEP
					var hh := 0.85 + wn.get_noise_1d(i * 0.9) * 0.1
					var col := C_STONE.darkened(0.08 + 0.08 * wn.get_noise_1d(i * 2.3 + 9.0))
					var basis := Basis.looking_at(dir, Vector3.UP)
					_box(st, Transform3D(basis, mid + out * 0.25 + Vector3(0, hh * 0.5 - 0.15, 0)), Vector3(0.55, hh + 0.3, dir.length() + 0.05), col)
					_box(st, Transform3D(basis, mid + out * 0.25 + Vector3(0, hh + 0.04, 0)), Vector3(0.66, 0.14, dir.length() + 0.05), C_STONE_CAP.darkened(0.06 * (i % 3)))
				else:
					metres[0] += STEP
					var basis := Basis.looking_at(dir, Vector3.UP)
					_box(st, Transform3D(basis, mid + Vector3(0, 0.78, 0)), Vector3(0.07, 0.15, dir.length() + 0.04), C_ARMCO)
					_box(st, Transform3D(basis, mid + Vector3(0, 0.62, 0) - out * 0.015), Vector3(0.06, 0.17, dir.length() + 0.04), C_ARMCO.darkened(0.12))
					if i % 2 == 0:
						_box(st, Transform3D(Basis.looking_at(tans[i], Vector3.UP), a + out * 0.14 + Vector3(0, 0.42, 0)), Vector3(0.12, 0.95, 0.14), C_POST)
					if i % 6 == 0:
						_box(st, Transform3D(Basis.looking_at(tans[i], Vector3.UP), a + Vector3(0, 0.95, 0) + out * 0.05), Vector3(0.1, 0.16, 0.05), C_REFLECT if side > 0 else C_RED)
				var lo := Vector3(0, -0.4, 0)
				var hi := Vector3(0, 1.15, 0)
				faces.append_array([a + lo, b + lo, a + hi, a + hi, b + lo, b + hi])
		if not any:
			continue
		var mi := _mesh_node("Rail%d" % (i0 / PIECE), _commit(st))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		body.add_child(mi)
		var shape := ConcavePolygonShape3D.new()
		shape.set_faces(faces)
		shape.backface_collision = true
		var cs := CollisionShape3D.new()
		cs.name = "Shape%d" % (i0 / PIECE)
		cs.shape = shape
		body.add_child(cs)
	track.add_child(body)
	# Diagnostic: big drops (6 m inside 30 m) left open, outside the gaps.
	for side: float in [-1.0, 1.0]:
		var on: PackedFloat32Array = drop[side]
		var run := -1
		for i in n:
			var e := half_w[i] + verge_w[i]
			var lo := INF
			for off in [6.0, 12.0, 20.0, 30.0]:
				var q: Vector3 = pts[i] + _right(i) * side * (e + off)
				lo = minf(lo, terrain.height_at(q.x, q.z))
			var open := pts[i].y - lo > 6.0 and on[i] < 0.5 and not _in_tunnel(i) and not _gap_at(i * STEP, side)
			if open and run < 0:
				run = i
			elif not open and run >= 0:
				print("  open drop side %+d: %d-%d m" % [side, run * STEP, i * STEP])
				run = -1
	print("guard: %.0f m of armco, %.0f m of stone wall, gaps at %s" % [metres[0], metres[1], wall_gaps.map(func(g: Array) -> String: return "%d-%d" % [g[0], g[1]])])


## Service park on the quay before the start, stop control past the finish.
func _service_and_stop() -> void:
	var g := _group("ServiceAndStop")
	var start := _g(pts[0] - tans[0] * 8.0)
	yards.append([Vector2(start.x, start.z), 18.0, C_YARD])
	clearings.append([Vector2(start.x, start.z), 24.0])
	for k in 3:
		var p := _g(pts[spawn_i] + _right(spawn_i) * -9.5 + tans[spawn_i] * (k * 8.0 - 26.0))
		var tent := _solid("Tent%d" % k, "tent", Transform3D(Basis.looking_at(tans[spawn_i], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)
	for k in 6:
		var p := _g(pts[0] + _right(0) * (k * 1.3 - 3.2))
		g.add_child(_mesh_node("Cone%d" % k, meshes["cone"], Transform3D(Basis.IDENTITY, p)))
	var end := _g(pts[n - 1] + tans[n - 1] * 12.0)
	clearings.append([Vector2(end.x, end.z), 20.0])
	yards.append([Vector2(end.x, end.z), 16.0, C_YARD])
	for k in 2:
		var p := _g(end + _right(n - 1) * (k * 10.0 - 5.0) + tans[n - 1] * 6.0)
		var tent := _solid("StopTent%d" % k, "tent", Transform3D(Basis.looking_at(tans[n - 1], Vector3.UP), p), Vector3(4, 2.6, 4), Vector3(2, 0, -2))
		tent.add_child(_mesh_node("Mesh", meshes["tent"]))
		g.add_child(tent)


## Fans where there's ground to stand on: the two tightest hairpins, on
## whichever side doesn't fall away, and a fast kink on the cliff top.
func _plan_spectators() -> void:
	var by_radius := corners.duplicate()
	by_radius.sort_custom(func(a: Array, b: Array) -> bool: return a[1] < b[1])
	for c in by_radius:
		if spectator_spots.size() >= 2:
			break
		var i: int = c[0]
		for side: float in [-c[2], c[2]]:
			if (drop[side] as PackedFloat32Array)[i] < 0.5 and not _in_tunnel(i):
				var q := pts[i] + _right(i) * side * 9.0
				if absf(terrain.height_at(q.x, q.z) - pts[i].y) < 3.0:
					spectator_spots.append([i, side])
					break
	var k := int(1180.0 / STEP)
	spectator_spots.append([k, -1.0 if (drop[1.0] as PackedFloat32Array)[k] > 0.5 else 1.0])
	print("spectators at %s" % [spectator_spots.map(func(s: Array) -> String: return "%d m %s" % [s[0] * STEP, "R" if s[1] > 0 else "L"])])


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


func _merge_props() -> void:
	for g: Node in [track.get_node("Landmarks"), track.get_node("Spectators")]:
		for body in g.get_children():
			var parts: Array = body.get_children().filter(func(nd: Node) -> bool:
				return nd is MeshInstance3D and nd.mesh and nd.mesh.get_surface_count() == 1 \
					and nd.mesh.surface_get_material(0) == vc_mat and nd.layers == RENDER_WORLD \
					and nd.cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_ON)
			if parts.size() < 2:
				continue
			var st := _st()
			for mi: MeshInstance3D in parts:
				_merge(st, mi.mesh, mi.transform)
				body.remove_child(mi)
				mi.free()
			body.add_child(_mesh_node("Mesh", _commit(st)))


static func _at(p: Vector3) -> Transform3D:
	return Transform3D(Basis.IDENTITY, p)


# --- the sea tunnel ----------------------------------------------------------------

## The bore's cross-section, left to right: [lateral m, height m], walls
## straight up to the springing line, then a flattened arch to the crown.
func _bore(w: float) -> Array:
	return [[-w, -0.3], [-w, 1.1], [-w, 3.7], [-w * 0.86, 4.75], [-w * 0.55, 5.45], [0.0, TUN_H],
		[w * 0.55, 5.45], [w * 0.86, 4.75], [w, 3.7], [w, 1.1], [w, -0.3]]


## The sea tunnel through the headland. Three parts:
## - The bore (Tunnel/Bore): lined walls and the arched ceiling, seen from
##   inside, dark, with sodium lamps along the crown (glows on layer 5).
##   Its own trimesh collider, so you scrape the walls and the chase arm
##   stops under the ceiling instead of poking out through the rock.
## - The portals: stone faces either end, up to the crown; solid.
## - The cap (Tunnel/Roof, scripts/tunnel_roof.gd): the rock and heath over
##   the bore and the portals' head walls, between the ridge either side.
##   For the top-down camera it dissolves (dithered) while the car is in or
##   near the tunnel, so the road under it, the car and the walls can be
##   seen; chase and bonnet never fade it (they're inside). The static map
##   doesn't need it to: the road ribbon is drawn 30 m over everything.
func _tunnel() -> void:
	var g := Node3D.new()
	g.name = "Tunnel"
	track.add_child(g)
	var w := tun_half
	var sec := _bore(w)
	var i0 := tun_i0
	var i1 := tun_i1
	# Bore.
	var st := _st()
	var faces := PackedVector3Array()
	var lamps: Array = []
	for i in range(i0, i1):
		for k in sec.size() - 1:
			var quad: Array = []
			for c in [[i, k], [i + 1, k], [i, k + 1], [i + 1, k + 1]]:
				var j: int = c[0]
				var s: Array = sec[c[1]]
				quad.append(pts[j] + _right(j) * float(s[0]) + Vector3(0, float(s[1]), 0))
			var y := (float(sec[k][1]) + float(sec[k + 1][1])) * 0.5
			# Lining: pale concrete to 1.1 m, then dark rock and soot up to the crown.
			var col := C_TUNNEL_WALL.lightened(0.18) if y < 1.1 else C_TUNNEL_WALL.darkened(0.12 * (y - 1.1) / 4.7)
			col = col.darkened(0.06 * ((i / 3) % 2))
			# Wound to face inward (toward the centreline).
			_tri(st, quad[0], quad[2], quad[1], col)
			_tri(st, quad[1], quad[2], quad[3], col)
			faces.append_array([quad[0], quad[2], quad[1], quad[1], quad[2], quad[3]])
		if (i - i0) % 7 == 3:
			lamps.append(i)
	for i in lamps:
		var p := pts[i] + Vector3(0, TUN_H - 0.15, 0)
		_box(st, Transform3D(Basis.looking_at(tans[i], Vector3.UP), p), Vector3(0.5, 0.12, 1.2), Color("1d1d1d"))
		_box(st, Transform3D(Basis.looking_at(tans[i], Vector3.UP), p - Vector3(0, 0.07, 0)), Vector3(0.36, 0.03, 1.0), C_LAMP)
	# Kerbs either side, painted.
	for i in range(i0, i1):
		for side: float in [-1.0, 1.0]:
			var a := _g(pts[i] + _right(i) * side * (w - 0.25))
			var b := _g(pts[i + 1] + _right(i + 1) * side * (w - 0.25))
			_box(st, Transform3D(Basis.looking_at(b - a, Vector3.UP), (a + b) * 0.5 + Vector3(0, 0.1, 0)), Vector3(0.5, 0.22, a.distance_to(b) + 0.02), C_WHITE.darkened(0.45) if (i / 2) % 2 == 0 else Color("6a5a20"))
	var bore := StaticBody3D.new()
	bore.name = "Bore"
	bore.collision_layer = LAYER_WORLD
	bore.collision_mask = 0
	bore.add_to_group("track_obstacle", true)
	bore.set_meta("kind", "tunnel")
	var mi := _mesh_node("Mesh", _commit(st))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	bore.add_child(mi)
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	shape.backface_collision = true
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	cs.shape = shape
	bore.add_child(cs)
	g.add_child(bore)
	var lights := Node3D.new()
	lights.name = "Lamps"
	var lamp_mat := _glow_mat(Color(1.0, 0.72, 0.32), 0.9, 0.0, Vector2(70.0, 120.0))
	for i in lamps:
		lights.add_child(_glow("Lamp%d" % i, 1.6, lamp_mat, pts[i] + Vector3(0, TUN_H - 0.45, 0)))
	g.add_child(lights)
	# Portals: the face round the opening, up to the crown (solid, layer 1);
	# above the crown, the head wall belongs to the cap.
	var pst := _st()
	var roof := _st()
	var portal_body := StaticBody3D.new()
	portal_body.name = "Portals"
	portal_body.collision_layer = LAYER_WORLD
	portal_body.collision_mask = 0
	portal_body.add_to_group("track_obstacle", true)
	portal_body.set_meta("kind", "tunnel")
	for end in [i0, i1]:
		var basis := Basis.looking_at(tans[end], Vector3.UP)
		var o := pts[end]
		const FACE := 1.4
		const SPAN := 9.0
		for side: float in [-1.0, 1.0]:
			# Pillar from the opening to SPAN either side, up to the springing.
			var xf := Transform3D(basis, o + _right(end) * side * (w + SPAN * 0.5) + Vector3(0, 2.0, 0))
			_box(pst, xf, Vector3(SPAN, 4.6, FACE), C_STONE_DARK)
			var cs2 := CollisionShape3D.new()
			cs2.name = "Pillar%d_%d" % [end, int(side)]
			var bs := BoxShape3D.new()
			bs.size = Vector3(SPAN, 4.6, FACE)
			cs2.shape = bs
			cs2.transform = xf
			portal_body.add_child(cs2)
			# Above the pillar to the crown, and the arch's shoulders.
			var top := TUN_H + 0.3
			_box(pst, Transform3D(basis, o + _right(end) * side * (w + SPAN * 0.5) + Vector3(0, (4.3 + top) * 0.5, 0)), Vector3(SPAN, top - 4.3, FACE), C_STONE_DARK)
			for k in [2, 3]:
				var x0 := absf(float(sec[k][0]))
				var x1 := absf(float(sec[k + 1][0]))
				var y0 := float(sec[k + 1][1])
				_box(pst, Transform3D(basis, o + _right(end) * side * (x0 + x1) * 0.5 + Vector3(0, (y0 + top) * 0.5, 0)), Vector3(x0 - x1 + 0.05, top - y0, FACE * 0.98), C_STONE_DARK)
		# Voussoirs: a lighter band round the opening, on the outer face.
		var outward := -tans[end] if end == i0 else tans[end]
		for k in range(2, sec.size() - 3):
			var s0: Array = sec[k]
			var s1: Array = sec[k + 1]
			var a := o + _right(end) * float(s0[0]) * 1.04 + Vector3(0, float(s0[1]) + 0.15, 0) + outward * (FACE * 0.5 + 0.03)
			var b := o + _right(end) * float(s1[0]) * 1.04 + Vector3(0, float(s1[1]) + 0.15, 0) + outward * (FACE * 0.5 + 0.03)
			_beam(pst, a, b, 0.5, C_STONE_CAP)
		# Head wall, crown to ridge: part of the cap.
		_box(roof, Transform3D(basis, o + Vector3(0, (TUN_H + RIDGE_H + 0.8) * 0.5, 0)), Vector3(2.0 * (w + SPAN), RIDGE_H + 0.8 - TUN_H, FACE), C_STONE_DARK)
		_box(roof, Transform3D(basis, o + Vector3(0, RIDGE_H + 0.9, 0)), Vector3(2.0 * (w + SPAN) + 0.3, 0.3, FACE + 0.3), C_STONE_CAP)
	portal_body.add_child(_mesh_node("Mesh", _commit(pst)))
	g.add_child(portal_body)
	# The cap: rock and heath over the bore, from portal to portal and
	# across to where the ridge carries on, a hair under the ridge's height
	# at its edges so it tucks into the ground.
	const ACROSS := [-14.0, -10.0, -6.0, -2.0, 2.0, 6.0, 10.0, 14.0]
	var cn := FastNoiseLite.new()
	cn.seed = SEED + 91
	cn.frequency = 1.0
	var rows: Array = []
	for i in range(i0, i1 + 1):
		var row: Array = []
		for lat in ACROSS:
			var p := pts[i] + _right(i) * float(lat)
			var top := pts[i].y + RIDGE_H + 0.6 + cn.get_noise_2d(i * 0.4, float(lat) * 0.3) * 0.7
			if absf(float(lat)) > 12.0:
				top = minf(top, terrain.height_at(p.x, p.z) - 0.3)
			row.append(Vector3(p.x, top, p.z))
		rows.append(row)
	for r in rows.size() - 1:
		for k in ACROSS.size() - 1:
			var a: Vector3 = rows[r][k]
			var b: Vector3 = rows[r][k + 1]
			var c: Vector3 = rows[r + 1][k]
			var d: Vector3 = rows[r + 1][k + 1]
			var heath := cn.get_noise_2d(a.x * 0.2, a.z * 0.2) * 0.5 + 0.5
			var col := C_GRASS.lerp(C_HEATH, heath)
			var tint := col.darkened(0.08 * cn.get_noise_2d(a.x, a.z))
			_tri(roof, a, b, c, tint)
			_tri(roof, b, d, c, tint)
	# Skirts under the cap's long edges, down into the ridge, in rock.
	for side_k in [0, ACROSS.size() - 1]:
		for r in rows.size() - 1:
			var a: Vector3 = rows[r][side_k]
			var c: Vector3 = rows[r + 1][side_k]
			var a2 := a - Vector3(0, 4.0, 0)
			var c2 := c - Vector3(0, 4.0, 0)
			if side_k == 0:
				_tri(roof, a, c, a2, C_ROCK)
				_tri(roof, c, c2, a2, C_ROCK)
			else:
				_tri(roof, a, a2, c, C_ROCK)
				_tri(roof, c, a2, c2, C_ROCK)
	var roof_mat := ShaderMaterial.new()
	roof_mat.shader = load("res://shaders/tunnel_roof.gdshader")
	var cap := TunnelRoof.new()
	cap.name = "Roof"
	cap.mesh = _commit(roof, roof_mat)
	cap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	var bore_line := PackedVector3Array()
	for i in range(i0, i1 + 1, 2):
		bore_line.append(pts[i])
	cap.line = bore_line
	cap.add_to_group("track_shaded", true)
	g.add_child(cap)
	# The tunnel's callout: "sea tunnel", at the mouth.
	var marker := Marker3D.new()
	marker.name = "SeaTunnel"
	marker.position = pts[i0] + Vector3(0, TUN_H, 0)
	marker.add_to_group("track_landmark", true)
	marker.set_meta("label", "sea tunnel")
	marker.set_meta("distance_m", i0 * STEP)
	_landmarks().add_child(marker)
	for i in range(i0 - 20, i1 + 20):
		clearings.append([Vector2(pts[i].x, pts[i].z), tun_half + 9.0 if _in_tunnel(i) else tun_half + 3.0])
	print("tunnel: %d m bore, %d lamps, cap %d triangles" % [(i1 - i0) * STEP, lamps.size(), cap.mesh.get_faces().size() / 3])


# --- landmarks --------------------------------------------------------------------

func _cyl(st: SurfaceTool, r0: float, r1: float, h: float, y: float, col: Color, segs := 12) -> void:
	var c := CylinderMesh.new()
	c.bottom_radius = r0
	c.top_radius = r1
	c.height = h
	c.radial_segments = segs
	c.rings = 1
	_prim(st, c, _at(Vector3(0, y + h * 0.5, 0)), col)


## The lighthouse on its point: a white tower with two red bands, the
## gallery and lantern room, a red cap; the keeper's cottage and a low wall
## round the yard; a lane from a gap in the road's wall. The lamp is a slow
## breathing glow (layer 5; nothing flashes). Tall, so it's a haze
## silhouette from far off (track_tall), and the callout everyone gets.
func _lighthouse() -> void:
	var i: int = lighthouse_spot[0]
	var p := _g(lighthouse_spot[2], -0.1)
	var body := _solid("Lighthouse", "landmark", Transform3D(_facing_road(i, p), p), Vector3(5.6, 18.0, 5.6))
	body.add_to_group("track_landmark", true)
	body.set_meta("label", "lighthouse")
	body.set_meta("distance_m", i * STEP)
	var st := _st()
	const H := 17.0
	_cyl(st, 2.7, 2.9, 1.2, -0.2, C_STONE_DARK, 14)
	_cyl(st, 2.5, 1.8, H, 1.0, C_WHITE, 14)
	for b in [[5.0, 2.2], [10.4, 2.2]]:
		var y0: float = b[0]
		var r0 := lerpf(2.5, 1.8, y0 / H) + 0.04
		var r1 := lerpf(2.5, 1.8, (y0 + b[1]) / H) + 0.04
		_cyl(st, r0, r1, b[1], 1.0 + y0, C_RED, 14)
	_cyl(st, 2.6, 2.6, 0.35, H + 1.0, Color("2b2f33"), 14) # gallery
	for k in 14:
		var a := TAU * k / 14.0
		_beam(st, Vector3(cos(a) * 2.5, H + 1.35, sin(a) * 2.5), Vector3(cos(a) * 2.5, H + 2.3, sin(a) * 2.5), 0.06, Color("2b2f33"))
	_cyl(st, 1.45, 1.45, 2.2, H + 1.35, Color("e8d9a0"), 10) # lantern glass, lit
	for k in 6:
		var a := TAU * k / 6.0
		_beam(st, Vector3(cos(a) * 1.5, H + 1.35, sin(a) * 1.5), Vector3(cos(a) * 1.5, H + 3.55, sin(a) * 1.5), 0.1, Color("2b2f33"))
	var dome := SphereMesh.new()
	dome.radius = 1.6
	dome.height = 1.6
	dome.radial_segments = 10
	dome.rings = 3
	dome.is_hemisphere = true
	_prim(st, dome, _at(Vector3(0, H + 3.5, 0)), C_RED)
	_box(st, _at(Vector3(0, H + 5.2, 0)), Vector3(0.12, 0.6, 0.12), Color("2b2f33"))
	_box(st, _at(Vector3(0, 1.1, 2.45)), Vector3(1.0, 2.0, 0.2), C_TIMBER_DARK) # door
	var tower := _commit(st)
	body.add_child(_mesh_node("Tower", tower))
	# Keeper's cottage, toward the road, and the yard wall.
	var cst := _st()
	var c := Vector3(-3.5, 0, 9.0)
	_box(cst, _at(c + Vector3(0, 1.5, 0)), Vector3(8.0, 3.0, 5.0), C_WHITE.darkened(0.04))
	var roof := PrismMesh.new()
	roof.size = Vector3(8.6, 2.0, 5.6)
	_prim(cst, roof, Transform3D(Basis(Vector3.UP, PI * 0.5), c + Vector3(0, 4.0, 0)), C_SLATE)
	_box(cst, _at(c + Vector3(2.8, 4.4, 0)), Vector3(0.7, 1.6, 0.7), C_WHITE.darkened(0.1))
	for x in [-2.4, 0.0, 2.4]:
		_box(cst, _at(c + Vector3(x, 1.7, 2.52)), Vector3(0.9, 1.0, 0.06), C_GLASS if x != 0.0 else C_TIMBER_DARK)
	var yard_r := 12.5
	for k in 24:
		var a0 := TAU * k / 24.0
		var a1 := TAU * (k + 1) / 24.0
		if k == 5 or k == 6: # the gate, toward the road
			continue
		_beam(cst, Vector3(cos(a0) * yard_r, 0.45, sin(a0) * yard_r), Vector3(cos(a1) * yard_r, 0.45, sin(a1) * yard_r), 0.6, C_STONE)
	body.add_child(_mesh_node("Cottage", _commit(cst)))
	var cs := CollisionShape3D.new()
	cs.name = "Cottage"
	var bs := BoxShape3D.new()
	bs.size = Vector3(8.0, 3.5, 5.0)
	cs.shape = bs
	cs.position = c + Vector3(0, 1.75, 0)
	body.add_child(cs)
	body.add_child(_glow("Lamp", 9.0, _glow_mat(Color(1.0, 0.86, 0.5), 1.25, 6.0, Vector2(220.0, 520.0)), Vector3(0, H + 2.4, 0)))
	body.add_to_group("track_tall", true)
	body.set_meta("proxy_mesh", _lighthouse_proxy(H, p.y))
	_landmarks().add_child(body)
	clearings.append([Vector2(p.x, p.z), 16.0])
	yards.append([Vector2(p.x, p.z), 12.0, C_GRASS.lightened(0.1)])
	for k in 9:
		var q := pts[i] + _right(i) * lerpf(4.0, LIGHTHOUSE_OFF - 9.0, k / 8.0)
		yards.append([Vector2(q.x, q.z), 2.4, C_YARD])
		clearings.append([Vector2(q.x, q.z), 3.5])
	_sightline([i, 1.0, p])
	print("lighthouse at %.0f m, %.1f m off the road, %.1f m above the sea" % [i * STEP, _road_dist(p.x, p.z), p.y])


## What the far view draws (EyeForest's haze copy, past the far plane):
## the tower with its bands a duller red (the haze shader pulses anything
## red enough as a beacon, and these are paint), the lantern lit, and the
## headland under it down to the sea, since the real ground under it is
## past the far plane too and the tower would otherwise hang in the sky.
func _lighthouse_proxy(h: float, above_sea: float) -> ArrayMesh:
	var st := _st()
	_cyl(st, 2.5, 1.8, h, 1.0, C_WHITE, 10)
	for b in [[5.0, 2.2], [10.4, 2.2]]:
		_cyl(st, lerpf(2.5, 1.8, b[0] / h) + 0.04, lerpf(2.5, 1.8, (b[0] + b[1]) / h) + 0.04, b[1], 1.0 + b[0], Color("9c4a40"), 10)
	_cyl(st, 1.45, 1.45, 2.2, h + 1.35, Color("e02a20"), 8) # the lamp: pulses
	_cyl(st, 1.6, 0.2, 1.6, h + 3.5, Color("5a3a34"), 8)
	_cyl(st, 48.0, 36.0, above_sea + 1.0, -above_sea, C_STONE_DARK, 7) # a headland, flat-topped
	return _commit(st)


## The pier: a timber deck on piles from the quay out into the harbour, rails,
## lamp posts, two boats moored alongside and a hut at the end; a bait shack
## on the quay and a gate across the pier's foot. You can't drive onto it.
func _pier() -> void:
	var i: int = pier_spot[0]
	var r := _right(i)
	var shore := pts[i] + r * (-_sea_s(pts[i].x, pts[i].z))
	var root := _g(shore - r * 3.0)
	var body := StaticBody3D.new()
	body.name = "Pier"
	body.collision_layer = LAYER_WORLD
	body.add_to_group("track_landmark", true)
	body.add_to_group("track_obstacle", true)
	body.set_meta("label", "pier")
	body.set_meta("kind", "landmark")
	body.set_meta("distance_m", i * STEP)
	body.transform = Transform3D(Basis.looking_at(r, Vector3.UP), Vector3(root.x, 2.4, root.z))
	# Local frame: -Z out to sea, +X along the quay.
	var st := _st()
	const LEN := 62.0
	const W := 4.6
	for k in int(LEN / 2.0):
		var z := -1.0 - k * 2.0
		_box(st, _at(Vector3(0, 0.0, z)), Vector3(W, 0.2, 1.9), C_TIMBER.darkened(0.06 * (k % 3)))
	for k in int(LEN / 5.0) + 1:
		var z := -k * 5.0
		for x in [-W * 0.5 + 0.2, W * 0.5 - 0.2]:
			_beam(st, Vector3(x, -0.1, z), Vector3(x, -5.0, z), 0.32, C_TIMBER_DARK)
		_box(st, _at(Vector3(0, -0.35, z)), Vector3(W, 0.22, 0.22), C_TIMBER_DARK)
	for x in [-W * 0.5 + 0.1, W * 0.5 - 0.1]:
		for k in int(LEN / 2.5):
			_box(st, _at(Vector3(x, 0.55, -k * 2.5)), Vector3(0.1, 1.0, 0.1), C_TIMBER_DARK)
		_box(st, _at(Vector3(x, 1.0, -LEN * 0.5)), Vector3(0.09, 0.09, LEN), C_TIMBER)
	var lamp_at: Array = []
	for k in 4:
		var z := -8.0 - k * 16.0
		var x := (W * 0.5 - 0.15) * (1.0 if k % 2 == 0 else -1.0)
		_box(st, _at(Vector3(x, 1.8, z)), Vector3(0.12, 3.6, 0.12), Color("2b2f33"))
		_box(st, _at(Vector3(x - signf(x) * 0.3, 3.6, z)), Vector3(0.7, 0.08, 0.08), Color("2b2f33"))
		_box(st, _at(Vector3(x - signf(x) * 0.6, 3.45, z)), Vector3(0.3, 0.3, 0.3), C_LAMP)
		lamp_at.append(Vector3(x - signf(x) * 0.6, 3.45, z))
	# The hut at the end, and a life ring.
	_box(st, _at(Vector3(0, 1.4, -LEN + 2.0)), Vector3(3.2, 2.8, 2.8), C_WHITE.darkened(0.1))
	var hr := PrismMesh.new()
	hr.size = Vector3(3.6, 1.0, 3.2)
	_prim(st, hr, _at(Vector3(0, 3.3, -LEN + 2.0)), C_RED)
	_box(st, _at(Vector3(1.61, 1.5, -LEN + 2.0)), Vector3(0.06, 1.0, 0.8), C_GLASS)
	_box(st, _at(Vector3(0, 1.4, -LEN + 3.42)), Vector3(0.9, 1.8, 0.05), C_TIMBER_DARK)
	# Boats alongside: a small blue one and a red one, on the water.
	for b in [[-1.0, -22.0, Color("2f6f9e")], [1.0, -40.0, C_RED]]:
		var bx := float(b[0]) * (W * 0.5 + 1.8)
		var bc: Color = b[2]
		var y := -2.4 + 0.25
		_box(st, _at(Vector3(bx, y + 0.35, float(b[1]))), Vector3(2.0, 0.8, 6.0), bc)
		_box(st, Transform3D(Basis(Vector3.UP, PI * 0.25), Vector3(bx, y + 0.35, float(b[1]) - 3.0)), Vector3(1.42, 0.8, 1.42), bc)
		_box(st, _at(Vector3(bx, y + 0.78, float(b[1]))), Vector3(1.7, 0.08, 5.6), C_TIMBER)
		_box(st, _at(Vector3(bx, y + 1.4, float(b[1]) + 1.0)), Vector3(1.3, 1.2, 1.6), C_WHITE)
		_beam(st, Vector3(bx, y + 0.8, float(b[1]) - 1.0), Vector3(bx, y + 4.0, float(b[1]) - 1.0), 0.08, C_TIMBER_DARK)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	var lamps := Node3D.new()
	lamps.name = "Lamps"
	var lm := _glow_mat(Color(1.0, 0.8, 0.45), 0.7, 0.0, Vector2(60.0, 110.0))
	for q in lamp_at:
		lamps.add_child(_glow("Lamp", 1.4, lm, q))
	body.add_child(lamps)
	# The gate across the pier's foot (solid).
	var gst := _st()
	_box(gst, _at(Vector3(0, 0.55, 1.0)), Vector3(W + 0.4, 0.12, 0.12), C_WHITE)
	_box(gst, _at(Vector3(0, 0.95, 1.0)), Vector3(W + 0.4, 0.12, 0.12), C_RED)
	for x in [-W * 0.5 - 0.2, W * 0.5 + 0.2]:
		_box(gst, _at(Vector3(x, 0.6, 1.0)), Vector3(0.2, 1.2, 0.2), Color("2b2f33"))
	body.add_child(_mesh_node("Gate", _commit(gst)))
	var cs := CollisionShape3D.new()
	cs.name = "Gate"
	var bs := BoxShape3D.new()
	bs.size = Vector3(W + 1.0, 1.6, 0.6)
	cs.shape = bs
	cs.position = Vector3(0, 0.6, 1.0)
	body.add_child(cs)
	_landmarks().add_child(body)
	# Bait shack on the quay beside the pier's foot, and bollards along the edge.
	var shack_at := _g(shore - r * 7.0 + tans[i] * 8.0)
	var shack := _solid("BaitShack", "shack", Transform3D(Basis.looking_at(-r, Vector3.UP), shack_at), Vector3(3.6, 2.8, 3.0))
	var sst := _st()
	_box(sst, _at(Vector3(0, 1.3, 0)), Vector3(3.6, 2.6, 3.0), Color("3f6b7a"))
	var sr := PrismMesh.new()
	sr.size = Vector3(4.0, 0.8, 3.4)
	_prim(sst, sr, _at(Vector3(0, 3.0, 0)), C_SLATE)
	_box(sst, _at(Vector3(0, 1.2, 1.52)), Vector3(1.6, 0.9, 0.05), C_GLASS)
	_merge(sst, meshes["drum"], _at(Vector3(2.4, 0, 0.6)))
	shack.add_child(_mesh_node("Mesh", _commit(sst)))
	_landmarks().add_child(shack)
	var bst := _st()
	for k in range(-9, 10):
		if absi(k) < 2:
			continue
		var q := _g(shore - r * 0.8 + tans[i] * k * 4.0)
		_box(bst, _at(q + Vector3(0, 0.3, 0)), Vector3(0.35, 0.6, 0.35), Color("2b2f33"))
	var bol := _mesh_node("Bollards", _commit(bst))
	track.get_node("Landmarks").add_child(bol)
	clearings.append([Vector2(shore.x, shore.z), 14.0])
	for k in range(-14, 15):
		var q := shore - r * 5.0 + tans[i] * k * 4.0
		yards.append([Vector2(q.x, q.z), 6.0, C_YARD])
	_sightline([i, 1.0, shore])
	print("pier at %.0f m, quay %.1f m off the road" % [i * STEP, _road_dist(shore.x, shore.z)])


# --- callouts ---------------------------------------------------------------------

func _scenery() -> void:
	# The wreck sits on the rocks under the cliff, wherever the coast is there.
	var wi: int = scenery_sites["wreck"][0]
	var r := _right(wi)
	var edge := -_sea_s(pts[wi].x, pts[wi].z)
	scenery_sites["wreck"][2] = pts[wi] + r * (edge + _coast_w_at(pts[wi].z) + 5.0)
	_pots()
	_chapel()
	_shipwreck()
	_phone_box()
	for id in scenery_sites:
		var site: Array = scenery_sites[id]
		var p: Vector3 = site[2]
		var nearest := INF
		for b in [lighthouse_spot[2], pts[(tun_i0 + tun_i1) / 2], pier_spot[2]]:
			nearest = minf(nearest, Vector2(p.x, p.z).distance_to(Vector2(b.x, b.z)))
		var cp_gap := INF
		for m in CP_AT:
			cp_gap = minf(cp_gap, absf(site[0] * STEP - float(m)))
		print("  %-7s at %4.0f m, %s, %4.1f m off the road, %3.0f m from the nearest big landmark, %3.0f m from a checkpoint" % [
			id, site[0] * STEP, "right" if site[1] > 0 else "left", _road_dist(p.x, p.z), nearest, cp_gap])
		assert(nearest > 40.0 and cp_gap > 12.0)


## Lobster pots stacked on the quay, buoys and a coil of rope.
func _pots() -> void:
	var site: Array = scenery_sites["pots"]
	var i: int = site[0]
	var p := _g(site[2], -0.05)
	var body := _solid("LobsterPots", "pots", Transform3D(_facing_road(i, p), p), Vector3(3.4, 1.8, 2.0))
	var st := _st()
	var k := 0
	for row in 3:
		for c in 4 - row:
			var x := -1.2 + c * 0.8 + row * 0.4
			var y := row * 0.55
			var col := Color("6b5a3a") if (k % 3) else Color("3e5a46")
			_box(st, _at(Vector3(x, y + 0.27, 0)), Vector3(0.72, 0.52, 0.9), col)
			_box(st, _at(Vector3(x, y + 0.27, 0)), Vector3(0.76, 0.06, 0.94), col.darkened(0.3))
			k += 1
	for b in [[1.9, 0.4, Color("e8731c")], [2.2, -0.5, Color("e8c21c")], [1.6, -0.6, C_RED]]:
		var sp := SphereMesh.new()
		sp.radius = 0.3
		sp.height = 0.6
		sp.radial_segments = 8
		sp.rings = 4
		_prim(st, sp, _at(Vector3(b[0], 0.3, b[1])), b[2])
	_cyl(st, 0.5, 0.5, 0.2, 0.0, Color("c9b77a"), 10)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_callout(body, "lobster pots", site, "pots", Color("e8731c"))


## A roofless chapel on the heath: grey stone walls, the west gable with its
## bell cote standing, a cross. Off the road on the inland side.
func _chapel() -> void:
	var site: Array = scenery_sites["chapel"]
	var i: int = site[0]
	var p := _g(site[2], -0.1)
	var body := _solid("Chapel", "chapel", Transform3D(_facing_road(i, p).rotated(Vector3.UP, 0.3), p), Vector3(6.0, 4.0, 10.0))
	var st := _st()
	const L := 10.0
	const W := 6.0
	_box(st, _at(Vector3(-W * 0.5, 1.4, 0)), Vector3(0.6, 2.8, L), C_STONE)
	_box(st, _at(Vector3(W * 0.5, 1.0, -1.5)), Vector3(0.6, 2.0, L - 3.0), C_STONE.darkened(0.06))
	_box(st, _at(Vector3(W * 0.5, 0.4, L * 0.5 - 0.8)), Vector3(0.6, 0.8, 1.6), C_STONE.darkened(0.1)) # tumbled
	_box(st, _at(Vector3(0, 1.6, -L * 0.5)), Vector3(W, 3.2, 0.6), C_STONE)
	var gable := PrismMesh.new()
	gable.size = Vector3(W, 2.4, 0.6)
	_prim(st, gable, _at(Vector3(0, 4.4, -L * 0.5)), C_STONE)
	_box(st, _at(Vector3(0, 6.0, -L * 0.5)), Vector3(1.0, 1.4, 0.6), C_STONE.darkened(0.04))
	_box(st, _at(Vector3(0, 6.9, -L * 0.5)), Vector3(0.18, 0.9, 0.18), C_STONE_CAP)
	_box(st, _at(Vector3(0, 7.05, -L * 0.5)), Vector3(0.6, 0.16, 0.16), C_STONE_CAP)
	_box(st, _at(Vector3(0, 1.0, L * 0.5)), Vector3(W, 2.0, 0.6), C_STONE.darkened(0.03))
	_box(st, _at(Vector3(0, 1.15, L * 0.5)), Vector3(1.4, 2.3, 0.7), Color("2a2a2a")) # doorway, dark
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_callout(body, "chapel", site, "chapel", Color("9a968c"))
	yards.append([Vector2(p.x, p.z), 8.0, C_GRASS.lightened(0.08)])


## A fishing boat wrecked on the rocks under the cliff, listing, rusted,
## its wheelhouse stove in. Seen over the wall from the lay-by and the road.
func _shipwreck() -> void:
	var site: Array = scenery_sites["wreck"]
	var i: int = site[0]
	var q: Vector3 = site[2]
	var p := Vector3(q.x, maxf(terrain.height_at(q.x, q.z), -1.6), q.z)
	var body := Node3D.new()
	body.name = "Shipwreck"
	body.transform = Transform3D(Basis.looking_at(tans[i], Vector3.UP).rotated(Vector3.UP, 0.6) * Basis(Vector3.BACK, 0.32) * Basis(Vector3.RIGHT, 0.08), p)
	var st := _st()
	var rust := Color("8e4a22")
	var hull := Color("2f4f5f")
	_box(st, _at(Vector3(0, 0.9, 0)), Vector3(4.2, 1.8, 12.0), hull)
	_box(st, Transform3D(Basis(Vector3.UP, PI * 0.25), Vector3(0, 0.9, -6.0)), Vector3(2.97, 1.8, 2.97), hull)
	_box(st, _at(Vector3(0, 1.85, 0)), Vector3(4.3, 0.15, 12.1), rust)
	_box(st, _at(Vector3(0, 0.35, 0)), Vector3(4.25, 0.5, 12.05), rust.darkened(0.2))
	_box(st, _at(Vector3(0, 2.9, 2.5)), Vector3(2.6, 2.0, 3.0), C_WHITE.darkened(0.3))
	_box(st, _at(Vector3(0, 3.3, 1.0)), Vector3(2.2, 0.6, 0.06), Color("1d1d1d"))
	_beam(st, Vector3(0, 1.9, -2.5), Vector3(0.6, 7.0, -2.8), 0.18, rust)
	_beam(st, Vector3(0.3, 5.2, -2.6), Vector3(-2.0, 2.2, 0.5), 0.08, rust)
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_callout(body, "shipwreck", site, "ship", rust)


## The red phone box at the road end of a farm track.
func _phone_box() -> void:
	var site: Array = scenery_sites["phone"]
	var i: int = site[0]
	var p := _g(site[2], -0.05)
	var body := _solid("PhoneBox", "phone", Transform3D(_facing_road(i, p), p), Vector3(1.1, 2.6, 1.1))
	var st := _st()
	_box(st, _at(Vector3(0, 1.2, 0)), Vector3(1.0, 2.4, 1.0), C_RED)
	_box(st, _at(Vector3(0, 2.5, 0)), Vector3(1.1, 0.2, 1.1), C_RED.darkened(0.1))
	_box(st, _at(Vector3(0, 2.25, 0.51)), Vector3(0.7, 0.14, 0.02), Color("f0ede4"))
	for f in [Vector3(0, 1.35, 0.51), Vector3(0.51, 1.35, 0), Vector3(-0.51, 1.35, 0)]:
		var sz := Vector3(0.7, 1.3, 0.02) if f.z != 0.0 else Vector3(0.02, 1.3, 0.7)
		_box(st, _at(f), sz, Color("c9d6c8"))
	body.add_child(_mesh_node("Mesh", _commit(st)))
	_callout(body, "phone box", site, "phone", C_RED)
	yards.append([Vector2(p.x, p.z), 3.5, C_YARD])
	# The farm track off behind it.
	for k in 8:
		var q: Vector3 = pts[i] + _right(i) * site[1] * (4.0 + k * 3.5) + tans[i] * k * 1.2
		yards.append([Vector2(q.x, q.z), 2.0, C_YARD])
		clearings.append([Vector2(q.x, q.z), 2.5])


## The lay-by: a gravel pull-in on the cliff top where the wall stops, a
## bench, a coin telescope and a sign. Past its edge there's nothing.
func _layby() -> void:
	var i := int(LAYBY_AT / STEP)
	var r := _right(i)
	var g := _group("LayBy")
	var st := _st()
	var edge := -_sea_s(pts[i].x, pts[i].z)
	var spot := _g(pts[i] + r * minf(edge - 2.5, 9.0))
	_merge(st, meshes["bench"], Transform3D(Basis.looking_at(-r, Vector3.UP).rotated(Vector3.UP, PI), spot - tans[i] * 2.0))
	_box(st, _at(spot + tans[i] * 2.0 + Vector3(0, 0.6, 0)), Vector3(0.12, 1.2, 0.12), Color("2b2f33"))
	_box(st, Transform3D(Basis.looking_at(r, Vector3.UP), spot + tans[i] * 2.0 + Vector3(0, 1.3, 0)), Vector3(0.24, 0.24, 0.6), Color("2f6f9e"))
	var sign_at := _g(pts[i] + r * (half_w[i] + verge_w[i] + 0.8) - tans[i] * 10.0)
	_box(st, _at(sign_at + Vector3(0, 0.9, 0)), Vector3(0.08, 1.8, 0.08), Color("6b6660"))
	_box(st, Transform3D(Basis.looking_at(tans[i], Vector3.UP), sign_at + Vector3(0, 1.7, 0)), Vector3(0.8, 0.8, 0.04), Color("2a5fb0"))
	g.add_child(_mesh_node("Mesh", _commit(st)))
	for k in range(-4, 5):
		var q := pts[i] + r * 6.0 + tans[i] * k * 2.0
		yards.append([Vector2(q.x, q.z), 4.0, C_YARD])
		clearings.append([Vector2(q.x, q.z), 5.0])
	var m := Marker3D.new()
	m.name = "Edge"
	m.position = spot
	m.set_meta("distance_m", i * STEP)
	m.add_to_group("track_gap", true)
	g.add_child(m)
	print("lay-by at %.0f m: %.1f m from the road to the edge" % [i * STEP, edge])


# --- easter-egg spots -----------------------------------------------------------------

## Gulls on the rail (on the drop side, on the guard's line), whales and
## boats offshore, seals on the rocks at the foot of the cliff, and the
## serpent's patch of sea. Offshore spots sit on the water, `off` metres
## out from the coast (not the road): the coast decides where the sea is.
func _egg_spots() -> void:
	var g := _group("EggSpots")
	var k := 0
	for spot in EGG_SPOTS:
		var kind: String = spot[0]
		var i := clampi(int(float(spot[1]) / STEP), 0, n - 1)
		var side: float = spot[2]
		var edge := half_w[i] + verge_w[i] + WALL_OFF
		var p: Vector3
		match kind:
			"gulls":
				# On the guard's top: armco rail 0.86 m, the stone wall's cap ~1 m.
				# (the nearest stretch with one, within 40 m).
				var best := -1
				for j in range(maxi(i - 20, 4), mini(i + 21, n - 4)):
					var ok := true
					for jj in range(j - 4, j + 5):
						ok = ok and drop[side][jj] > 0.5 and not _gap_at(jj * STEP, side) and not _in_tunnel(jj)
					if ok and (best < 0 or absi(j - i) < absi(best - i)):
						best = j
				assert(best >= 0, "gulls at %d m need a guard to sit on" % (i * STEP))
				i = best
				edge = half_w[i] + verge_w[i] + WALL_OFF
				p = _g(pts[i] + _right(i) * side * edge, 0.86 if wall_kind[i] == 0 else 1.0)
			"seal":
				# On the rocks at the cliff foot, level with the road's sample
				# (the sea is always east).
				# Out from the cliff edge to the last dry ground over the water.
				var z := pts[i].z
				var x := -_sea_s(0.0, z)
				while x < -_sea_s(0.0, z) + 30.0 and terrain.height_at(x + 0.5, z) > SEA_Y + 0.35:
					x += 0.5
				p = Vector3(x - 0.6, terrain.height_at(x - 0.6, z) + 0.02, z)
			_:
				var x := -_sea_s(0.0, pts[i].z) + _coast_w_at(pts[i].z) + float(spot[3])
				p = Vector3(x, SEA_Y, pts[i].z)
		var m := Marker3D.new()
		m.name = "%s%d" % [kind.capitalize().replace(" ", ""), k]
		m.add_to_group("track_egg", true)
		m.set_meta("kind", kind)
		m.set_meta("distance_m", i * STEP)
		m.set_meta("side", side)
		m.set_meta("edge", edge)
		m.transform = Transform3D(Basis.looking_at(tans[i], Vector3.UP), p)
		match kind:
			"gulls":
				m.set_meta("along", 1.6) # metres between birds on the rail
			"seal":
				m.transform = Transform3D(_facing_road(i, p), p)
				clearings.append([Vector2(p.x, p.z), 3.5]) # no rock on top of it
			"whale", "serpent", "boat":
				m.set_meta("sea_y", SEA_Y)
				# Facing up the coast (north), so "along" runs with the shore.
				var z := pts[i].z
				var along := Vector3(-_sea_s(0.0, z - 6.0) + _sea_s(0.0, z + 6.0), 0, -12.0).normalized()
				m.transform = Transform3D(Basis.looking_at(along, Vector3.UP), p)
				if kind == "boat":
					# How far up and down the coast it can work and stay
					# afloat (a headland is in the way, sometimes).
					var reach := 0.0
					while reach < 70.0:
						var ok := true
						for sgn in [-1.0, 1.0]:
							var q: Vector3 = p + along * sgn * (reach + 2.0)
							for o in [-3.0, 0.0, 3.0]:
								var qq: Vector3 = q + Vector3(-along.z, 0, along.x) * o
								ok = ok and terrain.height_at(qq.x, qq.z) < SEA_Y - 1.5
						if not ok:
							break
						reach += 2.0
					assert(reach >= 20.0, "boat at %d m has no water to work" % (i * STEP))
					m.set_meta("range", reach)
		g.add_child(m)
		k += 1
	print("egg spots: %d" % k)


# --- rocks --------------------------------------------------------------------

## Rock along the cuts and the headlands: wherever the ground rises steeply
## off the road, boulders and tall outcrops stand in front of it (that and
## the cut itself are the eye-level cover between stacked legs and on the
## inside of the bends), and a few big outcrops on the heath. Merged per 2x2
## chunks, box colliders, no shadows, as Snowblind's granite.
func _rock_walls() -> void:
	var g := _group("Rocks")
	var by_cell := {}
	var count := 0
	for i in range(8, n - 8, 3):
		if i > tun_i0 - 8 and i < tun_i1 + 8:
			continue
		for side: float in [-1.0, 1.0]:
			if (drop[side] as PackedFloat32Array)[i] > 0.5 or srng.randf() > 0.55:
				continue
			var e0 := half_w[i] + verge_w[i] + 1.0
			var roll := srng.randf()
			var id := "rock_tall" if roll < 0.3 else ("rock_a" if roll < 0.65 else ("rock_c" if roll < 0.85 else "granite_l"))
			var s := srng.randf_range(1.4, 2.4) if id != "granite_l" else srng.randf_range(0.3, 0.5)
			var aabb: AABB = (meshes[id] as Mesh).get_aabb()
			var reach := maxf(aabb.size.x, aabb.size.z) * s * 0.5
			var lat := e0 + 0.4 + reach * 0.8 + srng.randf_range(0.0, 1.5)
			var q := pts[i] + _right(i) * side * lat
			var gq := terrain.height_at(q.x, q.z)
			var up := terrain.normal_at(q.x, q.z).y
			var steep := gq - pts[i].y > 1.5 or terrain.height_at(q.x + _right(i).x * side * 4.0, q.z + _right(i).z * side * 4.0) - pts[i].y > 3.0
			if not steep and srng.randf() > 0.1:
				continue
			if _road_dist(q.x, q.z) < lat - 0.5 or not _clear(q.x, q.z, reach * 0.5) or _sea_s(q.x, q.z) > -4.0:
				continue
			var xf := Transform3D(Basis(Vector3.UP, srng.randf() * TAU).scaled(Vector3(s, s * srng.randf_range(0.85, 1.3), s)), Vector3(q.x, gq - aabb.size.y * s * 0.12 - (1.0 - up) * 2.0, q.z))
			var key := Vector2i(floori(q.x / (CHUNK * 2.0)), floori(q.z / (CHUNK * 2.0)))
			if not by_cell.has(key):
				by_cell[key] = []
			by_cell[key].append([id, xf, aabb])
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
			_merge(st, meshes[r[0]], xf, Color(1, 1, 1).darkened(srng.randf_range(0.0, 0.12)))
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
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		body.add_child(mi)
		g.add_child(body)
	print("rocks: %d in %d chunks" % [count, keys.size()])


# --- scrub, pines, the shore -------------------------------------------------------

## EyeForest's tree order: tall, default, round, small, far, far_b. All bent
## inland by the wind off the sea.
const TREE_IDS := ["bent_tall", "bent_default", "bent_round", "pine_small", "bent_far", "bent_far_b"]
const TREE_RADII := [0.45, 0.5, 0.45, 0.35, 0.45, 0.45]
const FLOOR_IDS := ["bush", "bush_small", "scrub", "scrub_tri", "grass", "rock_small", "granite_s", "rock_a"]
const FLOOR_RADII := [0.7, 0.0, 0.0, 0.0, 0.0, 0.5, 0.9, 1.1]
const NEAR_FOREST := 24.0
const SOLID_FOREST := 45.0
const LEAN_YAW := PI ## mesh +X (the lean) to world -X: inland, away from the sea


## Coastal: gorse and scrub along the road (the low cover), clumps of
## wind-bent pines inland in patches (the tall cover), heath grass, rocks;
## nothing tall on the cliff-top shelf on the sea side, and rocks along the
## waterline under the cliffs.
func _forest(bb: Rect2) -> void:
	var area := bb.grow(50.0)
	var walls := bb.grow(20.0)
	var chunks := {}
	var counts := {}
	var edge := ROAD_HALF_WIDTH + SHOULDER + 1.3
	var clump := FastNoiseLite.new()
	clump.seed = SEED + 101
	clump.frequency = 0.022
	const CELL := 3.6
	var x := area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, CELL)
			var pz := z + rng.randf_range(0.0, CELL)
			z += CELL
			var d := _fast_dist(px, pz)
			if d < edge + 1.5:
				continue
			var sea := _sea_s(px, pz)
			if sea > -12.0:
				continue
			var c := clump.get_noise_2d(px, pz)
			# Pines only in the clumps; the heath between is open.
			var p := smoothstep(0.05, 0.35, c) * (0.75 if d < NEAR_FOREST else 0.6)
			if rng.randf() > p:
				continue
			if not _clear(px, pz):
				continue
			var up := terrain.normal_at(px, pz).y
			if up < 0.82:
				continue
			var w := rng.randf()
			var id: String
			var s := rng.randf_range(0.8, 1.15)
			if d < NEAR_FOREST:
				id = "bent_tall" if w < 0.3 else ("bent_default" if w < 0.6 else ("bent_round" if w < 0.85 else "pine_small"))
			else:
				id = "bent_tall" if w < 0.2 else ("bent_far" if w < 0.65 else "bent_far_b")
				s = rng.randf_range(0.9, 1.25)
			var solid := d < SOLID_FOREST and walls.has_point(Vector2(px, pz))
			_add(chunks, counts, id, px, terrain.height_at(px, pz) - 0.2, pz, LEAN_YAW + rng.randf_range(-0.35, 0.35), s if solid else -s)
			tree_xz.append(Vector2(px, pz))
		x += CELL
	# Scrub, grass and rock: dense near the road (that's the cover in the
	# bends), thinner out on the heath; on the sea-side shelf only grass and
	# low scrub; rocks along the waterline.
	x = area.position.x
	while x < area.end.x:
		var z := area.position.y
		while z < area.end.y:
			var px := x + rng.randf_range(0.0, 3.0)
			var pz := z + rng.randf_range(0.0, 3.0)
			z += 2.7
			var d := _fast_dist(px, pz)
			if d < edge or not _clear(px, pz):
				continue
			var y := terrain.height_at(px, pz)
			var sea := _sea_s(px, pz)
			var r := rng.randf()
			if sea > -3.0:
				# The waterline: rocks where the ground crosses the sea.
				if y > -2.5 and y < 1.5 and r < 0.16:
					_add(chunks, counts, "rock_a", px, y - 0.4, pz, rng.randf() * TAU, -rng.randf_range(0.9, 2.2))
				continue
			var up := terrain.normal_at(px, pz).y
			if up < 0.7:
				continue
			var shelf := sea > -12.0
			var near := d < 16.0
			var solid := d < SOLID_FOREST
			if r < (0.14 if near else 0.05) and not shelf:
				_add(chunks, counts, "bush", px, y - 0.15, pz, rng.randf() * TAU, rng.randf_range(0.9, 1.5) * (1.0 if solid else -1.0))
			elif r < (0.3 if near else 0.12):
				_add(chunks, counts, "scrub" if rng.randf() < 0.5 else "scrub_tri", px, y - 0.1, pz, rng.randf() * TAU, rng.randf_range(0.9, 1.6) * (0.8 if shelf else 1.0))
			elif r < (0.36 if near else 0.16):
				_add(chunks, counts, "bush_small", px, y - 0.1, pz, rng.randf() * TAU, rng.randf_range(0.8, 1.3))
			elif r < 0.44:
				_add(chunks, counts, "grass", px, y - 0.05, pz, rng.randf() * TAU, rng.randf_range(0.7, 1.2))
			elif r < 0.455 and not shelf:
				_add(chunks, counts, "granite_s", px, y - 0.2, pz, rng.randf() * TAU, rng.randf_range(0.4, 0.8) * (1.0 if solid else -1.0))
			elif r < 0.47:
				_add(chunks, counts, "rock_small", px, y - 0.1, pz, rng.randf() * TAU, rng.randf_range(0.8, 1.4) * (1.0 if solid else -1.0))
		x += 2.7
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
			sc.tint_jitter = 0.08 if kind == "trees" else 0.06
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


## Kenney's pines bent by the sea wind (the top pushed over along +X, by the
## square of the height, so the trunk leans and the crown streams), and two
## cheap bent cones for the far ones.
func _cheap_meshes() -> void:
	for pair in [["bent_tall", "pine_tall", 0.42], ["bent_default", "pine_default", 0.38], ["bent_round", "pine_round", 0.34]]:
		meshes[pair[0]] = _bent(meshes[pair[1]], float(pair[2]))
	var leaf := Color("35502f")
	var bark := Color("4a3a2c")
	var st := _st()
	_cone(st, 5, 0.22, 0.0, 2.6, bark)
	_cone(st, 7, 2.2, 2.0, 5.2, leaf.darkened(0.1))
	_cone(st, 7, 1.6, 4.0, 7.4, leaf, 0.4)
	meshes["bent_far"] = _bent(_commit(st), 0.4)
	st = _st()
	_cone(st, 5, 0.25, 0.0, 2.4, bark)
	_cone(st, 8, 2.6, 2.2, 6.4, leaf.darkened(0.06))
	meshes["bent_far_b"] = _bent(_commit(st), 0.45)


func _bent(src: Mesh, k: float) -> ArrayMesh:
	var aabb := src.get_aabb()
	var h := maxf(aabb.end.y, 0.1)
	var st := _st()
	var a := src.surface_get_arrays(0)
	var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
	var nm: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
	var cols: PackedColorArray = a[Mesh.ARRAY_COLOR]
	var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX] if a[Mesh.ARRAY_INDEX] != null else PackedInt32Array(range(v.size()))
	for i in idx:
		var p := v[i]
		var t := clampf(p.y / h, 0.0, 1.0)
		var lean := k * h * t * t
		# Streamed crown: the leeward side stretches, the windward is shorn short.
		var stretch := 1.0 + 0.35 * t * signf(p.x)
		st.set_color(cols[i] if not cols.is_empty() else Color.WHITE)
		st.set_normal((nm[i] + Vector3(-2.0 * k * t, 0, 0)).normalized())
		st.add_vertex(Vector3(p.x * stretch + lean, p.y * (1.0 - 0.12 * t), p.z * (1.0 - 0.2 * t)))
	return _commit(st)


# --- ground ---------------------------------------------------------------------------

## Ground tint: heath and grass, greener on the cliff-top shelves, darker
## under the pine clumps, yards their own; rock from the shader on anything
## steep (the cliffs, the cuts), and the seabed dark under the water.
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
			var shade := (0.95 + k * 0.12) * lerpf(1.0, 0.8, clampf(dens / 2.0, 0.0, 1.0))
			var c := Color(C_FLOOR_REF.r * shade, C_FLOOR_REF.g * shade, C_FLOOR_REF.b * shade)
			var detail := 1.0
			var h := terrain.h(ix, iz)
			if h < SEA_Y - 0.5:
				c = Color("3a4442").lerp(Color("273634"), smoothstep(0.5, 8.0, SEA_Y - h))
				detail = 0.2
			elif d > 4.0 and _sea_s(x, z) > -12.0:
				c = c.lerp(C_GRASS, 0.55)
				detail = 0.55
			if d < tun_half + 5.0:
				# Under the rock: the coarse grid lifts the ground a little
				# between the kerb and the bore wall, so it's dark rock there.
				var dt := INF
				for i in range(tun_i0, tun_i1 + 1):
					dt = minf(dt, Vector2(x - pts[i].x, z - pts[i].z).length())
				if dt < d + 0.75:
					c = Color("2b2c2c")
					detail = 0.2
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


# --- the sea --------------------------------------------------------------------------

const SHORE_CELL := 2.0
const SHORE_DEPTH := 16.0 ## metres of depth the R channel spans
const SHORE_DIST := 48.0 ## metres of distance-to-shore the G channel spans

## The sea: one flat plane at SEA_Y (one draw, two triangles) from just west
## of the coast out past the far plane, and one small texture baked here:
## R = depth (seabed under the water), G = distance to the shore, both 2 m a
## texel over the terrain's rectangle. shaders/sea.gdshader colours the
## water by depth (turquoise over the rock shelf, deep blue offshore), runs
## two scrolling noise fetches for the swell, and lays the surf where the
## water meets rock: a foam band a few metres wide plus a line running in,
## broken by the noise. On the map (layer 1, rendered once) it's the same
## water, frozen.
func _sea() -> void:
	var rect := Rect2(terrain.origin, Vector2((terrain.w - 1) * TERRAIN_CELL, (terrain.d - 1) * TERRAIN_CELL))
	var w := int(rect.size.x / SHORE_CELL) + 1
	var h := int(rect.size.y / SHORE_CELL) + 1
	var dist := PackedFloat32Array()
	dist.resize(w * h)
	var depth := PackedFloat32Array()
	depth.resize(w * h)
	for iz in h:
		for ix in w:
			var y := terrain.height_at(rect.position.x + ix * SHORE_CELL, rect.position.y + iz * SHORE_CELL)
			depth[iz * w + ix] = clampf(SEA_Y - y, 0.0, SHORE_DEPTH)
			# Land (and anything within a hair of the surface) is distance 0;
			# the water's distance grows from it. Half a cell is taken off, so
			# the band starts at the edge rather than a cell out.
			dist[iz * w + ix] = 0.0 if y > SEA_Y - 0.15 else 1e6
	const O := SHORE_CELL
	const DG := SHORE_CELL * 1.4142
	for iz in h:
		for ix in w:
			var i := iz * w + ix
			var v := dist[i]
			if ix > 0: v = minf(v, dist[i - 1] + O)
			if iz > 0:
				v = minf(v, dist[i - w] + O)
				if ix > 0: v = minf(v, dist[i - w - 1] + DG)
				if ix < w - 1: v = minf(v, dist[i - w + 1] + DG)
			dist[i] = v
	for iz in range(h - 1, -1, -1):
		for ix in range(w - 1, -1, -1):
			var i := iz * w + ix
			var v := dist[i]
			if ix < w - 1: v = minf(v, dist[i + 1] + O)
			if iz < h - 1:
				v = minf(v, dist[i + w] + O)
				if ix < w - 1: v = minf(v, dist[i + w + 1] + DG)
				if ix > 0: v = minf(v, dist[i + w - 1] + DG)
			dist[i] = v
	var bytes := PackedByteArray()
	bytes.resize(w * h * 2)
	for i in w * h:
		bytes[i * 2] = clampi(roundi(depth[i] / SHORE_DEPTH * 255.0), 0, 255)
		bytes[i * 2 + 1] = clampi(roundi(maxf(dist[i] - SHORE_CELL * 0.5, 0.0) / SHORE_DIST * 255.0), 0, 255)
	var img := Image.create_from_data(w, h, false, Image.FORMAT_RG8, bytes)
	var tex := ImageTexture.create_from_image(img)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/sea.gdshader")
	mat.set_shader_parameter("shore", tex)
	mat.set_shader_parameter("shore_rect", Vector4(rect.position.x, rect.position.y, rect.size.x, rect.size.y))
	mat.set_shader_parameter("shore_scale", Vector2(SHORE_DEPTH, SHORE_DIST))
	var west := INF
	for v in _coast:
		west = minf(west, v)
	var bb := track.bounds
	var sea_rect := Rect2(Vector2(west - 40.0, bb.position.y - 600.0), Vector2(bb.end.x + 700.0 - (west - 40.0), bb.size.y + 1200.0))
	var plane := PlaneMesh.new()
	plane.size = sea_rect.size
	plane.material = mat
	var mi := MeshInstance3D.new()
	mi.name = "Sea"
	mi.mesh = plane
	mi.position = Vector3(sea_rect.get_center().x, SEA_Y, sea_rect.get_center().y)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.add_to_group("track_shaded", true)
	track.add_child(mi)
	print("sea: %.0f x %.0f m plane, shore texture %d x %d (%.0f m texels)" % [sea_rect.size.x, sea_rect.size.y, w, h, SHORE_CELL])


# --- map overlay ------------------------------------------------------------------------

func _map_overlay() -> void:
	var g := _group("MapOverlay")
	var lift := Vector3(0, 30.0, 0)
	var top := Vector3(0, _hmax + 36.0, 0)
	var st := _st()
	_ribbon(st, pts, 4.0, Color("3b3a36"), lift)
	# The tunnel: the road through it dashed paler, so it reads as under.
	var bore := PackedVector3Array()
	for i in range(tun_i0, tun_i1 + 1):
		bore.append(pts[i])
	for k in range(0, bore.size() - 3, 6):
		_ribbon(st, bore.slice(k, k + 4), 2.2, Color("c9c2ae"), lift + Vector3(0, 0.3, 0))
	var bodies := [[_landmarks().get_node("Lighthouse"), "lighthouse", Color("f0ede4")], [_landmarks().get_node("Pier"), "pier", Color("a0784c")],
		[_landmarks().get_node("SeaTunnel"), "tunnel", Color("6d6a63")]]
	for b in bodies:
		var at: Vector3 = (b[0] as Node3D).global_transform.origin if (b[0] as Node3D).is_inside_tree() else (b[0] as Node3D).transform.origin
		if b[1] == "pier":
			at = (b[0] as Node3D).transform * Vector3(0, 0, -30.0)
		if b[1] == "tunnel":
			at = (pts[tun_i0] + pts[tun_i1]) * 0.5 + _right((tun_i0 + tun_i1) / 2) * 16.0
		at.y = top.y + 0.6
		for part in _big_icon(b[1]):
			for o in Geometry2D.offset_polygon(part, 2.6, Geometry2D.JOIN_MITER):
				_flat_poly(st, o, at - Vector3(0, 0.15, 0), Color("1a1a1a"))
		for part in _big_icon(b[1]):
			_flat_poly(st, part, at, b[2] if not (b[1] == "lighthouse" and part.size() == 4) else C_RED)
	_map_backdrop(g)
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


## The map is square and the stage is tall and thin: west of the ground
## there'd be bare background. A heath backdrop fills it, map only (the 3D
## view's fog ends well short of there): a 12 m grid in vertex colour, the
## map's own heath tones with darker clumps, indexed so it stays small.
func _map_backdrop(g: Node3D) -> void:
	var bb := track.bounds
	var side := maxf(bb.size.x, bb.size.y)
	var x0 := bb.get_center().x - side * 0.5 - 80.0
	var x1 := terrain.origin.x + TERRAIN_CELL * 2.0
	if x1 <= x0:
		return
	var z0 := bb.get_center().y - side * 0.5 - 80.0
	var z1 := bb.get_center().y + side * 0.5 + 80.0
	const C := 12.0
	var nx := int(ceil((x1 - x0) / C)) + 1
	var nz := int(ceil((z1 - z0) / C)) + 1
	var clumps := FastNoiseLite.new()
	clumps.seed = SEED + 101 # the forest's clump field, so it carries on
	clumps.frequency = 0.022
	var fine := FastNoiseLite.new()
	fine.seed = SEED + 5
	fine.frequency = 0.21
	var base := Color8(136, 150, 88)
	var light := Color8(158, 162, 102)
	var dark := Color8(92, 114, 70)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for iz in nz:
		for ix in nx:
			var x := minf(x0 + ix * C, x1)
			var z := z0 + iz * C
			var c := base.lerp(light, clampf(fine.get_noise_2d(x, z) * 0.9 + 0.3, 0.0, 1.0))
			c = c.lerp(dark, smoothstep(0.05, 0.35, clumps.get_noise_2d(x, z)) * 0.55)
			st.set_color(c)
			st.add_vertex(Vector3(x, _hmin - 1.0, z))
	for iz in nz - 1:
		for ix in nx - 1:
			var a := iz * nx + ix
			for k in [a, a + 1, a + nx, a + 1, a + nx + 1, a + nx]:
				st.add_index(k)
	var mi := _mesh_node("Backdrop", st.commit(), Transform3D.IDENTITY, RENDER_MAP_ONLY)
	mi.material_override = map_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	g.add_child(mi)


## Big-landmark icons (before ICON_SCALE): the lighthouse (tower and a red
## band), the pier (a T out into the water), the tunnel (a portal arch).
func _big_icon(kind: String) -> Array:
	match kind:
		"lighthouse":
			return [PackedVector2Array([Vector2(-6, 12), Vector2(6, 12), Vector2(3.5, -10), Vector2(-3.5, -10)]),
				PackedVector2Array([Vector2(-5, 2), Vector2(5, 2), Vector2(4.4, -2.5), Vector2(-4.4, -2.5)]),
				PackedVector2Array([Vector2(-5, -10), Vector2(5, -10), Vector2(0, -16)])]
		"pier":
			return [PackedVector2Array([Vector2(-12, -2), Vector2(12, -2), Vector2(12, 2), Vector2(-12, 2)]),
				PackedVector2Array([Vector2(8, -9), Vector2(12, -9), Vector2(12, 9), Vector2(8, 9)])]
		"tunnel":
			var out := PackedVector2Array([Vector2(-12, 10), Vector2(-12, -2)])
			for k in 9:
				var a := PI + PI * k / 8.0
				out.append(Vector2(cos(a) * 12.0, -2.0 + sin(a) * 10.0))
			out.append_array([Vector2(12, 10), Vector2(6, 10), Vector2(6, -1)])
			for k in 9:
				var a := TAU - PI * k / 8.0
				out.append(Vector2(cos(a) * 6.0, -1.0 + sin(a) * 5.0))
			out.append(Vector2(-6, 10))
			return [out]
	return []


## The callouts' map icons, on top of the base ones.
func _icon_shape(shape: String) -> Array:
	var rect := func(cx: float, cz: float, w: float, h: float, rot := 0.0) -> PackedVector2Array:
		var out := PackedVector2Array()
		for c in [Vector2(-w, -h), Vector2(w, -h), Vector2(w, h), Vector2(-w, h)]:
			out.append(Vector2(cx, cz) + (c * 0.5).rotated(rot))
		return out
	match shape:
		"pots": # a stack of three crates
			return [[rect.call(-6.0, 5.0, 10.0, 8.0), null], [rect.call(6.0, 5.0, 10.0, 8.0), null], [rect.call(0.0, -5.0, 10.0, 8.0), null]]
		"chapel": # a gable with a cross on top
			return [[PackedVector2Array([Vector2(-9, 10), Vector2(9, 10), Vector2(9, -2), Vector2(0, -9), Vector2(-9, -2)]), null],
				[rect.call(0.0, -13.0, 3.0, 9.0), null], [rect.call(0.0, -14.0, 8.0, 3.0), null]]
		"ship": # a hull and a mast
			return [[PackedVector2Array([Vector2(-13, 2), Vector2(13, 2), Vector2(9, 9), Vector2(-9, 9)]), null], [rect.call(0.0, -6.0, 3.0, 16.0), null]]
		"phone": # a tall box with a lit panel
			return [[rect.call(0.0, 0.0, 10.0, 20.0), null], [rect.call(0.0, -6.0, 6.0, 3.0), Color("f0ede4")]]
	return super._icon_shape(shape)
