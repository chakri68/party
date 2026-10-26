extends RefCounted
## Cliffhanger (tools/build_cliffhanger.gd): what's new on the fourth stage.
## The switchbacks over the sea, broken tarmac, the guard on the drop side
## and the gap you can still go over (and what happens then), the sea
## tunnel and what the top-down camera does in it, the water, the sea fog,
## the coast eggs, the export, and the autopilot driving it end to end, by
## hand and on pads. Run from run_tests.gd, with its helpers and its
## pass/fail count.

const Export := preload("res://tools/export_tracks.gd")
const Builder := preload("res://tools/build_cliffhanger.gd")

var t ## the runner (run_tests.gd), untyped: its helpers are its own


func _init(runner) -> void:
	t = runner


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func run() -> void:
	print("cliffhanger")
	await t._boot("cliffhanger")
	var main: Node3D = t.main
	var track: Track = t.track
	check(track.track_id == "cliffhanger" and track.get_biome().id == "coast" and track.difficulty == "hard", "track_id cliffhanger loads Cliffhanger: coast biome, hard")
	check(main.available_tracks().has("cliffhanger"), "and it's in the build")
	var big := track.get_landmarks().filter(func(l: Node) -> bool: return not l.has_meta("callout"))
	var labels := big.map(func(l: Node) -> String: return String(l.get_meta("label", "")))
	labels.sort()
	check(track.get_checkpoints().size() == 5 and labels == ["lighthouse", "pier", "sea tunnel"], "5 checkpoints, 3 big landmarks: %s" % [labels])
	var c := track.centerline
	var pins := Export.corners(c, Export.cumulative(c)).filter(func(k: Dictionary) -> bool: return String(k.text).begins_with("HAIRPIN"))
	check(pins.size() >= 5, "switchbacks: %d hairpins" % pins.size())
	check(main.weather.style == "fog", "the weather is sea fog")
	await _surfaces(track)
	_rails(track)
	_layby_pocket(track)
	await _over_the_edge(main, track)
	await _tunnel(main, track)
	_sea(track)
	_fog(main)
	await _eggs(main, track)
	await _sea_eggs_seen(main, track)
	_export(track)
	await t.test_autopilot_stage()
	await _pads(main, track)


func _at(track: Track, m: float, yaw := 0.0) -> Transform3D:
	var i := clampi(int(m / 2.0), 1, track.centerline.size() - 2)
	var p := track.centerline[i]
	var tan := (track.centerline[i + 1] - track.centerline[i - 1]).normalized().rotated(Vector3.UP, yaw)
	return Transform3D(Basis.looking_at(tan, Vector3.UP), p + Vector3(0, 0.6, 0))


## Gravel with broken tarmac: the probes say which, and tarmac holds better.
func _surfaces(track: Track) -> void:
	var car: CarController = t.car
	check(track.get_node("Road").get_meta("surface") == "road", "the stage is gravel")
	var tar: Array = track.get_children().filter(func(n: Node) -> bool: return n.is_in_group("track_road") and n.get_meta("surface", "") == "tarmac")
	check(tar.size() >= 5, "broken tarmac in %d stretches" % tar.size())
	var reads := {}
	for spot in [["tarmac", (float(tar[0].get_meta("from_m")) + float(tar[0].get_meta("to_m"))) * 0.5], ["road", 330.0]]:
		await t.place(_at(track, spot[1]))
		await t.idle(0.1)
		reads[spot[0]] = car.surface
	check(reads == {"tarmac": "tarmac", "road": "road"}, "the car reads tarmac on the tarmac, gravel elsewhere: %s" % [reads])
	var s: Dictionary = CarController.SURFACES
	check(s.tarmac.grip > s.road.grip and s.tarmac.loose < s.road.loose, "tarmac grips more and slides less than the gravel")
	car.neutralize()


## The guard on the drop side: solid, and where the sea is, it's there.
func _rails(track: Track) -> void:
	var rails: StaticBody3D = track.get_node("GuardRails")
	check(rails.is_in_group("track_obstacle") and rails.collision_layer == 1 and rails.get_child_count() >= 20, "guard rails and walls: one solid body, %d pieces" % rails.get_child_count())
	var space := track.get_world_3d().direct_space_state
	var c := track.centerline
	var hits := 0
	var tried := 0
	# Every 20 m: wherever the ground 20 m off the road is 6 m or more below
	# it (over the sea, off a switchback leg), the guard's there, except at
	# the three gaps (the pier, the lighthouse lane, the lay-by) and in the
	# tunnel.
	var gaps := [[Builder.PIER_AT, 8.0], [Builder.LIGHTHOUSE_AT, 7.0], [Builder.LAYBY_AT, 10.0]]
	var roof := track.get_node("Tunnel/Roof") as TunnelRoof
	for i in range(5, c.size() - 5, 10):
		var m := i * 2.0
		if gaps.any(func(g: Array) -> bool: return absf(m - float(g[0])) < float(g[1])) or roof.distance_to_bore(c[i]) < 2.0:
			continue
		var p := c[i] + Vector3(0, 0.4, 0)
		var tan := (c[i + 1] - c[i - 1]).normalized()
		var right := Vector3(-tan.z, 0, tan.x)
		for side: float in [-1.0, 1.0]:
			var q := p + right * side * 20.0
			if p.y - track.height_at(q.x, q.z) < 7.0:
				continue
			tried += 1
			var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(p, p + right * side * 8.0, 1))
			# (The hairpins are wider: up to ~7 m to the edge at the apex.)
			if hit and hit.collider == rails and p.distance_to(hit.position) < 7.5:
				hits += 1
			else:
				print("    no guard at %.0f m, side %+.0f: %s" % [m, side, hit])
	check(tried > 60, "the drops are most of the stage (%d checks)" % tried)
	check(hits == tried, "from mid-road, a guard on every drop side (%d/%d)" % [hits, tried])
	# The lay-by: no wall across the gap.
	var lay := _at(track, Builder.LAYBY_AT)
	var right := lay.basis.x
	var lp := lay.origin + Vector3(0, -0.2, 0)
	var through := space.intersect_ray(PhysicsRayQueryParameters3D.create(lp, lp + right * 12.0, 1))
	check(not through or through.collider != rails, "the lay-by is a gap in the wall: %s" % [through])


## Behind the lay-by gap is a pocket: the return walls close it off from
## the strip of heath behind the guard, so a car that goes in either goes
## over or comes back out the way it went in. Flood fill on foot from the
## pocket over drivable ground (a 1.5 m grid, no step over 1.2 m, nothing
## solid in the way at bumper height), stopping at the road and the drop.
func _layby_pocket(track: Track) -> void:
	var r := pocket_flood(track, Builder.LAYBY_AT)
	check(r.road and r.drop and r.along < 20.0 and r.cells < 1000,
		"the lay-by is a pocket: back to the road or over the edge, nowhere else (%d cells, %.0f m along at most)" % [r.cells, r.along])


static func pocket_flood(track: Track, at_m: float) -> Dictionary:
	const CELL := 1.5
	var c := track.centerline
	var i := int(at_m / 2.0)
	var tan := (c[i + 1] - c[i - 1]).normalized()
	var right := Vector3(-tan.z, 0, tan.x)
	var space := track.get_world_3d().direct_space_state
	var start := c[i] + right * 6.0
	var seen := {Vector2i.ZERO: true}
	var queue: Array[Vector2i] = [Vector2i.ZERO]
	var head := 0
	var out := {"cells": 0, "along": 0.0, "drop": false, "road": false}
	var q := PhysicsRayQueryParameters3D.new()
	q.collision_mask = 1
	q.exclude = [(track.get_node("Ground") as CollisionObject3D).get_rid()]
	while head < queue.size() and queue.size() < 20000:
		var k := queue[head]
		head += 1
		var p := start + Vector3(k.x * CELL, 0, k.y * CELL)
		p.y = track.height_at(p.x, p.z)
		out.cells += 1
		out.along = maxf(out.along, absf((p - c[i]).dot(tan)))
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var nk: Vector2i = k + d
			if seen.has(nk):
				continue
			var np := start + Vector3(nk.x * CELL, 0, nk.y * CELL)
			np.y = track.height_at(np.x, np.z)
			var on := space.intersect_ray(PhysicsRayQueryParameters3D.create(np + Vector3(0, 3.0, 0), np - Vector3(0, 3.0, 0), 8))
			if not on.is_empty() and (on.collider as Node).is_in_group("track_road"):
				out.road = true
				continue
			if np.y < c[i].y - 6.0 or np.y < track.fall_y:
				out.drop = true
				continue
			if absf(np.y - p.y) > 1.2:
				continue
			q.from = p + Vector3(0, 0.5, 0)
			q.to = np + Vector3(0, 0.5, 0)
			if not space.intersect_ray(q).is_empty():
				continue
			seen[nk] = true
			queue.append(nk)
	return out


## Through the lay-by gap and over the cliff, in a room: the car parks and
## asks the server (no teleport of its own), and the server's reset puts it
## back on the road.
func _over_the_edge(main: Node3D, track: Track) -> void:
	var car: CarController = t.car
	var asked: Array = []
	var listen := func(ev: Dictionary) -> void: asked.append(ev)
	main.bridge.physics_event.connect(listen)
	main._on_session({"room": true}, "")
	main._on_race_event({"kind": "go"})
	var r0: int = main.recoveries
	# Square to the edge, through the middle of the gap.
	await t.place(_at(track, Builder.LAYBY_AT, -PI * 0.5))
	var y0 := car.global_position.y
	var low := INF
	for f in 60 * 6:
		car.set_control(0.0, 1.0, 0.0)
		await t.physics_frame
		low = minf(low, car.global_position.y)
		if not asked.filter(func(e: Dictionary) -> bool: return e.kind == "fell").is_empty():
			break
	var fell := asked.filter(func(e: Dictionary) -> bool: return e.kind == "fell")
	check(fell.size() == 1 and low < y0 - 6.0, "off the cliff through the gap: down %.0f m, and it asks the server (%d)" % [y0 - low, fell.size()])
	check(main.recoveries == r0 and not car.is_physics_processing(), "parked meanwhile: no teleport of its own")
	main._on_race_event({"kind": "reset", "checkpoint": 2, "holdMs": 0})
	await t.idle(0.3)
	check(car.global_position.distance_to(track.recovery_for(2).global_position) < 1.0 and car.is_physics_processing(), "the server's reset puts it back on the road")
	main.bridge.physics_event.disconnect(listen)
	t._probe_session()
	main._on_race_event({"kind": "reset", "checkpoint": 0, "holdMs": 0})
	main.checkpoints_passed = 0


## The sea tunnel: dark, lamps, light at the end, and the top-down camera
## sees through the rock while the car's in it. Chase and bonnet don't
## (they're in there with it), and the chase camera stays under the roof.
func _tunnel(main: Node3D, track: Track) -> void:
	var car: CarController = t.car
	var roof := track.get_node_or_null("Tunnel/Roof") as TunnelRoof
	check(roof != null and roof.line.size() > 20 and roof.is_in_group("track_shaded"), "the tunnel has a roof that knows its bore (%d points)" % (roof.line.size() if roof else 0))
	var bore: Node = track.get_node_or_null("Tunnel/Bore")
	check(bore != null and bore.find_children("*", "CollisionShape3D", true, false).size() >= 1, "and a solid bore")
	var mid := roof.line[roof.line.size() / 2]
	var i := 0
	var best := INF
	for k in track.centerline.size():
		var d := track.centerline[k].distance_to(mid)
		if d < best:
			best = d
			i = k
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	await t.place(_at(track, i * 2.0))
	await t.idle(0.6)
	check(roof.cut > 0.99, "top-down, car in the bore: the roof dissolves (%.2f)" % roof.cut)
	var m := roof.mesh.surface_get_material(0) as ShaderMaterial
	check(absf(float(m.get_shader_parameter("cut")) - TunnelRoof.CUT_MAX) < 0.01, "to its stipple, not all the way (%.2f)" % float(m.get_shader_parameter("cut")))
	await t.place(_at(track, i * 2.0 - 120.0))
	await t.idle(0.6)
	check(roof.cut < 0.01, "and back whole once the car's 120 m back down the road (%.2f)" % roof.cut)
	main.set_camera_mode(FollowCamera.Mode.CHASE)
	await t.place(_at(track, i * 2.0))
	await t.drive(1.5, 0.0, 0.4)
	var cam: Camera3D = main.cam
	var road_y := track.height_at(cam.global_position.x, cam.global_position.z)
	check(roof.cut < 0.01, "chase in the bore: the roof stays (%.2f)" % roof.cut)
	check(cam.global_position.y < road_y + Builder.TUN_H - 0.3 and roof.distance_to_bore(cam.global_position) < Builder.TUN_H,
		"and the chase camera stays under it (%.1f m over the road, %.1f m off the line)" % [cam.global_position.y - road_y, roof.distance_to_bore(cam.global_position)])
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	car.neutralize()
	await t.place(track.get_spawn().global_transform)


## The water: one plane, its own shader, weathered like the rest.
func _sea(track: Track) -> void:
	var sea := track.get_node_or_null("Sea") as MeshInstance3D
	check(sea != null and sea.is_in_group("track_shaded") and (sea.mesh as PrimitiveMesh).get_mesh_arrays()[Mesh.ARRAY_VERTEX].size() <= 6, "the sea is one flat plane")
	var mat := sea.mesh.surface_get_material(0) as ShaderMaterial if sea else null
	check(mat != null and mat.shader.resource_path.ends_with("sea.gdshader") and track.world_materials().has(mat), "on the sea shader, registered for weather")
	var lowest := INF
	for q in track.centerline:
		lowest = minf(lowest, q.y)
	check(track.fall_y > 0.0 and track.fall_y < lowest - 1.5, "down at the waterline is out (fall_y %.1f m; the lowest road is %.1f m)" % [track.fall_y, lowest])


## Sea fog from the seed, rolling in off the water.
func _fog(main: Node3D) -> void:
	var w: Weather = main.weather
	w.configure(31, 0.7)
	var a: Array = t._bank_snapshot(w)
	var wind_a: Vector2 = w._wind
	w.configure(31, 0.7)
	check(a.size() > 10 and t._bank_snapshot(w) == a and w._wind == wind_a, "fog banks are the seed's: %d, twice the same" % a.size())
	var onshore := true
	for sd in [1, 2, 3, 77, 4242]:
		w.configure(sd, 0.7)
		onshore = onshore and w._wind.x < -0.5 * w._wind.length()
	check(onshore, "and always drifting onshore (west, off the sea)")
	w.configure(4242, 0.4)


func _eggs(main: Node3D, track: Track) -> void:
	var eggs: EasterEggs = main.eggs
	var map: MapController = t.map
	var counts := eggs.spot_counts()
	check(counts.gulls == 3 and counts.whale == 2 and counts.boat == 2 and counts.seal == 2 and counts.serpent == 1 and counts.deer == 0 and counts.snowman == 0,
		"coast egg spots: %s" % [counts])
	map.gps_enabled = false
	for f in 4:
		await t.process_frame
	var s0 = t._map_state()
	eggs.force = {"all": true}
	eggs.configure(9)
	var kinds := {}
	var layers_ok := true
	for r in eggs._live:
		eggs._set_shown(r, true)
		kinds[r.e.kind] = true
		for nd in r.nodes:
			for v in [nd] + (nd as Node).find_children("*", "VisualInstance3D", true, false):
				if v is VisualInstance3D:
					layers_ok = layers_ok and (v as VisualInstance3D).layers == EasterEggs.LAYER
	for f in 30:
		await t.process_frame
	check(kinds.size() == 5, "every coast kind comes alive when forced: %s" % [kinds.keys()])
	check(layers_ok, "every egg node is on layer 5 only")
	check(t._map_state() == s0 and map.render_count == 1, "map unchanged with every coast egg out")
	# The gulls sit on the guard until the car comes by, then they're off.
	var car: CarController = t.car
	var g: Dictionary = eggs.live("gulls")[1]
	var spot: Node3D = g.spot
	var rails: StaticBody3D = track.get_node("GuardRails")
	var space := track.get_world_3d().direct_space_state
	var gp: Vector3 = (g.gulls[0].node as Node3D).global_position
	var out := spot.global_basis.x * float(spot.get_meta("side", 1.0)) # away from the road
	var guard := space.intersect_ray(PhysicsRayQueryParameters3D.create(gp - out * 2.0 + Vector3(0, -0.3, 0), gp + out * 1.0 + Vector3(0, -0.3, 0), 1))
	check(g.state == "wait" and guard and guard.collider == rails and Vector2(guard.position.x - gp.x, guard.position.z - gp.z).length() < 0.6 and gp.y - track.height_at(gp.x, gp.z) > 0.8,
		"gulls perched on the guard, at its top")
	car.global_position = spot.global_position + Vector3(0, 0.0, 0)
	eggs._tick_gulls(g, 0.016)
	eggs.time += 2.0
	eggs._tick_gulls(g, 0.016)
	var up := (g.gulls[0].node as Node3D).global_position.y - gp.y
	check(g.state == "fly" and up > 1.5, "and lift off when the car comes by (%.1f m up after 2 s)" % up)
	# The boat works its stretch of coast and stays in the water.
	var dry := 0
	for b in eggs.live("boat"):
		var bs: Node3D = b.spot
		var fwd := -bs.global_basis.z
		var reach := float(bs.get_meta("range", EasterEggs.BOAT_RANGE))
		for k in range(-10, 11):
			var q := bs.global_position + fwd * reach * k / 10.0
			if track.height_at(q.x, q.z) > -1.0:
				dry += 1
				print("    boat path aground at %s (ground %.1f m)" % [q, track.height_at(q.x, q.z)])
	check(dry == 0, "the boats' runs are all water")
	# Whales breach on the clock: under between breaches.
	var w: Dictionary = eggs.live("whale")[0]
	var period := float(w.e.pace)
	eggs.time = period * 4.0 - float(w.e.skew) * period + EasterEggs.BREACH_TIME * 0.5
	eggs._tick_whale(w, 0.016)
	var top := (w.nodes[0] as Node3D).global_position.y
	eggs.time += EasterEggs.BREACH_TIME * 1.5
	eggs._tick_whale(w, 0.016)
	check(top > 3.0 and not (w.nodes[0] as Node3D).visible, "a whale breaches (%.1f m up mid-leap) and is gone between" % top)
	car.velocity = Vector3.ZERO
	var a := EasterEggs.make_schedule(1234, counts)
	check(a == EasterEggs.make_schedule(1234, counts) and a != EasterEggs.make_schedule(1235, counts), "same seed, same coast surprises")
	var serpents := 0
	var variants := {}
	for sd in 400:
		for e in EasterEggs.make_schedule(sd, counts).filter(func(x: Dictionary) -> bool: return x.kind == "serpent"):
			variants[e.variant] = true
			if e.live:
				serpents += 1
	check(serpents > 5 and serpents < 45 and variants.size() == 2, "something in the water is rare: %d runs in 400, as %s" % [serpents, variants.keys()])
	eggs.force = {}
	eggs.configure(4242)
	await t.place(track.get_spawn().global_transform)


## Every sea egg is somewhere the player can actually see: from the road in
## the chase view at least a few times (in the frustum, under 100 m, nothing
## solid in between), and never under the minimap in the top-down frame (at
## rest or at speed, on a 16:9 screen and a wide phone's 1558 x 720), and
## far enough from the start line to switch on.
func _sea_eggs_seen(main: Node3D, track: Track) -> void:
	var car: CarController = t.car
	var cam: FollowCamera = main.cam
	var space := track.get_world_3d().direct_space_state
	var c := track.centerline
	var spawn := track.get_spawn().global_position
	var size0: Vector2i = t.root.size
	var mode0 = cam.mode
	var bad := []
	var seen := {}
	for res in [Vector2i(1280, 720), Vector2i(1558, 720)]:
		t.root.size = res
		for f in 3:
			await t.process_frame
		var vp: Vector2 = t.root.get_visible_rect().size
		var maprect: Rect2 = (t.map as Control).get_global_rect().grow(12.0)
		for m in track.get_tree().get_nodes_in_group("track_egg"):
			var kind := String(m.get_meta("kind"))
			if kind == "gulls":
				continue
			var p: Vector3 = m.global_position
			var aim := p + Vector3(0, 0.5 if kind == "seal" else 1.5, 0)
			if Vector2(p.x - spawn.x, p.z - spawn.z).length() < EasterEggs.SHOW_R + 5.0:
				bad.append("%s too near the start" % m.name)
			var n_seen := 0
			for i in range(2, c.size() - 2):
				if Vector2(c[i].x - p.x, c[i].z - p.z).length() > 110.0:
					continue
				var tn := (c[i + 1] - c[i - 1]).normalized()
				car.reset_to(Transform3D(Basis.looking_at(tn, Vector3.UP), c[i] + Vector3(0, 0.6, 0)))
				cam.set_mode(FollowCamera.Mode.CHASE)
				cam.snap()
				if cam.is_position_in_frustum(aim) and cam.global_position.distance_to(aim) < 100.0 \
						and space.intersect_ray(PhysicsRayQueryParameters3D.create(cam.global_position, aim, 1)).is_empty():
					n_seen += 1
				cam.set_mode(FollowCamera.Mode.TOP_DOWN)
				for fast in [false, true]:
					cam.snap()
					if fast:
						cam.size = cam.base_view() * 1.25
						cam._focus = car.global_position + tn * cam.size * cam.max_lead
						cam._place()
					if cam.is_position_in_frustum(p) and maprect.has_point(cam.unproject_position(p)):
						bad.append("%s under the map at %d m (%s)" % [m.name, i * 2, res])
			seen[m.name] = mini(int(seen.get(m.name, 1000)), n_seen)
	t.root.size = size0
	cam.set_mode(mode0)
	car.velocity = Vector3.ZERO
	var unseen: Array = seen.keys().filter(func(k: String) -> bool: return int(seen[k]) < 3)
	check(seen.size() == 7 and unseen.is_empty(), "every sea egg is in the chase view from the road (road samples: %s)" % [seen])
	check(bad.is_empty(), "none under the minimap, none too near the start: %s" % [bad.slice(0, 4)])
	await t.place(track.get_spawn().global_transform)


func _export(track: Track) -> void:
	var raw := FileAccess.get_file_as_string(ProjectSettings.globalize_path("res://../data/tracks.json").simplify_path())
	var file: Dictionary = JSON.parse_string(raw)
	var mine: Array = file.tracks.filter(func(x: Dictionary) -> bool: return x.id == "cliffhanger")
	check(mine.size() == 1 and JSON.parse_string(Export._fmt(Export.export_track(track), "")) == mine[0], "data/tracks.json has Cliffhanger, current")


## On pads: on/off steering, throttle and brake, 0.12 s late, through the
## switchback stack and up onto the cliffs. No reset.
func _pads(main: Node3D, track: Track) -> void:
	print("cliffhanger on pads")
	var car: CarController = t.car
	await t.place(track.get_spawn().global_transform)
	main.checkpoints_passed = 0
	main.finished = false
	main.recoveries = 0
	main.set_autopilot(true)
	main.autopilot.pads = true
	var s := 0.0
	var trip0 := car.distance_travelled
	while s < 75.0 and main.autopilot._i * 2 < 1000:
		await t.physics_frame
		s += 1.0 / 60.0
	var at: int = main.autopilot._i * 2
	main.autopilot.pads = false
	main.set_autopilot(false)
	check(at >= 1000 and main.recoveries == 0, "on pads: the switchbacks and onto the cliff top (%d m in %.0f s, %.0f m driven), no reset" % [at, s, car.distance_travelled - trip0])
	main.finished = false
	main.checkpoints_passed = 0
	await t.place(track.get_spawn().global_transform)
