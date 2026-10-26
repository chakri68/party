extends SceneTree
## Headless smoke tests for the spike. Loads the real main scene and drives
## the car through set_control(), the same entry point the web bridge uses.
## Run: godot --headless --path . --fixed-fps 60 --script res://tests/run_tests.gd
## Exit code 0 = all passed.

var main: Node3D
var car: CarController
var track: Track
var map: MapController
var failures := 0
var passes := 0
var impacts: Array[float] = []


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	await process_frame
	car = main.car
	track = main.track
	map = main.map
	car.keyboard_enabled = false
	car.impact.connect(func(s: float, _w: Object) -> void: impacts.append(s))

	await test_track_interface()
	await test_drive_forward()
	await test_steer()
	await test_brake_and_reverse()
	await test_control_timeout()
	await test_offroad_slower()
	await test_collision()
	await test_checkpoint_order()
	await test_map_static()
	test_bridge_noop()
	test_terrain()
	await test_crest()
	await test_autopilot_stage()
	test_weather()
	test_camera_fit()
	await test_camera_modes()
	await test_cloud_shadow()
	await test_eye_mist()
	test_allowed_cameras()
	await test_eye_forest()
	await test_map_static_after_modes()
	test_scenery_callouts()
	test_egg_schedule()
	await test_eggs_no_collision()
	await test_deer_cross_and_spook()
	await test_campers()
	await test_eggs_off_the_map()
	await test_tower_far_silhouette()
	# M1 close: the room's rules (server-owned recovery), the track file,
	# assists, ghosts, livery, HUD. Each restores the probe defaults after.
	await test_server_reset()
	await test_reload_mid_race()
	await test_no_local_teleports()
	test_track_export()
	test_landmarks_exported()
	await test_trip_meter_and_marker()
	await test_map_only()
	await test_ghosts()
	await test_ghosts_no_collision()
	test_team_paint()
	await test_room_hud()
	await test_big_map_inputs()
	await test_big_map_modes()
	await test_big_map_static()
	await test_big_map_map_only()
	await preload("res://tests/pin_tests.gd").new(self).run()
	# Second stage: everything above was Pine Panic. Swap the main scene for
	# one that loads Dust Devil and check what's new there.
	await test_track_by_id()
	await test_dust_devil()
	# Third stage: Snowblind.
	await preload("res://tests/snowblind_tests.gd").new(self).run()
	# Fourth stage: Cliffhanger.
	await preload("res://tests/cliffhanger_tests.gd").new(self).run()

	print("\n%d passed, %d failed" % [passes, failures])
	quit(1 if failures else 0)


# --- helpers -------------------------------------------------------------------

func check(ok: bool, what: String) -> void:
	if ok:
		passes += 1
		print("  ok   ", what)
	else:
		failures += 1
		print("  FAIL ", what)


## Simulate `seconds` of physics, feeding control at `hz` like a remote Driver.
func drive(seconds: float, steer := 0.0, throttle := 0.0, brake := 0.0, hz := 30.0) -> void:
	var frames := int(seconds * 60.0)
	var every := maxi(1, int(60.0 / hz))
	for f in frames:
		if f % every == 0:
			car.set_control(steer, throttle, brake)
		await physics_frame


func idle(seconds: float) -> void:
	for f in int(seconds * 60.0):
		await physics_frame


func place(xf: Transform3D) -> void:
	car.reset_to(xf)
	car.neutralize()
	await physics_frame
	await physics_frame


func fwd() -> Vector3:
	return -car.global_basis.z


# --- tests ----------------------------------------------------------------------

func test_track_interface() -> void:
	print("track interface")
	check(track.get_spawn() != null, "one spawn marker")
	check(track.get_finish() != null, "finish area")
	var cps := track.get_checkpoints()
	check(cps.size() >= 3, "ordered checkpoints (%d)" % cps.size())
	var ordered := true
	for i in cps.size():
		ordered = ordered and int(cps[i].get_meta("index")) == i + 1
	check(ordered, "checkpoint indices are 1..n")
	check(track.get_recovery_anchors().size() == cps.size() + 1, "recovery anchor per checkpoint plus start")
	var big := track.get_landmarks().filter(func(l: Node) -> bool: return not l.get_meta("callout", false))
	check(big.size() == 3, "three big landmarks (bridge, cabin, sawmill)")
	# Forest chunks are one node with hundreds of colliders each; count both.
	var nodes := get_nodes_in_group("track_obstacle")
	var colliders := 0
	for o in nodes:
		colliders += (o as Scatter).collider_total if o is Scatter else 1
	check(nodes.size() > 50 and colliders > 5000, "obstacles (%d nodes, %d colliders)" % [nodes.size(), colliders])
	check(track.centerline.size() > 100 and track.length_m > 2000.0, "centreline and length (%.0f m)" % track.length_m)
	check(track.recovery_for(2).get_meta("after_checkpoint") == 2, "recovery_for picks last passed CP")


func test_drive_forward() -> void:
	print("drive forward")
	await place(track.get_spawn().global_transform)
	var start := car.global_position
	var dir := fwd()
	check(car.surface == "road", "spawn sits on road (surface=%s)" % car.surface)
	await drive(2.0, 0.0, 1.0)
	var moved := (car.global_position - start).dot(dir)
	print("    moved %.1f m forward, speed %.1f m/s" % [moved, car.forward_speed])
	check(moved > 15.0, "moves forward under throttle")
	check(car.forward_speed > 15.0 and car.forward_speed <= car.max_speed + 0.01, "speed in range")
	check(car.global_position.y > -0.2 and car.global_position.y < 0.3, "stays on the ground (y %.2f)" % car.global_position.y)
	var v0 := car.forward_speed
	await idle(1.5)
	check(car.forward_speed < v0 * 0.9, "coasting slows down (%.1f -> %.1f)" % [v0, car.forward_speed])


func test_steer() -> void:
	print("steer")
	await place(track.get_spawn().global_transform)
	await drive(1.0, 0.0, 1.0)
	var yaw0 := car.global_rotation.y
	await drive(0.8, 1.0, 0.6)
	var turned := angle_difference(yaw0, car.global_rotation.y)
	print("    yaw change %.1f deg" % rad_to_deg(turned))
	check(turned < -deg_to_rad(30), "steer +1 turns right (clockwise from above)")
	# Steering at standstill does nothing.
	await place(track.get_spawn().global_transform)
	var y1 := car.global_rotation.y
	await drive(0.5, -1.0, 0.0)
	check(absf(angle_difference(y1, car.global_rotation.y)) < 0.01, "no turning in place")


func test_brake_and_reverse() -> void:
	print("brake / reverse")
	await place(track.get_spawn().global_transform)
	await drive(1.5, 0.0, 1.0)
	var v := car.forward_speed
	await drive(0.6, 0.0, 0.0, 1.0)
	check(car.forward_speed < v - 10.0, "brakes hard (%.1f -> %.1f)" % [v, car.forward_speed])
	await drive(2.5, 0.0, 0.0, 1.0)
	check(car.forward_speed < -3.0 and car.forward_speed >= -car.max_reverse - 0.01, "reverses, capped (%.1f)" % car.forward_speed)


func test_control_timeout() -> void:
	print("control timeout")
	await place(track.get_spawn().global_transform)
	car.set_control(0.5, 1.0, 0.0)
	await idle(0.2)
	check(car.throttle_input == 1.0 and car.steer_input == 0.5, "control held within 300 ms")
	await idle(0.2)
	check(car.throttle_input == 0.0 and car.steer_input == 0.0, "neutral after ~300 ms of silence")
	var v := car.forward_speed
	await idle(0.5)
	check(car.forward_speed <= v, "and the car stops accelerating")
	car.set_control(9.0, 9.0, -9.0)
	await physics_frame
	check(car.steer_input == 1.0 and car.throttle_input == 1.0 and car.brake_input == 0.0, "inputs clamped")
	car.neutralize()


## Find a stretch of grass with 60 m clear ahead: no obstacles, no road.
func _clear_offroad_xf() -> Variant:
	var space := car.get_world_3d().direct_space_state
	var b := track.bounds
	for gx in range(int(b.position.x) + 20, int(b.end.x) - 20, 6):
		for gz in range(int(b.position.y) + 20, int(b.end.y) - 20, 6):
			for yaw in [0.0, PI * 0.5, PI, -PI * 0.5]:
				var xf := Transform3D(Basis(Vector3.UP, yaw), Vector3(gx, 0.6, gz))
				var d := -xf.basis.z
				var side := xf.basis.x
				# Sweep a car-sized box the whole way: thin rays slip between trunks.
				var sweep := PhysicsShapeQueryParameters3D.new()
				var box := BoxShape3D.new()
				box.size = Vector3(2.4, 1.0, 4.0)
				sweep.shape = box
				sweep.transform = xf
				sweep.motion = d * 60.0
				sweep.collision_mask = 1 | 8
				var clear := space.cast_motion(sweep)[0] >= 1.0 and space.intersect_shape(sweep, 1).is_empty()
				for lane in [-1.5, 0.0, 1.5]:
					if not clear:
						break
					var o: Vector3 = xf.origin + side * lane
					# Not sitting on road either.
					var down := PhysicsRayQueryParameters3D.create(o + Vector3.UP * 2, o + Vector3.DOWN * 2, 8)
					down.hit_back_faces = true
					if not space.intersect_ray(down).is_empty():
						clear = false
						break
				if clear:
					return xf
	return null


func test_offroad_slower() -> void:
	print("off-road")
	await place(track.get_spawn().global_transform)
	var s0 := car.global_position
	await drive(2.0, 0.0, 1.0)
	var road_dist := car.global_position.distance_to(s0)
	var road_speed := car.forward_speed
	var xf: Variant = _clear_offroad_xf()
	check(xf != null, "found a clear grass strip")
	if xf == null:
		return
	await place(xf)
	check(car.surface == "offroad", "grass reads as offroad")
	var o0 := car.global_position
	impacts.clear()
	await drive(2.0, 0.0, 1.0)
	if impacts.size() > 0:
		print("    off-road run hit something at %s (from %s)" % [car.global_position, o0])
	var off_dist := car.global_position.distance_to(o0)
	print("    2 s full throttle: road %.1f m (%.1f m/s), grass %.1f m (%.1f m/s)" % [road_dist, road_speed, off_dist, car.forward_speed])
	check(off_dist < road_dist * 0.8 and car.forward_speed < road_speed * 0.7, "grass is clearly slower")
	check(car.forward_speed > 3.0, "but you can still drive on it")


func test_collision() -> void:
	print("collision")
	var barn: Node3D = track.get_node("Landmarks/Sawmill")
	var target := barn.global_position
	# Approach from 30 m out along the barn's local +Z face normal.
	var n := barn.global_basis.z.normalized()
	var start := target + n * 30.0 + Vector3(0, 0.6, 0)
	var xf := Transform3D(Basis.looking_at(-n, Vector3.UP), start)
	await place(xf)
	impacts.clear()
	var peak := 0.0
	var hit_frame_speed := 0.0
	for f in 240: # 4 s: the yard is off-road, slower since the rally retune
		if f % 2 == 0:
			car.set_control(0.0, 1.0, 0.0)
		var before := car.forward_speed
		await physics_frame
		peak = maxf(peak, before)
		if impacts.size() > 0 and hit_frame_speed == 0.0:
			hit_frame_speed = before
	var depth := (car.global_position - target).dot(n)
	print("    peak %.1f m/s, impacts %d (first %.1f), now %.1f m/s, %.1f m from barn centre" % [peak, impacts.size(), impacts[0] if impacts.size() else 0.0, car.forward_speed, depth])
	check(impacts.size() >= 1, "hitting the barn emits impact")
	check(depth > 5.5 - 0.3 + 1.0, "car doesn't pass through (sawmill half-depth 5.5)")
	check(car.forward_speed < 3.0, "momentum is lost against the wall")
	# A tree too: smaller, round, the usual victim. Pick one with a clear 14 m
	# run-up from the south, so it's this tree we hit and not a neighbour.
	var tp := _lone_tree()
	await place(Transform3D(Basis.looking_at(Vector3(0, 0, -1), Vector3.UP), tp + Vector3(0, 0.6, 14)))
	impacts.clear()
	await drive(2.0, 0.0, 1.0)
	print("    tree run: impacts %s, z %.2f, speed %.2f, tree z %.2f" % [impacts, car.global_position.z, car.forward_speed, tp.z])
	check(impacts.size() >= 1, "tree in the way: impact (%d)" % impacts.size())
	check(car.global_position.z > tp.z, "and the car stops short of driving through it (z %.1f vs tree %.1f)" % [car.global_position.z, tp.z])


func _lone_tree() -> Vector3:
	var space := car.get_world_3d().direct_space_state
	for o in get_nodes_in_group("track_obstacle"):
		if not (o is Scatter and o.get_meta("kind", "") == "tree"):
			continue
		for i in (o as Scatter).meshes.size():
			for p in (o as Scatter).positions(i):
				if not track.bounds.grow(-20.0).has_point(Vector2(p.x, p.z)):
					continue # scenery past the world walls
				var from := p + Vector3(0, 0.6, 14)
				var q := PhysicsRayQueryParameters3D.create(from, p + Vector3(0, 0.6, 0), 1)
				var hit := space.intersect_ray(q)
				var wide := PhysicsRayQueryParameters3D.create(from + Vector3(1.2, 0, 0), p + Vector3(1.2, 0.6, 2), 1)
				var wide2 := PhysicsRayQueryParameters3D.create(from + Vector3(-1.2, 0, 0), p + Vector3(-1.2, 0.6, 2), 1)
				if not hit.is_empty() and Vector2(hit.position.x - p.x, hit.position.z - p.z).length() < 1.5 \
						and space.intersect_ray(wide).is_empty() and space.intersect_ray(wide2).is_empty():
					return p
	return Vector3.ZERO


func test_checkpoint_order() -> void:
	print("checkpoints")
	main.checkpoints_passed = 0
	var cps := track.get_checkpoints()
	# CP3 first: ignored.
	await place(cps[2].global_transform.translated_local(Vector3(0, -0.9, 6)))
	await drive(1.0, 0.0, 1.0)
	check(main.checkpoints_passed == 0, "out-of-order checkpoint ignored")
	await place(cps[0].global_transform.translated_local(Vector3(0, -0.9, 6)))
	await drive(1.0, 0.0, 1.0)
	check(main.checkpoints_passed == 1, "CP1 counts")
	main.recover()
	await physics_frame
	var anchor := track.recovery_for(1)
	check(car.global_position.distance_to(anchor.global_position) < 1.0, "reset lands on CP1 recovery anchor")
	main.checkpoints_passed = 0


func _map_state() -> Dictionary:
	var r := map.image_rect
	return {
		"rect": r.get_global_rect(), "rot": r.rotation, "scale": r.scale,
		"tex": r.texture, "map_rect": map.get_global_rect(), "children": r.get_child_count(),
	}


func test_map_static() -> void:
	print("map")
	check(map.render_count == 1, "map rendered exactly once")
	check(map.image_rect.texture != null, "map has a texture")
	map.gps_enabled = false
	await place(track.get_spawn().global_transform)
	var marker: Polygon2D = map.image_rect.get_node("GpsMarker")
	var before := _map_state()
	var m0 := marker.position
	await drive(1.5, 0.0, 1.0)
	await drive(1.5, 1.0, 1.0)
	for f in 5:
		await process_frame
	var after := _map_state()
	check(before == after, "GPS off: map image doesn't pan, rotate, scale or swap")
	check(not marker.visible, "GPS off: no marker")
	check(marker.position == m0, "GPS off: marker isn't even updated")
	check(map.render_count == 1, "still rendered once after driving")
	map.gps_enabled = true
	await place(track.get_spawn().global_transform) # the steering run ends in the trees
	await process_frame
	var p1 := marker.position
	check(marker.visible, "GPS on: marker visible")
	await drive(1.0, 0.0, 1.0)
	await process_frame
	check(marker.position.distance_to(p1) > 1.0, "GPS on: marker follows the car (%.1f px)" % marker.position.distance_to(p1))
	check(_map_state() == after, "GPS on: map itself still static")
	map.gps_enabled = false
	check(not marker.visible, "GPS toggled off again: marker hidden")
	# Marker lands where world_to_map says.
	var uv := track.world_to_map(track.get_spawn().global_position)
	check(uv.x > 0 and uv.x < 1 and uv.y > 0 and uv.y < 1, "spawn maps inside the map (%s)" % uv)


## After every camera mode and weather change: the map is the same image,
## rendered once, with no weather and none of the eye-level forest in it.
func test_map_static_after_modes() -> void:
	print("map after camera modes")
	check(map.render_count == 1, "still exactly one map render")
	check(main.eye_forest != null and not track.is_ancestor_of(main.eye_forest), "the eye forest isn't part of the track the map frames")
	var gps := map.gps_enabled
	map.gps_enabled = false
	var s0 := _map_state()
	main.set_camera_mode(FollowCamera.Mode.BONNET)
	await process_frame
	main.weather.configure(9, 1.0)
	await process_frame
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	await process_frame
	check(_map_state() == s0 and map.render_count == 1, "map unchanged through mode and weather switches")
	map.gps_enabled = gps
	main.weather.configure(4242, 0.4)


func test_bridge_noop() -> void:
	print("bridge")
	var b: WebBridge = main.bridge
	check(not b.connected, "not on web: bridge stays disconnected, no errors")
	b.emit_physics_event({"kind": "test"}) # must be a silent no-op
	var s := b.snapshot()
	for k in ["tick", "position", "heading", "velocity", "speed", "distance", "checkpointHint"]:
		check(s.has(k), "snapshot has %s" % k)
	print("    sample snapshot: ", JSON.stringify(s))


# --- terrain, autopilot, weather, framing ----------------------------------------

## Ground under p by a downward ray against the world (the heightfield).
func _ground_y(p: Vector3) -> float:
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 20.0, p + Vector3.DOWN * 40.0, 1)
	q.exclude = [car.get_rid()]
	var hit := car.get_world_3d().direct_space_state.intersect_ray(q)
	return hit.position.y if hit else -INF


func test_terrain() -> void:
	print("terrain")
	var lo := INF
	var hi := -INF
	var off := 0.0
	for p in track.centerline:
		lo = minf(lo, p.y)
		hi = maxf(hi, p.y)
		off = maxf(off, absf(p.y - track.height_at(p.x, p.z)))
	print("    road height %.1f..%.1f m" % [lo, hi])
	check(hi - lo > 3.0, "the stage has ups and downs (%.1f m of relief)" % (hi - lo))
	check(off < 0.01, "centreline sits on the terrain (worst %.3f m)" % off)
	# The collider is the same grid: a ray agrees with height_at.
	var worst := 0.0
	for i in range(0, track.centerline.size(), 37):
		var p := track.centerline[i]
		worst = maxf(worst, absf(_ground_y(p) - track.height_at(p.x, p.z)))
	check(worst < 0.05, "ground collider matches height_at (worst %.3f m)" % worst)
	var bad := []
	for a in track.get_recovery_anchors() + [track.get_spawn()]:
		var gap: float = a.global_position.y - _ground_y(a.global_position)
		if absf(gap - 0.6) > 0.15:
			bad.append("%s %.2f" % [a.name, gap])
	check(bad.is_empty(), "spawn and recovery anchors sit 0.6 m over the ground %s" % [bad])
	bad.clear()
	for g in track.get_checkpoints() + [track.get_finish()]:
		var gap: float = g.global_position.y - _ground_y(g.global_position)
		if absf(gap - 1.5) > 0.3:
			bad.append("%s %.2f" % [g.name, gap])
	check(bad.is_empty(), "checkpoint and finish gates stand on the road %s" % [bad])


## The sharpest crest, by the centreline's second difference in height.
func _crest_index() -> int:
	var c := track.centerline
	var best := 0.0
	var bi := 0
	for i in range(10, c.size() - 10):
		var k := (c[i - 10].y + c[i + 10].y - 2.0 * c[i].y)
		if k < best:
			best = k
			bi = i
	return bi


func test_crest() -> void:
	print("crest")
	var ci := _crest_index()
	var c := track.centerline
	var start := maxi(ci - 75, 1) # 150 m run-up
	var xf := Transform3D(Basis.looking_at(c[start + 1] - c[start - 1], Vector3.UP).orthonormalized(), c[start] + Vector3(0, 0.6, 0))
	await place(xf)
	main.autopilot.flat_out = true
	main.autopilot.enabled = true
	var air := 0
	var max_air := 0
	var lowest := INF
	var crest_speed := 0.0
	var frames := 0
	impacts.clear()
	while frames < 60 * 14:
		await physics_frame
		frames += 1
		var p := car.global_position
		lowest = minf(lowest, p.y - track.height_at(p.x, p.z))
		air = 0 if car.is_on_floor() else air + 1
		max_air = maxi(max_air, air)
		var near := c[ci]
		if Vector2(p.x - near.x, p.z - near.z).length() < 4.0:
			crest_speed = maxf(crest_speed, car.forward_speed)
		if (p - c[mini(ci + 30, c.size() - 1)]).length() < 6.0:
			break
	main.autopilot.enabled = false
	main.autopilot.flat_out = false
	print("    crest at %.0f m: %.1f m/s over it, longest airtime %d frames, lowest %.2f m vs ground, impacts %d" % [ci * 2.0, crest_speed, max_air, lowest, impacts.size()])
	check(crest_speed > 0.8 * car.max_speed, "crest taken near full speed (%.0f km/h)" % (crest_speed * 3.6))
	check(max_air < 30, "at most a hop over the crest (%d frames airborne)" % max_air)
	check(lowest > -0.25, "never sinks through the ground (lowest %.2f m)" % lowest)
	check(impacts.is_empty(), "and doesn't launch into the trees")


func test_autopilot_stage() -> void:
	print("autopilot")
	await place(track.get_spawn().global_transform)
	main.checkpoints_passed = 0
	main.finished = false
	main.recoveries = 0
	impacts.clear()
	main.set_autopilot(true)
	check(not main.bridge.forward_control, "autopilot takes the car from the bridge")
	var t := 0.0
	var trip0 := car.distance_travelled
	var top := 0.0
	var max_slip := 0.0
	while t < 240.0 and not main.finished:
		await physics_frame
		t += 1.0 / 60.0
		top = maxf(top, car.forward_speed)
		max_slip = maxf(max_slip, absf(car.slip_angle))
	main.set_autopilot(false)
	print("    stage time %.1f s (%d:%04.1f), top %.0f km/h, max slip %.0f deg, impacts %d, trip %.0f m" % [t, int(t) / 60, fmod(t, 60.0), top * 3.6, rad_to_deg(max_slip), impacts.size(), car.distance_travelled - trip0])
	check(main.finished, "autopilot finishes the stage (CP %d/%d)" % [main.checkpoints_passed, track.get_checkpoints().size()])
	check(main.recoveries == 0, "without a reset")
	check(t > 60.0 and t < 180.0, "in a sane time (%.1f s)" % t)
	check(max_slip > deg_to_rad(4.0), "and it slides a little doing it (%.0f deg)" % rad_to_deg(max_slip))
	check(main.bridge.forward_control, "autopilot off hands control back")
	main.finished = false
	main.checkpoints_passed = 0


func _bank_snapshot(w: Weather) -> Array:
	var out := []
	for b in w.bank_count():
		out.append([w.bank_centre(b), snappedf(w.bank_alpha(b), 0.0001)])
	return out


func test_weather() -> void:
	print("weather")
	var w: Weather = main.weather
	w.time = 37.0
	w.configure(4242, 1.0)
	var a := _bank_snapshot(w)
	check(w.bank_count() > 20, "heavy cloud: %d mist banks" % w.bank_count())
	w.configure(4242, 1.0)
	check(_bank_snapshot(w) == a, "same seed, same time: same weather")
	w.configure(99, 1.0)
	check(_bank_snapshot(w) != a, "another seed, another sky")
	w.configure(4242, 0.5)
	var half := _bank_snapshot(w)
	var subset := true
	for b in half.size():
		subset = subset and half[b][0] == a[b][0]
	check(half.size() < a.size() and subset, "lighter cloud is a subset of the same sky")
	# Fades are smooth: no bank changes opacity by more than 2% in a frame.
	var worst := 0.0
	for f in 600:
		var before := []
		for b in w.bank_count():
			before.append(w.bank_alpha(b))
		w.time += 1.0 / 60.0
		for b in w.bank_count():
			worst = maxf(worst, absf(w.bank_alpha(b) - before[b]))
	check(worst < 0.02, "mist fades, never pops (worst %.4f per frame)" % worst)
	var mist_mat: ShaderMaterial = (w.get_node("Mist") as MultiMeshInstance3D).multimesh.mesh.surface_get_material(0)
	var hole: Vector2 = mist_mat.get_shader_parameter("keyhole")
	check(hole.x >= 3.0 and float(mist_mat.get_shader_parameter("max_alpha")) < 0.85, "the car always has a clear hole (%.1f m), mist never goes opaque" % hole.x)
	check((w.get_node("Mist") as VisualInstance3D).layers & MapController.CULL_MASK == 0, "mist sprites are invisible to the static map camera")
	check(w.get_node_or_null("CloudShadow") == null, "no cloud-shadow overlay quad any more (it lives in the shaders)")
	# Every registered world material gates both weather terms on the camera
	# seeing render layer 4, which the map camera doesn't.
	var gated := not w.materials().is_empty()
	for m in w.materials():
		gated = gated and (m.shader.code.contains("weather_seen(CAMERA_VISIBLE_LAYERS)") or _includes_gate(m.shader.code))
	check(gated, "%d world materials, all gated on the weather layer" % w.materials().size())
	check((MapController.CULL_MASK & Weather.LAYER) == 0, "and the map camera doesn't draw that layer")
	check(map.render_count == 1, "and the map is still the one render")
	w.configure(4242, 0.0)
	check(w.bank_count() == 0 and not w.get_node("Mist").visible, "clouds 0: clear sky")
	var shade_off := true
	for m in w.materials():
		shade_off = shade_off and float(m.get_shader_parameter("cloud_strength")) == 0.0 and int(m.get_shader_parameter("mist_count")) == 0
	check(shade_off, "clouds 0: no shade, no mist in any material")


func _includes_gate(code: String) -> bool:
	# palette/ground/road/forest shaders call it through the shared include.
	return code.contains("weather.gdshaderinc") and code.contains("weather_seen(")


## Cloud shadows: one field, in every camera, on ground, road, trees and car.
func test_cloud_shadow() -> void:
	print("cloud shadow")
	var w: Weather = main.weather
	w.time = 12.0
	w.configure(77, 0.8)
	var core: Array = [main.PALETTE] + track.world_materials()
	var registered := true
	for m in core:
		registered = registered and w.materials().has(m)
	check(registered, "palette, road and ground materials all get the weather")
	var lit := 0
	var shaded := 0
	for i in 400:
		var s := w.cloud_shade(track.bounds.position.x + (i % 20) * 50.0, track.bounds.position.y + (i / 20) * 36.0)
		lit += int(s < 0.01)
		shaded += int(s > 0.15)
	check(lit > 20 and shaded > 20, "the shade is patchy: %d of 400 points in sun, %d under cloud" % [lit, shaded])
	for mode in [FollowCamera.Mode.TOP_DOWN, FollowCamera.Mode.CHASE, FollowCamera.Mode.BONNET]:
		main.set_camera_mode(mode)
		await process_frame
		var all_on := true
		for m in w.materials():
			all_on = all_on and float(m.get_shader_parameter("cloud_strength")) > 0.2 and float(m.get_shader_parameter("cloud_coverage")) > 0.3
		check(all_on, "%s: cloud shade on in all %d materials" % [main.CAMERA_MODES[mode], w.materials().size()])
	var o0: Vector2 = main.PALETTE.get_shader_parameter("cloud_offset")
	for f in 30:
		await physics_frame
	await process_frame
	check((main.PALETTE.get_shader_parameter("cloud_offset") as Vector2).distance_to(o0) > 0.5, "and it drifts with the wind")
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	w.configure(4242, 0.4)


## Eye-level mist: in chase and bonnet a bank on the road ahead has to
## actually hide it, from the camera's point of view, without touching the car.
func test_eye_mist() -> void:
	print("eye-level mist")
	var w: Weather = main.weather
	w.time = 30.0
	w.configure(3, 1.0)
	# The thickest bank sitting on the road, and a spot ~30 m before it.
	var pts := track.centerline
	var best := 0.0
	var at := -1
	var bank_i := -1
	for b in w.bank_count():
		var c := w.bank_centre(b)
		for j in range(30, pts.size() - 30, 3):
			if Vector2(pts[j].x, pts[j].z).distance_to(c) < 10.0 and w.bank_alpha(b) > best:
				best = w.bank_alpha(b)
				at = j
				bank_i = b
	check(at > 0 and best > 0.5, "seed 3 has a thick bank on the road (alpha %.2f)" % best)
	var start := at - 15 # STEP is 2 m: 30 m back
	var fwd3 := (pts[start + 1] - pts[start - 1]).normalized()
	await place(Transform3D(Basis.looking_at(fwd3, Vector3.UP), pts[start] + Vector3(0, 0.6, 0)))
	var c2 := w.bank_centre(bank_i)
	var in_bank := Vector3(c2.x, track.height_at(c2.x, c2.y) + 0.3, c2.y)
	for mode in [FollowCamera.Mode.CHASE, FollowCamera.Mode.BONNET]:
		main.set_camera_mode(mode)
		main.cam.snap()
		await process_frame
		var cp: Vector3 = main.cam.global_position
		var road_m := w.eye_mist(cp, in_bank)
		var car_m := w.eye_mist(cp, car.global_position + Vector3(0, 0.6, 0))
		var near_m := w.eye_mist(cp, car.global_position + fwd3 * 3.0)
		var name: String = main.CAMERA_MODES[mode]
		check(road_m > 0.5, "%s: the road inside the bank, %.0f m ahead, is %.0f%% mist" % [name, cp.distance_to(in_bank), road_m * 100.0])
		check(car_m == 0.0 and near_m == 0.0, "%s: the car and the 3 m in front of it are clear" % name)
		check(road_m <= Weather.MAX_ALPHA + 0.001, "%s: and never fully opaque (cap %.2f)" % [name, Weather.MAX_ALPHA])
		check(int(main.PALETTE.get_shader_parameter("mist_count")) > 0 and not w.get_node("Mist").visible, "%s: the shaders get the banks, the overhead sprites hide" % name)
	# Smooth: the mist over that road point never jumps between frames.
	var worst := 0.0
	var prev := w.eye_mist(main.cam.global_position, in_bank)
	for f in 240:
		w.time += 1.0 / 60.0
		var now := w.eye_mist(main.cam.global_position, in_bank)
		worst = maxf(worst, absf(now - prev))
		prev = now
	check(worst < 0.02, "eye-level mist fades, never pops (worst %.4f per frame)" % worst)
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	await process_frame
	check(w.eye_mist(main.cam.global_position, in_bank) == 0.0 and int(main.PALETTE.get_shader_parameter("mist_count")) == 0, "top-down: no eye-level mist in the shaders")
	check(w.get_node("Mist").visible, "top-down: the overhead puffs are back")
	w.configure(4242, 0.4)


## allowedCameras: a host setting or sabotage can pin the Navigator's view.
func test_allowed_cameras() -> void:
	print("allowed cameras")
	var cam: FollowCamera = main.cam
	main._on_session({}, "")
	check(main.allowed_cameras == [0, 1, 2] and cam.mode == FollowCamera.Mode.TOP_DOWN, "default: all three allowed, top-down")
	var seen := []
	for i in 3:
		main.cycle_camera()
		seen.append(int(cam.mode))
	check(seen == [1, 2, 0], "Y cycles top-down -> chase -> bonnet -> top-down (%s)" % [seen])
	main._on_session({"allowedCameras": ["chase"]}, "")
	check(cam.mode == FollowCamera.Mode.CHASE, "allowedCameras [chase]: moves to chase")
	main.cycle_camera()
	check(cam.mode == FollowCamera.Mode.CHASE, "and Y stays there")
	check(not main.set_camera_mode(FollowCamera.Mode.TOP_DOWN) and cam.mode == FollowCamera.Mode.CHASE, "a direct switch outside the list is refused")
	main._on_session({"allowedCameras": ["bonnet"], "camera": "topdown"}, "")
	check(cam.mode == FollowCamera.Mode.BONNET, "camera: topdown with only bonnet allowed lands on bonnet")
	main._on_session({"allowedCameras": ["topdown", "bonnet"], "camera": "topdown"}, "")
	seen = []
	for i in 3:
		main.cycle_camera()
		seen.append(int(cam.mode))
	check(seen == [2, 0, 2], "[topdown, bonnet]: Y skips chase (%s)" % [seen])
	main._on_session({"allowedCameras": ["nonsense"], "camera": "chase"}, "")
	check(main.allowed_cameras == [0, 1, 2] and cam.mode == FollowCamera.Mode.CHASE, "unknown names: all allowed again")
	main._on_session({"camera": "topdown"}, "")
	check(cam.mode == FollowCamera.Mode.TOP_DOWN and main.allowed_cameras == [0, 1, 2], "a session without the key: all three")


## The eye-level forest: same trees, each drawn once, map untouched.
func test_eye_forest() -> void:
	print("eye-level forest")
	main.set_camera_mode(FollowCamera.Mode.CHASE)
	await place(track.get_spawn().global_transform)
	main.cam.snap()
	await process_frame
	var ef: EyeForest = main.eye_forest
	var trees := 0
	for sc in track.get_node("Forest").get_children():
		if sc.get_meta("kind", "") == "tree":
			trees += sc.instance_total
	check(ef != null and ef.counts["impostor"] == trees, "every tree has an impostor (%d)" % trees)
	check(ef.counts["impostor_mm"] < 400 and ef.counts["near_mm"] <= 6 and ef.counts["floor_mm"] <= 8, "%d impostor cells, %d near and %d floor streams" % [ef.counts["impostor_mm"], ef.counts["near_mm"], ef.counts["floor_mm"]])
	var n := ef.streamed()
	check(n > 50 and n < 3000, "streams hold only what's round the camera (%d instances)" % n)
	var baked_hidden := true
	for sc in track.get_node("Forest").get_children():
		for c in sc.get_children():
			if c is MultiMeshInstance3D:
				baked_hidden = baked_hidden and not c.visible
	check(baked_hidden and ef.visible, "chase draws the eye-level forest instead of the baked chunks")
	# Move 40 m: the streams refill.
	var before := ef._centre
	await place(Transform3D(car.global_basis, car.global_position - car.global_basis.z * 40.0))
	main.cam.snap()
	await process_frame
	await process_frame
	check(ef._centre.distance_to(before) > 20.0, "and refill as the camera moves")
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	var baked_back := true
	for sc in track.get_node("Forest").get_children():
		for c in sc.get_children():
			if c is MultiMeshInstance3D:
				baked_back = baked_back and c.visible
	check(baked_back and not ef.visible, "top-down: baked chunks back, eye forest hidden")
	check(map.render_count == 1, "the map was never re-rendered")


func test_camera_fit() -> void:
	print("camera framing")
	var cam: FollowCamera = main.cam
	cam.fit_css(Vector2(1280, 720))
	check(is_equal_approx(cam.base_view(), cam.view_size), "desktop keeps the full view (%.0f m)" % cam.base_view())
	cam.fit_css(Vector2(844, 390))
	var v := cam.base_view()
	print("    844x390 landscape phone: %.1f m across the short side, %.1f px/m (desktop 720 px: %.1f px/m)" % [v, 390.0 / v, 720.0 / cam.view_size])
	check(v < cam.view_size and 390.0 / v >= 12.0, "a short phone screen zooms in to keep the car legible")
	check(v >= cam.min_view, "but still shows %.0f m+ for the corners ahead" % cam.min_view)
	cam.fit_css(Vector2(390, 844))
	check(cam.keep_aspect == Camera3D.KEEP_WIDTH, "portrait sizes the short side")
	cam.fit_css(Vector2(1280, 720))


## Top-down stays the default next to the eye-level cameras, and
## going there and back leaves it exactly as it was.
func test_camera_modes() -> void:
	print("camera modes")
	var cam: FollowCamera = main.cam
	# Parked: the autopilot run leaves the car coasting at ~80 km/h, and a slow
	# frame (the mode switch) then lets physics run steps past the camera.
	await place(car.global_transform)
	check(cam.mode == FollowCamera.Mode.TOP_DOWN and cam.projection == Camera3D.PROJECTION_ORTHOGONAL and cam.environment == null, "top-down orthographic is the default")
	var before := [cam.near, cam.far, cam.keep_aspect]
	main._on_session({"camera": "chase"}, "")
	check(cam.mode == FollowCamera.Mode.CHASE and cam.projection == Camera3D.PROJECTION_PERSPECTIVE, "initSession camera: chase goes perspective")
	check(cam.environment != null and cam.environment.fog_enabled and cam.environment.background_mode == Environment.BG_SKY, "with its own sky and fog")
	var world_env: Environment = (track.get_node("Environment") as WorldEnvironment).environment
	check(not world_env.fog_enabled and world_env.background_mode == Environment.BG_COLOR, "the world environment (and so the map) keeps no fog, no sky")
	await process_frame
	var behind := car.global_transform.affine_inverse() * cam.global_position
	check(behind.z > 2.0 and behind.y > 1.0, "chase sits behind and above the car (%.1f m back, %.1f up)" % [behind.z, behind.y])
	main.set_camera_mode(FollowCamera.Mode.BONNET)
	await process_frame
	var nose := car.global_transform.affine_inverse() * cam.global_position
	check(nose.z < 0.0 and nose.y > 1.0 and cam.near < 0.15, "bonnet rides the front of the car, near plane %.2f m (at %.2f, %.2f)" % [cam.near, nose.z, nose.y])
	main._on_session({"camera": "topdown"}, "")
	check(cam.projection == Camera3D.PROJECTION_ORTHOGONAL and cam.environment == null and [cam.near, cam.far, cam.keep_aspect] == before, "back to top-down restores it exactly")
	check(not main.weather.eye_level, "and the mist is back to overhead puffs")


# --- scenery callouts and easter eggs ---------------------------------------------

const CALLOUTS := ["forestry gate", "wrecked car", "fire tower", "hunting stand", "log pile", "outhouse", "campsite"]


func _callouts() -> Array:
	return track.get_landmarks().filter(func(l: Node) -> bool: return l.get_meta("callout", false))


## The smaller landmarks: each labelled, beside the road not on it, clear of
## the recovery anchors, no trees inside, and an icon on the map.
func test_scenery_callouts() -> void:
	print("scenery callouts")
	var cs := _callouts()
	var labels := cs.map(func(l: Node) -> String: return String(l.get_meta("label")))
	labels.sort()
	var want := CALLOUTS.duplicate()
	want.sort()
	check(labels == want, "seven callouts: %s" % [labels])
	var icons := track.get_node_or_null("MapOverlay/Icons")
	var bad := []
	for l in cs:
		var p: Vector3 = l.global_position
		var road := INF
		for q in track.centerline:
			road = minf(road, Vector2(p.x - q.x, p.z - q.z).length())
		var anchor := INF
		for a in track.get_recovery_anchors() + [track.get_spawn()]:
			anchor = minf(anchor, Vector2(p.x, p.z).distance_to(Vector2(a.global_position.x, a.global_position.z)))
		var icon: MeshInstance3D = icons.get_node_or_null(String(l.name)) if icons else null
		var icon_ok := icon != null and icon.layers == 4 and icon.mesh != null \
			and Vector2(icon.mesh.get_aabb().get_center().x, icon.mesh.get_aabb().get_center().z).distance_to(Vector2(p.x, p.z)) < 6.0
		# The gate's hinge post stands at the road's edge, by design.
		if road < (4.0 if l.name == "ForestryGate" else 5.5) or anchor < 20.0 or not icon_ok or not l.is_in_group("track_obstacle"):
			bad.append("%s road %.1f anchor %.0f icon %s" % [l.name, road, anchor, icon_ok])
	check(bad.is_empty() and cs.size() == 7, "each one off the road, clear of the recovery anchors, solid, with a map icon %s" % [bad])
	var shapes := {}
	if icons:
		for ic in icons.get_children():
			shapes[ic.get_meta("shape")] = true
	check(shapes.size() == 7, "seven different icon shapes, not just colours (%s)" % [shapes.keys()])
	# Trees stay out of their footprints.
	var crowded := []
	for l in cs:
		var p: Vector3 = l.global_position
		var r := 2.0 if l.name == "ForestryGate" else 3.0
		for sc in track.get_node("Forest").get_children():
			if sc.get_meta("kind", "") != "tree":
				continue
			for m in sc.meshes.size():
				for q in sc.positions(m):
					if Vector2(q.x - p.x, q.z - p.z).length() < r:
						crowded.append(String(l.name))
	check(crowded.is_empty(), "no tree inside any footprint %s" % [crowded])
	var tower: Node3D = track.get_node("Landmarks/FireTower")
	var aabb := (tower.get_node("Mesh") as MeshInstance3D).get_aabb()
	var crest := -INF
	for q in track.centerline:
		crest = maxf(crest, q.y)
	check(aabb.size.y > 20.0 and tower.global_position.y + aabb.end.y > crest + 20.0, "the fire tower stands %.0f m tall, %.0f m over the stage's highest road" % [aabb.size.y, tower.global_position.y + aabb.end.y - crest])


func test_egg_schedule() -> void:
	print("easter-egg schedule")
	var eggs: EasterEggs = main.eggs
	var counts := eggs.spot_counts()
	check(counts.get("deer", 0) >= 4 and counts.get("birds", 0) >= 4 and counts.get("moose", 0) == 1 and counts.get("bigfoot", 0) == 1 and counts.get("wrongway", 0) == 1 and counts.get("camper", 0) == 1, "the track has its egg spots %s" % [counts])
	var a := EasterEggs.make_schedule(1234, counts)
	check(a == EasterEggs.make_schedule(1234, counts), "same seed, same schedule")
	var differs := 0
	for sd in range(1, 21):
		differs += int(EasterEggs.make_schedule(sd, counts) != a)
	check(differs == 20, "other seeds, other surprises (%d of 20 differ)" % differs)
	# Through the node too, and the weather can't disturb it.
	eggs.force = {}
	eggs.configure(1234)
	var s0 := eggs.schedule.duplicate(true)
	main.weather.configure(1234, 1.0)
	eggs.configure(1234)
	check(eggs.schedule == s0 and s0 == a, "configure(seed) is the same schedule, whatever the clouds")
	# Rare: count over many seeds.
	var live := {}
	var any_seen := 0
	const N := 2000
	for sd in N:
		var some := false
		for e in EasterEggs.make_schedule(sd * 7 + 3, counts):
			if e.live:
				live[e.kind] = live.get(e.kind, 0) + 1
				some = true
		any_seen += int(some)
	var per_run := {}
	for k in live:
		per_run[k] = snappedf(float(live[k]) / N, 0.01)
	print("    live per run: %s" % [per_run])
	check(float(live.get("bigfoot", 0)) / N < 0.1 and live.get("bigfoot", 0) > 0, "Bigfoot is very rare (%.1f%% of runs)" % (100.0 * live.get("bigfoot", 0) / N))
	check(float(live.get("moose", 0)) / N < 0.4, "the moose is rare (%.0f%%)" % (100.0 * live.get("moose", 0) / N))
	# Deterministic in time too: windows are numbers in the schedule.
	var moose: Dictionary = a.filter(func(e: Dictionary) -> bool: return e.kind == "moose")[0]
	check(moose.open >= 0.0 and moose.close > moose.open + 60.0, "the moose's window is fixed by the seed (%.0f-%.0f s)" % [moose.open, moose.close])
	main.weather.configure(4242, 0.4)


func _nearest(p: Vector3) -> int:
	var best := INF
	var bi := 0
	for i in track.centerline.size():
		var d := Vector2(track.centerline[i].x - p.x, track.centerline[i].z - p.z).length_squared()
		if d < best:
			best = d
			bi = i
	return bi


func _on_ground(b: Basis, p: Vector3) -> Transform3D:
	return Transform3D(b, Vector3(p.x, track.height_at(p.x, p.z) + 0.6, p.z))


func _egg_nodes(n: Node, out: Array) -> Array:
	for c in n.get_children():
		out.append(c)
		_egg_nodes(c, out)
	return out


func test_eggs_no_collision() -> void:
	print("easter eggs: no collision")
	var eggs: EasterEggs = main.eggs
	eggs.force = {"all": true}
	eggs.configure(77)
	await process_frame
	var kinds := {}
	for r in eggs._live:
		kinds[r.e.kind] = true
	check(kinds.size() == 6, "forced on: every kind is live (%s)" % [kinds.keys()])
	var bodies := 0
	var geo := 0
	var off_map := true
	for c in _egg_nodes(eggs, []):
		bodies += int(c is CollisionObject3D or c is CollisionShape3D)
		if c is VisualInstance3D:
			geo += 1
			off_map = off_map and ((c as VisualInstance3D).layers & MapController.CULL_MASK) == 0
	check(bodies == 0 and geo > 15, "%d creature nodes, not one collision body or shape" % geo)
	check(off_map, "and none of them is on a layer the map camera draws")
	# Drive straight through a family of deer parked on the road.
	var r: Dictionary = eggs.live("deer")[0]
	var spot: Node3D = r.spot
	for d in r.deer:
		d.lat = 0.0
		d.along = 0.0
	r.state = "gone" # parked, no AI
	var fwd3 := -spot.global_basis.z
	await place(_on_ground(spot.global_basis, spot.global_position - fwd3 * 12.0))
	impacts.clear()
	await drive(0.5, 0.0, 1.0)
	var v0 := car.forward_speed
	await drive(1.5, 0.0, 1.0)
	var past := (car.global_position - spot.global_position).dot(fwd3)
	check(past > 5.0 and impacts.is_empty() and car.forward_speed >= v0, "the car drives through them: %.0f m past, no impact, %.1f -> %.1f m/s" % [past, v0, car.forward_speed])
	eggs.force = {}
	eggs.configure(4242)


func test_deer_cross_and_spook() -> void:
	print("deer")
	var eggs: EasterEggs = main.eggs
	eggs.force = {"deer": true}
	eggs.configure(5)
	var r: Dictionary = eggs.live("deer")[2]
	var spot: Node3D = r.spot
	var fwd3 := -spot.global_basis.z
	# Coming at 22 m/s from 90 m: they wait, then go when the car is ~3 s off.
	# On the road, 90 m back along it (the autopilot steers; the speed is held).
	var c := track.centerline
	var si := int(float(spot.get_meta("distance_m")) / 2.0)
	await place(_on_ground(Basis.looking_at(c[si - 44] - c[si - 46], Vector3.UP), c[si - 45]))
	main.cam.snap()
	r.shown = true
	var start_gap := -1.0
	var mid_gap := -1.0
	main.set_autopilot(true)
	for f in 300:
		var ahead := (c[mini(_nearest(car.global_position) + 2, c.size() - 1)] - car.global_position)
		ahead.y = 0.0
		car.forward_speed = 22.0
		car.velocity = ahead.normalized() * 22.0
		await physics_frame
		await process_frame
		var gap := Vector2(spot.global_position.x - car.global_position.x, spot.global_position.z - car.global_position.z).length() * signf((spot.global_position - car.global_position).dot(fwd3))
		if r.state != "wait" and start_gap < 0.0:
			start_gap = gap
		var d0: Dictionary = r.deer[0]
		if mid_gap < 0.0 and absf(d0.lat) < 1.0:
			mid_gap = gap
		if gap < 0.0:
			break
	main.set_autopilot(false)
	check(start_gap > 45.0 and start_gap < 90.0, "they start across when the car is %.0f m off" % start_gap)
	check(mid_gap > 15.0, "the first deer is mid-road with the car still %.0f m away" % mid_gap)
	# Spook: a deer waiting by the road, the car pulls up 10 m short of it.
	eggs.configure(5)
	r = eggs.live("deer")[2]
	r.shown = true
	var d: Dictionary = r.deer[0]
	var wait_at: Vector3 = (d.node as Node3D).global_position
	await place(_on_ground(spot.global_basis, spot.global_position - fwd3 * 14.0))
	var gap0 := Vector2(car.global_position.x - wait_at.x, car.global_position.z - wait_at.z).length()
	for f in 10:
		await process_frame
	var lat0: float = absf(d.lat)
	for f in 30:
		await process_frame
	check(gap0 < EasterEggs.SPOOK_R and r.state == "bolt", "car stops %.0f m from a waiting deer: it bolts (%s)" % [gap0, r.state])
	check(float(d.speed) == EasterEggs.DEER_BOLT and absf(d.lat) > lat0, "away from the road at %.1f m/s (%.1f -> %.1f m off)" % [d.speed, lat0, absf(d.lat)])
	eggs.force = {}
	eggs.configure(4242)


func test_campers() -> void:
	print("campers")
	var eggs: EasterEggs = main.eggs
	eggs.force = {"camper": true}
	eggs.configure(3)
	var r: Dictionary = eggs.live("camper")[0]
	r.shown = true
	var camp: Node3D = track.get_node("Landmarks/Campsite")
	var near_i := 0
	var best := INF
	for i in track.centerline.size():
		var dd := Vector2(track.centerline[i].x - camp.global_position.x, track.centerline[i].z - camp.global_position.z).length()
		if dd < best:
			best = dd
			near_i = i
	var c := track.centerline
	await place(Transform3D(Basis.looking_at(c[near_i + 1] - c[near_i - 1], Vector3.UP), c[near_i - 10] + Vector3(0, 0.6, 0)))
	for f in 60:
		await process_frame
	var arm: Node3D = r.people[0].arm
	check(arm.rotation.z > 1.8, "car going by: they wave (arm at %.0f deg)" % rad_to_deg(arm.rotation.z))
	car.slip_angle = 0.4
	car.velocity = -car.global_basis.z * 15.0
	for f in 20:
		car.slip_angle = 0.4
		await process_frame
	var body: Node3D = r.people[0].body
	check(body.scale.y < 0.75, "sliding at them: they duck (height x%.2f)" % body.scale.y)
	car.neutralize()
	eggs.force = {}
	eggs.configure(4242)


## The static map never sees a creature or a scenery light: they're all on
## render layer 5, and the map is still the one image.
func test_eggs_off_the_map() -> void:
	print("map vs creatures")
	var eggs: EasterEggs = main.eggs
	map.gps_enabled = false
	var s0 := _map_state()
	eggs.force = {"all": true}
	eggs.configure(9)
	for r in eggs._live:
		eggs._set_shown(r, true)
	for f in 10:
		await process_frame
	check(_map_state() == s0 and map.render_count == 1, "map unchanged with every egg out")
	var lights := ["Landmarks/FireTower/Beacon", "Landmarks/Campsite/Glow", "Landmarks/Campsite/Flame", "EggSpots/FakeJunction"]
	var ok := true
	for path in lights:
		var n := track.get_node_or_null(path) as VisualInstance3D
		ok = ok and n != null and n.layers == EasterEggs.LAYER and (n.layers & MapController.CULL_MASK) == 0
	check(ok, "beacon, campfire glow and flame, fake junction: 3D layer only")
	check((main.cam.cull_mask & EasterEggs.LAYER) != 0, "the Navigator's camera does draw them")
	eggs.force = {}
	eggs.configure(4242)


## Eye level, far off: the fire tower's haze copy lines up with the real
## thing on screen.
func test_tower_far_silhouette() -> void:
	print("fire tower from far off")
	var tower: Node3D = track.get_node("Landmarks/FireTower")
	var c := track.centerline
	var far_i := -1
	for i in range(c.size() - 1, -1, -1):
		var dd := Vector2(c[i].x - tower.global_position.x, c[i].z - tower.global_position.z).length()
		if dd > 150.0 and dd < 220.0 and i < c.size() / 2:
			far_i = i
			break
	await place(Transform3D(Basis.looking_at(c[far_i + 1] - c[far_i - 1], Vector3.UP), c[far_i] + Vector3(0, 0.6, 0)))
	main.set_camera_mode(FollowCamera.Mode.CHASE)
	main.cam.snap()
	await process_frame
	await process_frame
	var pair: Array = main.eye_forest.tall[0]
	var proxy: MeshInstance3D = pair[1]
	var top := Vector3(0, 23.0, 0)
	var cam: Camera3D = main.cam
	var real_px := cam.unproject_position(tower.global_transform * top)
	var proxy_px := cam.unproject_position(proxy.global_transform * top)
	var dist := cam.global_position.distance_to(tower.global_position)
	check(proxy.visible and dist > cam.far and proxy.layers == EasterEggs.LAYER, "%.0f m away, past the far plane: the haze copy is up" % dist)
	check(real_px.distance_to(proxy_px) < 0.5 and cam.global_position.distance_to(proxy.global_transform * top) <= EyeForest.PROXY_R + 1.0, "and lands on the same pixels (%.2f px apart) inside the far plane" % real_px.distance_to(proxy_px))
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)


# --- M1 close ------------------------------------------------------------------

const Export := preload("res://tools/export_tracks.gd")

## Back to the probe's defaults: no room, all assists default, no ghosts.
func _probe_session() -> void:
	main._on_session({}, "")
	main._on_race_event({"kind": "go"})
	main.hold(0.0)
	main._hold_left = 0.0
	car.frozen = false
	car.set_physics_process(true)
	main.ghosts.clear()


## Item 1: the server's `reset` names the checkpoint count; that count wins,
## and the car stays put for holdMs even if a `go` arrives meanwhile.
func test_server_reset() -> void:
	print("server reset")
	main._on_session({"room": true}, "")
	main._on_race_event({"kind": "go"})
	main.checkpoints_passed = 3 # Godot saw 3; the server only accepted 1
	main._on_race_event({"kind": "reset", "checkpoint": 1, "holdMs": 1500})
	var anchor := track.recovery_for(1).global_position
	check(main.checkpoints_passed == 1 and main.bridge.checkpoint_hint == 1, "checkpoints_passed is the server's 1, not Godot's 3")
	check(Vector2(car.global_position.x, car.global_position.z).distance_to(Vector2(anchor.x, anchor.z)) < 0.5, "car on anchor 1")
	main._on_race_event({"kind": "go"})
	await drive(1.2, 0.0, 1.0)
	check(car.frozen and Vector2(car.global_position.x - anchor.x, car.global_position.z - anchor.z).length() < 0.5, "held on the anchor through the hold, a `go` notwithstanding")
	await drive(0.6, 0.0, 1.0)
	check(not car.frozen and car.forward_speed > 1.0, "and free once holdMs is up (%.1f m/s)" % car.forward_speed)
	# A checkpoint as a JSON number (float) works the same.
	main._on_race_event({"kind": "reset", "checkpoint": 4.0})
	check(main.checkpoints_passed == 4, "checkpoint 4.0 from JSON reads as 4")
	# The probe's reset button sends no checkpoint: Godot's own count.
	_probe_session()
	main.checkpoints_passed = 2
	main._on_race_event({"kind": "reset"})
	check(main.checkpoints_passed == 2 and car.global_position.distance_to(track.recovery_for(2).global_position) < 1.0, "no checkpoint in the event: Godot's count, as before")
	main.checkpoints_passed = 0


## Item 2: a reloaded Navigator's initSession carries the server's count and
## what's left of the hold.
func test_reload_mid_race() -> void:
	print("reload mid-race")
	main._on_session({"room": true, "checkpoints": 3, "holdMs": 700}, "")
	var anchor := track.recovery_for(3)
	check(main.checkpoints_passed == 3 and main.bridge.checkpoint_hint == 3, "picks up at 3 checkpoints")
	check(car.global_position.distance_to(anchor.global_position) < 0.5, "car starts on anchor 3, not the spawn")
	check(absf(angle_difference(car.global_rotation.y, anchor.global_rotation.y)) < 0.01, "facing down the road")
	await drive(0.5, 0.0, 1.0)
	check(car.frozen, "still held 0.5 s into a 0.7 s hold")
	await drive(0.5, 0.0, 1.0)
	check(not car.frozen, "released after it")
	main._on_session({"room": true, "checkpoints": 99}, "")
	check(main.checkpoints_passed == track.get_checkpoints().size(), "a count past the last gate is clamped")
	main._on_session({"room": true, "checkpoints": 0}, "")
	check(car.global_position.distance_to(track.get_spawn().global_position) < 0.5, "0 checkpoints: the spawn")
	_probe_session()
	main.checkpoints_passed = 0


## Item 3: in the room, R does nothing and a fall out of the world parks the
## car and asks the server, which answers with a reset.
func test_no_local_teleports() -> void:
	print("no local teleports in the room")
	var asked: Array = []
	var listen := func(ev: Dictionary) -> void: asked.append(ev)
	main.bridge.physics_event.connect(listen)
	main._on_session({"room": true}, "")
	await place(track.get_spawn().global_transform)
	await drive(1.0, 0.0, 1.0)
	var p0 := car.global_position
	var r0: int = main.recoveries
	var key := InputEventKey.new()
	key.physical_keycode = KEY_R
	key.pressed = true
	main._unhandled_key_input(key)
	check(main.recoveries == r0 and car.global_position.distance_to(p0) < 0.5, "R does nothing")
	# Drop it under the world.
	var x := car.global_position.x
	var z := car.global_position.z
	car.reset_to(Transform3D(Basis.IDENTITY, Vector3(x, track.height_at(x, z) - 12.0, z)))
	await idle(0.5)
	var fell := asked.filter(func(e: Dictionary) -> bool: return e.kind == "fell")
	check(main.recoveries == r0 and car.global_position.y < track.height_at(x, z) - 5.0, "fallen out: no teleport of its own")
	check(fell.size() == 1, "asks the server once (%d)" % fell.size())
	check(not car.is_physics_processing() and car.forward_speed == 0.0, "parked meanwhile: snapshots stay put")
	await idle(3.0)
	check(asked.filter(func(e: Dictionary) -> bool: return e.kind == "fell").size() == 2, "asks again if nobody answers in 3 s")
	main._on_race_event({"kind": "reset", "checkpoint": 0, "holdMs": 0})
	await idle(0.3)
	check(car.global_position.distance_to(track.get_spawn().global_position) < 1.0 and car.is_physics_processing(), "the server's reset puts it back and lets it go")
	var n := asked.size()
	await idle(0.5)
	check(asked.size() == n, "and the asking stops")
	# The probe: the old local behaviour.
	_probe_session()
	await place(track.get_spawn().global_transform)
	r0 = main.recoveries
	main._unhandled_key_input(key)
	check(main.recoveries == r0 + 1, "probe: R still resets")
	car.reset_to(Transform3D(Basis.IDENTITY, Vector3(x, track.height_at(x, z) - 12.0, z)))
	await idle(0.1)
	check(main.recoveries == r0 + 2 and car.global_position.y > track.height_at(car.global_position.x, car.global_position.z) - 1.0, "probe: a fall-out still recovers locally")
	main.bridge.physics_event.disconnect(listen)
	main.checkpoints_passed = 0


## Item 4: data/tracks.json is exactly what the exporter makes of the scene.
func test_track_export() -> void:
	print("track export")
	var raw := FileAccess.get_file_as_string(ProjectSettings.globalize_path("res://../data/tracks.json").simplify_path())
	var file: Variant = JSON.parse_string(raw)
	check(file is Dictionary and int(file.version) == 1, "data/tracks.json parses, version 1")
	var mine: Dictionary = Export.export_track(track)
	var theirs: Dictionary = {}
	for t in file.tracks:
		if t.id == track.track_id:
			theirs = t
	check(JSON.parse_string(Export._fmt(mine, "")) == theirs, "the committed file is current (re-run tools/export_tracks.gd if not)")
	check(mine.spawn.position == mine.recovery[0].position, "spawn and the start anchor agree")
	var ok := true
	var last := 0.0
	for cp in mine.checkpoints:
		# The builder's distance_m counts from the centreline's start; the file from the spawn.
		var meta := float(track.get_checkpoints()[cp.id - 1].get_meta("distance_m")) - Export.project(track.centerline, Export.cumulative(track.centerline), track.get_spawn().global_position)
		ok = ok and cp.distance > last and absf(cp.distance - meta) <= 2.0 and cp.radius == 8.0
		last = cp.distance
	check(ok, "checkpoints: in order, from the spawn, within 2 m of the builder's, radius 8")
	check(mine.finish.distance == mine.length and mine.length > last, "length is the spawn-to-finish distance (%d m)" % mine.length)
	var b: Dictionary = mine.bounds
	check(b.x == snappedf(track.bounds.position.x, 0.01) and b.depth == snappedf(track.bounds.size.y, 0.01), "bounds are {x, z, width, depth} from Track.bounds")
	var notes: Array = mine.paceNotes
	var sorted := true
	for i in range(1, notes.size()):
		sorted = sorted and notes[i].distance >= notes[i - 1].distance
	var corners := notes.filter(func(n: Dictionary) -> bool: return n.text.begins_with("LEFT") or n.text.begins_with("RIGHT") or n.text.begins_with("HAIRPIN"))
	check(sorted and notes[0].text == "START" and notes[-1].text == "FINISH", "pace notes sorted, START to FINISH")
	check(corners.size() >= 10, "%d corner calls from the centreline's radii" % corners.size())
	# The tightest bend on the stage is the hairpin, and it's called as one.
	var hp := notes.filter(func(n: Dictionary) -> bool: return n.text.begins_with("HAIRPIN"))
	check(hp.size() == 1 and absf(hp[0].distance - 1771.0) < 30.0, "one HAIRPIN, at ~1770 m")


## Item 9: every landmark, the seven callouts included, with stage distances.
func test_landmarks_exported() -> void:
	print("landmarks in the track file")
	var mine: Dictionary = Export.export_track(track)
	var by_id := {}
	for m in mine.landmarks:
		by_id[m.id] = m
	var want := {"forestry_gate": 112, "wreck": 560, "fire_tower": 906, "hunting_stand": 1062, "log_landing": 1470, "outhouse": 2078, "campsite": 2214}
	var ok := true
	var spawn_at := Export.project(track.centerline, Export.cumulative(track.centerline), track.get_spawn().global_position)
	for id in want:
		ok = ok and by_id.has(id) and absf(by_id[id].distance - (want[id] - spawn_at)) <= 3.0
	check(ok, "the 7 callouts, each within 3 m of its build distance less the spawn's %.0f m" % spawn_at)
	check(by_id.has("wooden_bridge") and by_id.has("ranger_cabin") and by_id.has("sawmill") and mine.landmarks.size() == 10, "and the three big ones: 10 in all")
	var labels: Array = mine.paceNotes.map(func(n: Dictionary) -> String: return n.text)
	ok = true
	for m in mine.landmarks:
		ok = ok and labels.has(m.label)
	check(ok, "each landmark has its own pace note")


## Item 5a/b: tripMeter is honoured, and with the live marker off nothing on
## the map moves for the car, whatever else changes.
func test_trip_meter_and_marker() -> void:
	print("trip meter and live marker")
	main._on_session({"assists": {"liveMarker": false, "tripMeter": false, "paceNotes": false}}, "")
	await process_frame # process_frame fires before _process: wait for the next one
	await process_frame
	check(not main.trip_meter and main.hud.text.contains("(assist off)"), "trip meter off: the probe HUD says so")
	main._on_session({"assists": {"tripMeter": true}}, "")
	await process_frame
	await process_frame
	check(main.trip_meter and not main.hud.text.contains("(assist off)"), "and on again")
	main._on_session({"assists": {"liveMarker": false}}, "")
	await place(track.get_spawn().global_transform)
	var before := _map_tree_state()
	await drive(1.5, 0.0, 1.0)
	await drive(1.0, -1.0, 1.0)
	for f in 3:
		await process_frame
	check(_map_tree_state() == before, "marker off: no node under the map moved, turned, scaled, showed or hid while driving")
	main._on_race_event({"kind": "assists", "liveMarker": true})
	await place(track.get_spawn().global_transform)
	await drive(1.0, 0.0, 1.0)
	await process_frame
	check(map.gps_enabled and _map_tree_state() != before, "marker on (assists event): the marker, and only it, moves")
	main._on_race_event({"kind": "assists", "liveMarker": false})
	_probe_session()


## Every CanvasItem under the map: where it is, turned, scaled, shown.
func _map_tree_state() -> Array:
	var out: Array = [map.get_global_rect()]
	var stack: Array[Node] = [map]
	while stack.size():
		var n: Node = stack.pop_back()
		if n is CanvasItem:
			var ci := n as CanvasItem
			out.append([n.name, ci.get_global_transform(), ci.visible, ci.modulate])
		if n is SubViewport:
			continue
		for c in n.get_children():
			stack.append(c)
	return out


## Item 5c: assists.camera3d off is spec §4.3's map-only mode.
func test_map_only() -> void:
	print("map only")
	var small := map.get_global_rect()
	main._on_session({"assists": {"liveMarker": false, "tripMeter": false, "paceNotes": false, "camera3d": false}}, "")
	await process_frame
	var vp := main.get_viewport()
	check(main.map_only and vp.disable_3d, "Nightmare's assists: no 3D rendering at all")
	var shade := main.get_node("UI/MapOnly") as Control
	check(shade.visible and shade.get_index() < map.get_index(), "a backdrop and a MAP ONLY note under the map")
	var r := map.get_global_rect()
	var vs := vp.get_visible_rect().size
	check(r.size.x > small.size.x * 1.5 and absf(r.get_center().x - vs.x * 0.5) < 2.0, "the map takes the screen, centred (%s)" % r)
	var mode: int = main.cam.mode
	main.cycle_camera()
	check(main.cam.mode == mode, "Y does nothing")
	await place(track.get_spawn().global_transform)
	var before := _map_tree_state()
	await drive(1.5, 0.5, 1.0)
	await process_frame
	check(_map_tree_state() == before, "map only, marker off: still nothing on the map moves")
	check(car.global_position.distance_to(track.get_spawn().global_position) > 10.0, "the car still drives (it just can't be seen)")
	main._on_race_event({"kind": "assists", "camera3d": true})
	await process_frame
	check(not vp.disable_3d and not shade.visible and map.get_global_rect() == small, "camera3d back on: 3D back, map back in its corner")
	check(map.render_count == 1, "and the map was never re-rendered")
	_probe_session()


func _ghost_relay(team: int, p: Vector3, yaw := 0.0, color := "#56b4e9") -> Dictionary:
	return {"t": "ghost", "teamId": team, "color": color, "tick": 1, "position": [p.x, p.y, p.z], "heading": yaw, "speed": 20.0}


## Item 6: ghost cars.
func test_ghosts() -> void:
	print("ghosts")
	var g: GhostCars = main.ghosts
	main._on_session({"teamColor": "#e69f00", "teamNumber": 1, "teamShape": "circle", "ghosts": true}, "")
	await place(track.get_spawn().global_transform)
	g.set_process(false) # the test drives the clock
	var mats0: int = main.weather.materials().size()
	var o := car.global_position + Vector3(0, 0, -40)
	g.clock = 10.0
	g.receive(2, _ghost_relay(2, o))
	g.clock = 10.1
	g.receive(2, _ghost_relay(2, o + Vector3(10, 0, 0)))
	g.clock = 10.2
	g.receive(2, _ghost_relay(2, o + Vector3(20, 0, 0), 0.5))
	var node := g.ghost_node(2)
	check(g.count() == 1 and node != null, "a rival's snapshots make one ghost")
	g.clock = 10.27
	g._process(0.0)
	check(absf(node.global_position.x - (o.x + 15.0)) < 0.05, "drawn 120 ms behind, interpolated (x %+.2f, want +15)" % (node.global_position.x - o.x))
	check(absf(node.global_rotation.y - 0.25) < 0.01, "heading interpolated too (%.3f)" % node.global_rotation.y)
	g.clock = 10.5
	g._process(0.0)
	check(absf(node.global_position.x - (o.x + 35.0)) < 0.05, "late snapshot: carries on 150 ms at most, then waits (x %+.2f)" % (node.global_position.x - o.x))
	# Never on the map, in every camera.
	var meshes := node.find_children("*", "VisualInstance3D", true, false)
	var layers_ok := meshes.size() == 2
	for m in meshes:
		layers_ok = layers_ok and (m as VisualInstance3D).layers == GhostCars.LAYER and ((m as VisualInstance3D).layers & MapController.CULL_MASK) == 0
	check(layers_ok, "one mesh and one number, render layer 6 only: the map camera never draws them")
	check(node.find_children("*", "CollisionObject3D", true, false).is_empty() and node.find_children("*", "CollisionShape3D", true, false).is_empty(), "no physics body anywhere in a ghost")
	var cams_ok := true
	for mode in [FollowCamera.Mode.TOP_DOWN, FollowCamera.Mode.CHASE, FollowCamera.Mode.BONNET]:
		main.set_camera_mode(mode)
		await process_frame
		cams_ok = cams_ok and (main.cam.cull_mask & GhostCars.LAYER) != 0
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	check(cams_ok, "top-down, chase and bonnet all draw layer 6")
	# Team colour, team number.
	var cols: PackedColorArray = (node.get_node("Body") as MeshInstance3D).mesh.surface_get_arrays(0)[Mesh.ARRAY_COLOR]
	var sky := Color("56b4e9")
	var painted := 0
	for c in cols:
		if absf(c.h - sky.h) < 0.03 and c.s > 0.4:
			painted += 1
	check(painted > 500, "body in the rival's colour (%d sky-blue vertices)" % painted)
	check((node.get_node("Number") as Label3D).text == "2", "with its team number")
	# Fade by distance to our car.
	var far_a := g.ghost_alpha(2)
	for t in [10.6, 10.7, 10.8]:
		g.clock = t
		g.receive(2, _ghost_relay(2, car.global_position + Vector3(1.5, 0, 0)))
	g.clock = 11.0
	g._process(0.0)
	var near_a := g.ghost_alpha(2)
	check(far_a > 0.75 and near_a < 0.3, "faded beside our car (%.2f), solid-ish away from it (%.2f)" % [near_a, far_a])
	# Junk, our own team, a disabled stage.
	g.receive(3, {"position": [1, 2], "heading": 0.0})
	g.receive(3, {"position": [1, NAN, 3], "heading": 0.0})
	g.receive(1, _ghost_relay(1, o))
	check(g.count() == 1, "malformed relays and our own team's are dropped")
	check(main.weather.materials().size() == mats0 + 1, "one weather-registered material per ghost")
	# Stops sending: gone.
	g.clock = 13.1
	g._process(0.0)
	check(g.count() == 0 and main.weather.materials().size() == mats0, "despawned 2 s after its last snapshot, material released")
	main._on_session({"ghosts": false}, "")
	g.receive(2, _ghost_relay(2, o))
	check(g.count() == 0, "solo stage (ghosts: false): relays ignored")
	g.set_process(true)
	_probe_session()


## A ghost parked on the road ahead: we drive straight through it.
func test_ghosts_no_collision() -> void:
	print("ghosts don't collide")
	var g: GhostCars = main.ghosts
	await place(track.get_spawn().global_transform)
	var ahead := car.global_position + fwd() * 12.0
	g.receive(3, _ghost_relay(3, ahead, car.global_rotation.y, "#009e73"))
	impacts.clear()
	var start := car.global_position
	for f in 150:
		if f % 10 == 0:
			g.receive(3, _ghost_relay(3, ahead, car.global_rotation.y, "#009e73"))
		car.set_control(0.0, 1.0, 0.0)
		await physics_frame
	var moved := (car.global_position - start).dot(fwd())
	check(moved > 20.0 and impacts.is_empty(), "through the ghost: %.0f m, no impact" % moved)
	# Draw cost of a handful: each ghost is 2 instances (mesh + number).
	for i in 3:
		g.receive(4 + i, _ghost_relay(4 + i, ahead + Vector3(6 * i, 0, 0)))
	var inst := 0
	var tris := 0
	for c in g.get_children():
		for m in c.find_children("*", "MeshInstance3D", true, false):
			inst += 1
			var arr := (m as MeshInstance3D).mesh.surface_get_arrays(0)
			var idx: Variant = arr[Mesh.ARRAY_INDEX]
			tris += ((idx as PackedInt32Array).size() if idx else (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
		inst += c.find_children("*", "Label3D", true, false).size()
	print("    4 ghosts: %d instances, %d mesh triangles" % [inst, tris])
	check(inst == 8, "4 ghosts = 8 instances (one mesh, one number each)")
	check(tris > 4 * 1800 and tris < 4 * 2600, "the whole car in each merged mesh (%d triangles a ghost)" % (tris / 4))
	g.clear()


## Item 7: our own car in the team's livery.
func test_team_paint() -> void:
	print("team paint")
	var body := car.get_node("Visual/Body") as MeshInstance3D
	var baked: ArrayMesh = body.get_meta("baked_mesh", body.mesh)
	var base: PackedColorArray = baked.surface_get_arrays(0)[Mesh.ARRAY_COLOR]
	main._on_session({"teamColor": "#cc79a7", "teamNumber": 4, "teamShape": "diamond"}, "")
	var cols: PackedColorArray = body.mesh.surface_get_arrays(0)[Mesh.ARRAY_COLOR]
	var paint := 0
	var kept := true
	var hue_ok := true
	for i in base.size():
		if CarPaint.is_paint(base[i]):
			paint += 1
			hue_ok = hue_ok and absf(cols[i].h - Color("cc79a7").h) < 0.02
		else:
			kept = kept and cols[i] == base[i]
	check(paint > 500 and hue_ok, "%d paint vertices, all in purple" % paint)
	check(kept, "glass, trim and tyres untouched")
	check((car.get_node("Visual/Body/Roundel/Number") as Label3D).text == "4", "number 4 on the roof")
	check((car.get_node("Visual/Body/Roundel") as MeshInstance3D).mesh == CarPaint.plate_mesh("diamond"), "on a diamond plate")
	main._on_session({"teamColor": "#56b4e9", "teamNumber": 2, "teamShape": "square"}, "")
	var once := body.mesh
	main._on_session({"teamColor": "#cc79a7", "teamNumber": 4, "teamShape": "diamond"}, "")
	main._on_session({"teamColor": "#56b4e9", "teamNumber": 2, "teamShape": "square"}, "")
	check(body.mesh == once, "repaints always start from the baked paint (no drift)")
	main._on_session({"teamColor": "#e69f00", "teamNumber": 1, "teamShape": "nonsense"}, "")
	check((car.get_node("Visual/Body/Roundel") as MeshInstance3D).mesh == CarPaint.plate_mesh("circle"), "an unknown shape gets a circle")
	_probe_session()


## Item 8: the debug HUD is the probe's, not the room's.
func test_room_hud() -> void:
	print("debug HUD")
	main._on_session({"room": true}, "")
	await process_frame
	await process_frame
	check(not main.hud.visible, "room build: hidden")
	_probe_session()
	await process_frame
	check(main.hud.visible, "probe: shown")


# --- big map ---------------------------------------------------------------------

var map_events: Array = []


func _map_event(ev: Dictionary) -> void:
	if ev.get("kind") == "map":
		map_events.append(ev.get("open"))


## A click: press and release at a canvas point, through the root viewport
## like a real mouse.
func click(at: Vector2) -> void:
	for down in [true, false]:
		var e := InputEventMouseButton.new()
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = down
		e.position = at
		e.global_position = at
		root.push_input(e, true)
	await process_frame


## A finger: a screen touch through Input, which (emulate_mouse_from_touch,
## the default) is how a phone's tap reaches the GUI.
func tap(at: Vector2) -> void:
	var win: Vector2 = root.get_final_transform() * at
	for down in [true, false]:
		var t := InputEventScreenTouch.new()
		t.index = 0
		t.pressed = down
		t.position = win
		Input.parse_input_event(t)
		Input.flush_buffered_events()
	await process_frame


func key(code: Key) -> void:
	for down in [true, false]:
		var k := InputEventKey.new()
		k.physical_keycode = code
		k.keycode = code
		k.pressed = down
		Input.parse_input_event(k)
		Input.flush_buffered_events()
	await process_frame


## Game seconds, not frames: with --fixed-fps 60 a frame is 1/60 s, without
## it a headless frame is whatever the machine manages, and the map's tween
## runs on the same clock as this timer either way.
func wait_s(seconds: float) -> void:
	await create_timer(seconds).timeout
	await process_frame


## Long enough for the open / close animation to finish.
func settle() -> void:
	await wait_s(main.MAP_ANIM_S + 0.04)


func _map_centre() -> Vector2:
	return map.get_global_rect().get_center()


## Open and close by every input: mouse, touch, keyboard, the X, outside.
func test_big_map_inputs() -> void:
	print("big map: open and close")
	_probe_session()
	if not main.bridge.physics_event.is_connected(_map_event):
		main.bridge.physics_event.connect(_map_event)
	map_events.clear()
	var small := map.get_global_rect()
	var vs := main.get_viewport().get_visible_rect().size
	await click(_map_centre())
	check(main.map_expanded, "a click on the corner map opens it")
	check(map_events == [true], "and the bridge hears {kind: map, open: true} (%s)" % [map_events])
	# Mid-flight, then done within the budget (the click above took a frame).
	await create_timer(0.05).timeout
	var mid := map.get_global_rect()
	check(mid.size.x > small.size.x and mid.size.x < main._big_map_rect().size.x, "animated: part way after 50 ms (%s)" % mid)
	await create_timer(0.15).timeout
	var big := map.get_global_rect()
	check(big.is_equal_approx(main._big_map_rect()), "fully open inside 200 ms")
	check(big.size.x > small.size.x * 2.5 and big.size.y > small.size.y * 2.0, "most of the screen (%s of %s)" % [big, vs])
	check(Rect2(Vector2.ZERO, vs).encloses(big) and big.position.y > 0.0 and big.end.x < vs.x, "with a margin all round")
	check(map.detail and map.big, "detail on: labels and checkpoint numbers")
	check(main._map_scrim.visible, "the 3D view is dimmed behind it")
	check(main.get_viewport().scaling_3d_scale < 1.0, "and drawn at reduced resolution while covered (%s)" % main.get_viewport().scaling_3d_scale)
	await tap(_map_centre())
	check(main.map_expanded and map_events == [true] and map.pin != null, "a tap on the big map doesn't close it: it places the guess pin")
	map.restore_pins({})
	await key(KEY_ESCAPE)
	check(not main.map_expanded and map_events == [true, false], "Esc closes it, and says so")
	await settle()
	check(map.get_global_rect().is_equal_approx(small) and not map.detail and not main._map_scrim.visible, "back in its corner, labels off, no dimming")
	check(is_equal_approx(main.get_viewport().scaling_3d_scale, 1.0), "3D back at full resolution")
	await tap(_map_centre())
	await settle()
	check(main.map_expanded, "a touch on the corner map opens it too")
	var corner: Control = map.get_node("Corner")
	var cr := corner.get_global_rect()
	check(corner.visible and map.get_global_rect().encloses(cr) and cr.size.x >= 40.0 and cr.get_center().x > map.get_global_rect().get_center().x, "an X in the big map's top-right, at least 40 px")
	await click(cr.get_center())
	await settle()
	check(not main.map_expanded, "the X closes it")
	await key(KEY_M)
	await settle()
	check(main.map_expanded and map.get_global_rect().is_equal_approx(main._big_map_rect()), "M opens it")
	await key(KEY_M)
	await settle()
	check(not main.map_expanded, "M again closes it")
	await key(KEY_M)
	await settle()
	await key(KEY_ESCAPE)
	await settle()
	check(not main.map_expanded and map.get_global_rect().is_equal_approx(small), "Esc closes it")
	map_events.clear()
	await key(KEY_ESCAPE)
	check(not main.map_expanded and map_events.is_empty(), "Esc on a closed map: nothing, and no event")
	await click(_map_centre())
	await settle()
	var outside := Vector2(map.get_global_rect().position.x * 0.5, vs.y * 0.5)
	await click(outside)
	await settle()
	check(not main.map_expanded and map_events == [true, false], "a click outside it (on the dimmed 3D) closes it")
	# Turned round mid-flight: the state follows the last tap.
	await click(_map_centre())
	await process_frame
	await click(_map_centre())
	await settle()
	check(not main.map_expanded and map.get_global_rect().is_equal_approx(small), "open then close mid-animation lands closed, in the corner")
	map_events.clear()


## Every camera mode: opens, stays open through Y, closes.
func test_big_map_modes() -> void:
	print("big map: camera modes")
	_probe_session()
	for m in [0, 1, 2]:
		main.set_camera_mode(m)
		await process_frame
		await click(_map_centre())
		await settle()
		var ok: bool = main.map_expanded and map.get_global_rect().is_equal_approx(main._big_map_rect()) and not main.get_viewport().disable_3d
		await click((map.get_node("Corner") as Control).get_global_rect().get_center())
		await settle()
		check(ok and not main.map_expanded, "%s: opens over the running 3D view and closes" % main.CAMERA_MODES[m])
	main.set_map_expanded(true, false)
	var before: int = main.cam.mode
	main.cycle_camera()
	await process_frame
	check(main.cam.mode != before and main.map_expanded, "Y switches the camera underneath; the map stays open")
	main.set_map_expanded(false, false)
	main.set_camera_mode(0)
	_probe_session()


## The big map is the same one render: same image, same cull mask (never the
## eggs on layer 5, never the ghosts on layer 6), and with the live marker
## off, nothing on it moves for the car or points at it.
func test_big_map_static() -> void:
	print("big map: static")
	_probe_session()
	map.gps_enabled = false
	var tex := map.image_rect.texture
	main.set_map_expanded(true, false)
	await process_frame
	check(map.render_count == 1 and map.image_rect.texture == tex, "the same image, not a new render")
	var cam := map.map_camera()
	check((MapController.CULL_MASK & (16 | 32)) == 0 and (cam == null or cam.cull_mask == MapController.CULL_MASK), "map camera's cull mask still skips layers 5 (eggs) and 6 (ghosts)")
	check((EasterEggs.LAYER | GhostCars.LAYER) & MapController.CULL_MASK == 0, "and those are the layers eggs and ghosts use")
	var marker: Polygon2D = map.image_rect.get_node("GpsMarker")
	check(not marker.visible, "liveMarker off: no car marker on the big map")
	var d := map.detail_items()
	check(d.checkpoints == [1, 2, 3, 4, 5], "checkpoints numbered 1-5 (%s)" % [d.checkpoints])
	var labels: Array = d.labels
	var want := _callouts().map(func(l: Node) -> String: return String(l.get_meta("label")))
	check(want.all(func(w: String) -> bool: return labels.has(w)) and labels.has("start") and labels.has("finish"), "every landmark labelled, plus start and finish")
	check(not labels.any(func(l: String) -> bool: return l.contains("car") and l != "wrecked car"), "no label for the car")
	await place(track.get_spawn().global_transform)
	var before := _map_tree_state()
	await drive(1.5, 0.4, 1.0)
	for f in 3:
		await process_frame
	check(_map_tree_state() == before and not marker.visible, "marker off, map open: nothing under the map moved, scaled or showed while driving")
	map.gps_enabled = true
	await process_frame
	check(marker.visible and marker.scale.x > 1.0, "marker on: it shows, sized for the big map")
	map.gps_enabled = false
	main.set_map_expanded(false, false)
	await process_frame
	check(marker.scale.x == 1.0, "and back to its corner size after")
	_probe_session()


## Map-only (camera3d off): the map is already the main view, so a tap,
## M or Esc does nothing; and opening it first doesn't strand it.
func test_big_map_map_only() -> void:
	print("big map: map-only mode")
	_probe_session()
	var small := map.get_global_rect()
	main.set_map_expanded(true, false)
	map_events.clear()
	main._on_race_event({"kind": "assists", "camera3d": false})
	await process_frame
	check(main.map_only and not main.map_expanded and map_events == [false], "going map-only closes the big map first, and says so")
	var r := map.get_global_rect()
	await click(_map_centre())
	await key(KEY_M)
	await settle()
	check(not main.map_expanded and map.get_global_rect() == r and main.get_viewport().disable_3d, "map-only: a click and M change nothing")
	check(map_events == [false], "and no map event")
	map.restore_pins({}) # that click left a guess pin (pin_tests.gd has the rest)
	check(map.detail and not (map.get_node("Corner") as Control).visible, "labels shown on the map-only map; no expand hint")
	main._on_race_event({"kind": "assists", "camera3d": true})
	await process_frame
	check(map.get_global_rect() == small and not map.detail and not main.get_viewport().disable_3d, "camera3d back: corner map, labels off")
	await click(_map_centre())
	await settle()
	check(main.map_expanded, "and it opens again")
	main.set_map_expanded(false, false)
	check(map.render_count == 1, "still one map render through all of it")
	_probe_session()


# --- stage two: Dust Devil ------------------------------------------------------

const DustBuilder := preload("res://tools/build_dust_devil.gd")


## A fresh main scene with track_id set before it enters the tree (what
## --track=, ?track= and a session's trackId all end up doing).
func _boot(id: String) -> void:
	if main:
		main.queue_free()
		await process_frame
	main = load("res://scenes/main.tscn").instantiate()
	main.track_id = id
	root.add_child(main)
	await process_frame
	await process_frame
	car = main.car
	track = main.track
	map = main.map
	car.keyboard_enabled = false
	car.impact.connect(func(sp: float, _w: Object) -> void: impacts.append(sp))


func test_track_by_id() -> void:
	print("stage by id")
	check(main.available_tracks().has("pine_panic") and main.available_tracks().has("dust_devil"), "both stages in the build: %s" % [main.available_tracks()])
	await _boot("no_such_stage")
	check(track != null and track.track_id == "pine_panic", "an unknown id falls back to Pine Panic")
	await _boot("dust_devil")
	var tracks := main.get_children().filter(func(c: Node) -> bool: return c is Track)
	check(track.track_id == "dust_devil" and tracks.size() == 1, "track_id dust_devil loads Dust Devil, and only it")
	check(track.get_biome().id == "desert" and track.difficulty == "medium", "desert biome, medium")
	check(main.weather.style == "dust", "the weather is dust, not mist")
	main._on_session({"seed": 7, "trackId": "dust_devil"}, "")
	check(main.track == track and track.is_inside_tree(), "a session for the loaded stage doesn't reload it")


func test_dust_devil() -> void:
	print("dust devil")
	check(track.get_checkpoints().size() == 5 and track.get_landmarks().filter(func(l: Node) -> bool: return not l.has_meta("callout")).size() == 3,
		"5 checkpoints, 3 big landmarks (arch, fuel drums, radio tower)")
	var forks := track.get_forks()
	check(forks.size() == 3, "three forks")
	var sides := forks.map(func(f: Node) -> String: return String(f.get_meta("keep")))
	check(sides.has("left") and sides.has("right"), "and they don't all go the same way: %s" % [sides])
	# No checkpoint between a loop's two ends.
	var ok := true
	for f in forks:
		if f.get_meta("kind") == "loop":
			for cp in track.get_checkpoints():
				var d := float(cp.get_meta("distance_m"))
				ok = ok and not (d > float(f.get_meta("distance_m")) and d < float(f.get_meta("rejoin_m")))
	check(ok, "no checkpoint inside the loop")
	# The terrain flood: from before each gate, with the gate in the way,
	# the road after it can't be reached; with it out of the way, it can.
	var t: Terrain = track.get_node("Ground")
	var sealed := true
	var open := true
	var gates: Array = track.get_checkpoints()
	gates.append(track.get_finish())
	var nowhere := Area3D.new()
	var ncs := CollisionShape3D.new()
	ncs.name = "Shape"
	ncs.shape = BoxShape3D.new()
	nowhere.add_child(ncs)
	nowhere.transform = Transform3D(Basis.IDENTITY, Vector3(1e5, 0, 1e5))
	for gate in gates:
		var i := int(float(gate.get_meta("distance_m")) / 2.0)
		var c := track.centerline
		var after := DustBuilder._cell_of(t, c[mini(i + 14, c.size() - 1)])
		var reached := DustBuilder.flood_from_gate(t, gate, c[maxi(i - 15, 0)])
		for j in range(i + 12, c.size(), 4):
			sealed = sealed and not reached.has(DustBuilder._cell_of(t, c[j]))
		open = open and DustBuilder.flood_from_gate(t, nowhere, c[maxi(i - 15, 0)]).has(after)
	nowhere.free()
	check(sealed, "no way round any gate: every fork and the open ground behind it are walled off")
	check(open, "and the same flood does reach past each gate when it isn't in the way")
	# Spurs are real road: drawn, and the surface probe says road on them.
	var space := track.get_world_3d().direct_space_state
	var spur_ok := true
	for f in forks:
		var name := String(f.get_meta("spur"))
		spur_ok = spur_ok and track.get_node("Road").has_node("%sMesh0" % name) and track.get_node("Road").has_node("%sShape" % name)
	check(spur_ok, "each spur has road meshes and a road probe")
	check(car.SURFACES.has("sand") and track.get_node("Verge").get_meta("surface") == "sand", "the verge is sand")
	# Eggs: the desert kinds have spots, and none of them ever reach the map.
	var eggs: EasterEggs = main.eggs
	var counts := eggs.spot_counts()
	check(counts.tumbleweed == 6 and counts.roadrunner == 3 and counts.vultures == 2 and counts.skull == 1 and counts.ufo == 1 and counts.deer == 0,
		"desert egg spots: %s" % [counts])
	map.gps_enabled = false
	for f in 4:
		await process_frame
	var s0 := _map_state()
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
		await process_frame
	check(kinds.size() == 5, "every desert kind comes alive when forced: %s" % [kinds.keys()])
	check(layers_ok, "every egg node is on layer 5 only")
	check(_map_state() == s0 and map.render_count == 1, "map unchanged with every desert egg out")
	var a := EasterEggs.make_schedule(1234, counts)
	check(a == EasterEggs.make_schedule(1234, counts) and a != EasterEggs.make_schedule(1235, counts), "same seed, same desert surprises")
	eggs.force = {}
	eggs.configure(4242)
	# Both stages in the exported file, this one current.
	var raw := FileAccess.get_file_as_string(ProjectSettings.globalize_path("res://../data/tracks.json").simplify_path())
	var file: Dictionary = JSON.parse_string(raw)
	var ids: Array = file.tracks.map(func(x: Dictionary) -> String: return x.id)
	var theirs: Dictionary = file.tracks.filter(func(x: Dictionary) -> bool: return x.id == "dust_devil")[0] if ids.has("dust_devil") else {}
	check(ids.has("pine_panic") and ids.has("dust_devil"), "data/tracks.json has both stages")
	check(JSON.parse_string(Export._fmt(Export.export_track(track), "")) == theirs, "Dust Devil's entry is current")
	var keeps: Array = theirs.get("paceNotes", []).filter(func(nn: Dictionary) -> bool: return String(nn.text).begins_with("KEEP"))
	check(keeps.size() == 3, "three KEEP pace notes, one per fork")
	# And the autopilot drives it: every checkpoint, in order, then the finish.
	await test_autopilot_stage()
