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
