extends RefCounted
## Snowblind (tools/build_snowblind.gd): what's new on the third stage. The
## climb and the hairpins, the snow / ice / grit surfaces and how differently
## they hold, the snowbanks, the snowfall, the snow eggs, the export, and the
## autopilot driving it end to end. Run from run_tests.gd, with its helpers
## and its pass/fail count.

const Export := preload("res://tools/export_tracks.gd")

var t ## the runner (run_tests.gd), untyped: its helpers are its own


func _init(runner) -> void:
	t = runner


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func run() -> void:
	print("snowblind")
	await t._boot("snowblind")
	var main: Node3D = t.main
	var track: Track = t.track
	check(track.track_id == "snowblind" and track.get_biome().id == "snow" and track.difficulty == "hard", "track_id snowblind loads Snowblind: snow biome, hard")
	check(main.available_tracks().has("snowblind"), "and it's in the build")
	check(track.get_checkpoints().size() == 5 and track.get_landmarks().filter(func(l: Node) -> bool: return not l.has_meta("callout")).size() == 3,
		"5 checkpoints, 3 big landmarks (chalet, ski lift, frozen pond)")
	var c := track.centerline
	check(c[c.size() - 1].y - c[0].y > 80.0, "it climbs: %.0f m from start to finish" % (c[c.size() - 1].y - c[0].y))
	var pins := Export.corners(c, Export.cumulative(c)).filter(func(k: Dictionary) -> bool: return String(k.text).begins_with("HAIRPIN"))
	check(pins.size() >= 6, "switchbacks: %d hairpins" % pins.size())
	check(main.weather.style == "snow", "the weather is snow")
	await _surfaces(track)
	_banks(track)
	await _snowfall(main)
	await _eggs(main)
	_export(track)
	await t.test_autopilot_stage()


## The probes say what the car's on, and the three hold differently.
func _surfaces(track: Track) -> void:
	var car: CarController = t.car
	var road: Node = track.get_node("Road")
	check(road.get_meta("surface") == "snow", "the stage is packed snow")
	var ice: Array = track.get_children().filter(func(n: Node) -> bool: return n.is_in_group("track_road") and n.get_meta("surface", "") == "ice" and n.has_meta("from_m"))
	var grit: Array = track.get_children().filter(func(n: Node) -> bool: return n.is_in_group("track_road") and String(n.name).begins_with("Grit"))
	check(ice.size() >= 5 and grit.size() >= 6, "ice patches (%d) on the fast bits, grit (%d) through the hairpins" % [ice.size(), grit.size()])
	var at := func(m: float) -> Transform3D:
		var i := clampi(int(m / 2.0), 1, track.centerline.size() - 2)
		var p := track.centerline[i]
		return Transform3D(Basis.looking_at(track.centerline[i + 1] - track.centerline[i - 1], Vector3.UP), p + Vector3(0, 0.6, 0))
	var reads := {}
	for spot in [["ice", (float(ice[0].get_meta("from_m")) + float(ice[0].get_meta("to_m"))) * 0.5],
			["road", (float(grit[0].get_meta("from_m")) + float(grit[0].get_meta("to_m"))) * 0.5], ["snow", 380.0]]:
		await t.place(at.call(spot[1]))
		await t.idle(0.1)
		reads[spot[0]] = car.surface
	check(reads == {"ice": "ice", "road": "road", "snow": "snow"}, "the car reads ice on ice, road on the grit, snow on the rest: %s" % [reads])
	var s: Dictionary = CarController.SURFACES
	check(s.ice.grip < s.snow.grip and s.snow.grip < s.road.grip and s.ice.traction < s.snow.traction, "ice grips least, then snow, then gravel")
	# The same sideways shove on each (a tail stepping out at 20 m/s): ice
	# takes far longer to stop the slide.
	var left := {}
	for surf in ["snow", "ice"]:
		var m: float = 380.0 if surf == "snow" else (float(ice[2].get_meta("from_m")) + 2.0)
		await t.place(at.call(m))
		var fwd := -car.global_basis.z
		car.velocity = fwd * 20.0 + Vector3(-fwd.z, 0, fwd.x) * 6.0
		for f in 15:
			car.set_control(0.0, 0.3, 0.0)
			await t.physics_frame
		left[surf] = absf(car.lateral_speed)
	check(left.ice > left.snow * 1.5, "a slide holds on ice: %.1f m/s sideways left after 0.25 s, %.1f on snow" % [left.ice, left.snow])
	car.neutralize()


## Banks both sides, solid, low; gaps where a yard is.
func _banks(track: Track) -> void:
	var banks: StaticBody3D = track.get_node("Snowbanks")
	check(banks.is_in_group("track_obstacle") and banks.collision_layer == 1 and banks.get_child_count() >= 10, "snowbanks: one solid body, %d pieces" % banks.get_child_count())
	var space := track.get_world_3d().direct_space_state
	var hits := 0
	var tried := 0
	for m in [380.0, 600.0, 1050.0, 1300.0, 1950.0]:
		var i := int(m / 2.0)
		var p := track.centerline[i] + Vector3(0, 0.3, 0)
		var tan := (track.centerline[i + 1] - track.centerline[i - 1]).normalized()
		var right := Vector3(-tan.z, 0, tan.x)
		for side: float in [-1.0, 1.0]:
			tried += 1
			var q := PhysicsRayQueryParameters3D.create(p, p + right * side * 9.0, 1)
			var hit := space.intersect_ray(q)
			if hit and hit.collider == banks and p.distance_to(hit.position) < 6.5:
				hits += 1
			else:
				print("    no bank at %.0f m, side %+.0f: %s" % [m, side, hit])
	check(hits == tried, "from mid-road, a bank within 6.5 m either side (%d/%d)" % [hits, tried])


## Light snowfall from the seed, only on the 3D side.
func _snowfall(main: Node3D) -> void:
	var w: Weather = main.weather
	w.configure(31, 0.6)
	var a := w.snowfall
	w.configure(31, 0.6)
	check(a > 0.0 and w.snowfall == a, "snowfall is the seed's: %.2f twice" % a)
	w.configure(32, 0.6)
	var b := w.snowfall
	w.configure(31, 0.0)
	check(w.snowfall == 0.0, "no cloud, no snow (another seed: %.2f)" % b)
	var flakes := w.find_children("*", "MultiMeshInstance3D", true, false).filter(func(n: Node) -> bool: return (n as MultiMeshInstance3D).multimesh.instance_count >= Weather.MAX_FLAKES)
	check(flakes.size() == 1 and (flakes[0] as VisualInstance3D).layers == 8, "one MultiMesh of flakes, weather layer only (never the map)")
	w.configure(4242, 0.4)


func _eggs(main: Node3D) -> void:
	var eggs: EasterEggs = main.eggs
	var map: MapController = t.map
	var counts := eggs.spot_counts()
	check(counts.snowman == 3 and counts.skier == 2 and counts.elk == 2 and counts.snowmobile == 2 and counts.yeti == 1 and counts.deer == 0 and counts.tumbleweed == 0,
		"snow egg spots: %s" % [counts])
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
	check(kinds.size() == 5, "every snow kind comes alive when forced: %s" % [kinds.keys()])
	check(layers_ok, "every egg node is on layer 5 only")
	check(t._map_state() == s0 and map.render_count == 1, "map unchanged with every snow egg out")
	# Pass a snowman fast and its head comes off; nothing else moves it.
	var r: Dictionary = eggs.live("snowman")[0]
	var head: Node3D = r.head
	var y0 := head.position.y
	var car: CarController = t.car
	var sm: Node3D = r.nodes[0]
	car.global_position = sm.global_position + Vector3(4.0, 0.6, 0.0)
	car.velocity = Vector3(0, 0, 20.0)
	eggs._tick_snowman(r, 0.016)
	eggs.time += 1.0
	eggs._tick_snowman(r, 0.016)
	check(r.state == "fallen" and head.position.y < y0 - 0.8, "a fast pass knocks the snowman's head off (%.2f -> %.2f m)" % [y0, head.position.y])
	car.velocity = Vector3.ZERO
	var a := EasterEggs.make_schedule(1234, counts)
	check(a == EasterEggs.make_schedule(1234, counts) and a != EasterEggs.make_schedule(1235, counts), "same seed, same snow surprises")
	var yetis := 0
	for sd in 400:
		yetis += EasterEggs.make_schedule(sd, counts).filter(func(e: Dictionary) -> bool: return e.kind == "yeti" and e.live).size()
	check(yetis > 5 and yetis < 45, "the yeti is rare: %d runs in 400" % yetis)
	eggs.force = {}
	eggs.configure(4242)
	await t.place(t.track.get_spawn().global_transform)


func _export(track: Track) -> void:
	var raw := FileAccess.get_file_as_string(ProjectSettings.globalize_path("res://../data/tracks.json").simplify_path())
	var file: Dictionary = JSON.parse_string(raw)
	var mine: Array = file.tracks.filter(func(x: Dictionary) -> bool: return x.id == "snowblind")
	check(mine.size() == 1 and JSON.parse_string(Export._fmt(Export.export_track(track), "")) == mine[0], "data/tracks.json has Snowblind, current")
	var notes: Array = mine[0].paceNotes if mine.size() == 1 else []
	check(notes.filter(func(nn: Dictionary) -> bool: return nn.text == "ICE").size() >= 5, "ICE called at every patch")
	check(notes.filter(func(nn: Dictionary) -> bool: return nn.text == "ski lift").size() == 1, "the lift is called where the road goes under it")
