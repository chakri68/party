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
	check(track.get_landmarks().size() == 3, "three landmarks (bridge, cabin, sawmill)")
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


func test_bridge_noop() -> void:
	print("bridge")
	var b: WebBridge = main.bridge
	check(not b.connected, "not on web: bridge stays disconnected, no errors")
	b.emit_physics_event({"kind": "test"}) # must be a silent no-op
	var s := b.snapshot()
	for k in ["tick", "position", "heading", "velocity", "speed", "distance", "checkpointHint"]:
		check(s.has(k), "snapshot has %s" % k)
	print("    sample snapshot: ", JSON.stringify(s))
