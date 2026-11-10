extends RefCounted
## The buggy, getting in and out, and the reset, over main.tscn on layout_1.
## Run from run_tests.gd, with its helpers and its pass/fail count. Flat
## ground is a slab well over the terrain, as in walker_tests.

var t ## the runner (run_tests.gd)
var main: Node3D
var walker: Walker
var buggy: Buggy
var avatar: PlayerAvatar
var rig: RigCamera
var field: TerrainField


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("driving")
	main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	field = main.field
	walker = main.walker
	buggy = main.buggy
	avatar = main.avatar
	rig = main.rig
	if field == null or buggy == null or avatar == null:
		check(false, "main has a field, a buggy and an avatar")
		main.queue_free()
		return
	walker.input_enabled = false
	buggy.input_enabled = false
	await test_spawn()
	await test_top_speed()
	await test_ramps()
	await test_enter()
	await test_exit_right()
	await test_exit_roof()
	await test_exit_behind()
	await test_exit_nowhere()
	await test_scramble_then_ride()
	await test_parked_on_slope()
	await test_reset()
	await test_reset_tilted()
	await test_drift_tilted()
	main.queue_free()
	await t.process_frame


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _frames(n: int) -> void:
	for i in n:
		await t.physics_frame


func _ground(p: Vector3) -> float:
	return field.height_at(p.x, p.z)


func _box(size: Vector3, centre: Vector3) -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = 1
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = size
	cs.shape = s
	b.add_child(cs)
	main.add_child(b)
	b.global_position = centre
	return b


## A flat 40 × 40 m slab 30 m over the spawn; returns [body, top].
func _pad() -> Array:
	var top := field.spawn.y + 30.0
	return [_box(Vector3(40, 1, 40), Vector3(field.spawn.x, top - 0.5, field.spawn.z)), top]


## Buggy at `at`, facing -Z, still, nobody on the pedals.
func _park(at: Vector3) -> void:
	buggy.set_control(0, 0, 0)
	buggy.global_transform = Transform3D(Basis.IDENTITY, at)
	buggy.velocity = Vector3.ZERO
	buggy.reset_physics_interpolation()
	main.streamer.ensure_around(at)


func _put_walker(at: Vector3) -> void:
	walker.set_move(Vector2.ZERO, false, false)
	walker.global_position = at
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()


## Is the walker's capsule, where it stands now, clear of the world?
func _walker_clear() -> bool:
	var p := PhysicsShapeQueryParameters3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = Walker.RADIUS
	cap.height = Walker.HEIGHT
	p.shape = cap
	p.transform = Transform3D(Basis.IDENTITY, walker.global_position + Vector3(0, Walker.HEIGHT * 0.5, 0))
	p.collision_mask = 1
	return main.get_world_3d().direct_space_state.intersect_shape(p, 1).is_empty()


func _get_out_if_in() -> void:
	if avatar.mode == &"driving":
		avatar.interact()
	await _frames(1)


func test_spawn() -> void:
	await _frames(20)
	var s := field.spawn
	var right := Vector3(cos(field.spawn_yaw), 0, -sin(field.spawn_yaw))
	var want := s + right * 6.0
	var p := buggy.global_position
	check(Vector2(p.x, p.z).distance_to(Vector2(want.x, want.z)) < 0.3, "buggy parks 6 m right of the spawn")
	check(absf(p.y - _ground(p)) < 0.5, "and sits on the ground (%.2f m off)" % (p.y - _ground(p)))
	var fwd := -buggy.global_basis.z
	check(absf(angle_difference(atan2(-fwd.x, -fwd.z), field.spawn_yaw)) < 0.05, "facing the way the walker does")
	check(buggy.collision_layer == 2, "buggy is on layer 2")
	check(main.watched.has(buggy), "the fall check watches the buggy")
	check(avatar.mode == &"foot" and main.focus == walker, "you start on foot, and the streamer follows the walker")
	# Placed over the highest ground under its footprint, so no end starts buried.
	var at: Vector3 = main.buggy_spawn()
	var fwd2 := Vector3(-sin(field.spawn_yaw), 0, -cos(field.spawn_yaw))
	var right2 := Vector3(-fwd2.z, 0, fwd2.x)
	var buried := 0.0
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			var c: Vector3 = at + right2 * sx * Buggy.BOX.x * 0.5 + fwd2 * sz * Buggy.BOX.z * 0.5
			buried = maxf(buried, _ground(c) - at.y)
	check(buried < 0.001, "the buggy's spawn clears the ground under all four corners (%.2f m buried)" % buried)


func test_top_speed() -> void:
	# 300 m of flat slab along z in [-150, 150], over anything the terrain has there.
	var x := clampf(field.spawn.x, -700.0, 700.0)
	var high := -INF
	for z in range(-160, 161, 4):
		for dx in [-10.0, 0.0, 10.0]:
			high = maxf(high, field.height_at(x + dx, z))
	var top := high + 20.0
	var slab := _box(Vector3(20, 1, 300), Vector3(x, top - 0.5, 0))
	_park(Vector3(x, top + 0.05, 140))
	await _frames(10)
	buggy.set_control(0, 1, 0)
	var peak := 0.0
	for i in 480:
		await t.physics_frame
		peak = maxf(peak, buggy.forward_speed)
	buggy.set_control(0, 0, 0)
	var v := buggy.forward_speed
	check(absf(v - 15.3) <= 1.0, "8 s of full throttle on the flat reaches %.2f m/s (15.3 ± 1)" % v)
	check(peak <= 15.8, "and never goes over 15.8 m/s (peak %.2f)" % peak)
	slab.queue_free()
	await _frames(1)


## Throttle for 5 s at the foot of a 16 m ramp of `deg` degrees: how high did it get?
func _climb(deg: float) -> float:
	var pad: Array = _pad()
	var top: float = pad[1]
	var s := field.spawn
	var a := deg_to_rad(deg)
	var foot := s.z + 11.0
	# Rises towards -Z. Sunk by its half thickness, so the top face starts flush with the pad.
	var ramp := _box(Vector3(6, 0.4, 16), Vector3(s.x, top + 8.0 * sin(a) - 0.2 / cos(a), foot - 8.0 * cos(a)))
	ramp.rotation.x = a
	_park(Vector3(s.x, top + 0.05, foot + 3.5))
	await _frames(10)
	var y0 := buggy.global_position.y
	buggy.set_control(0, 1, 0)
	var peak := y0
	for i in 300:
		await t.physics_frame
		peak = maxf(peak, buggy.global_position.y)
	buggy.set_control(0, 0, 0)
	ramp.queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)
	return peak - y0


func test_ramps() -> void:
	var up25 := await _climb(25.0)
	check(up25 > 5.0, "it climbs a 25° ramp (%.2f m up)" % up25)
	var up45 := await _climb(45.0)
	check(up45 < 2.0, "but not a 45° one (%.2f m up in 5 s)" % up45)


## Buggy on a pad, walker `d` m left of the driver's door point.
func _beside(d: float) -> Array:
	var pad: Array = _pad()
	var top: float = pad[1]
	var s := field.spawn
	_park(Vector3(s.x, top + 0.05, s.z))
	var door := buggy.to_global(PlayerAvatar.DOOR)
	_put_walker(Vector3(door.x - d, top + 0.05, door.z))
	await _frames(10)
	return pad


func test_enter() -> void:
	var pad: Array = await _beside(5.0)
	check(not avatar.interact() and avatar.mode == &"foot", "interact 5 m from the door does nothing")
	var top: float = pad[1]
	var door := buggy.to_global(PlayerAvatar.DOOR)
	_put_walker(Vector3(door.x - 2.0, top + 0.05, door.z))
	await _frames(2)
	check(avatar.interact(), "interact 2 m from the door gets in")
	check(avatar.mode == &"driving" and not walker.visible, "now driving, the walker hidden")
	check(buggy.driver == walker and main.focus == buggy, "the buggy has a driver, and the streamer follows it")
	await _frames(30)
	check(rig.target == buggy and absf(rig.arm.spring_length - RigCamera.PROFILES[&"drive"].length) < 0.01,
		"the camera follows the buggy at the drive arm (%.2f m)" % rig.arm.spring_length)
	check(walker.global_position.distance_to(buggy.global_position) < 2.0, "the walker rides in the seat")
	await _get_out_if_in()
	(pad[0] as Node).queue_free()
	await _frames(1)


## Review Focus 4: a wall flush on the left, so you get out on the right.
func test_exit_right() -> void:
	var pad: Array = await _beside(1.0)
	var top: float = pad[1]
	check(avatar.interact(), "got in")
	var p := buggy.global_position
	var half := Buggy.BOX.x * 0.5
	var wall := _box(Vector3(4, 3, 8), Vector3(p.x - half - 2.0 - 0.02, top + 1.5, p.z))
	await _frames(5)
	check(avatar.interact() and avatar.mode == &"foot" and walker.visible, "and out again")
	var rel := walker.global_position - buggy.global_position
	check(rel.x > half, "with the left side walled, you get out on the right (x %+.2f)" % rel.x)
	check(_walker_clear(), "clear of the wall")
	check(rig.target == walker and main.focus == walker, "the camera and the streamer are back on the walker")
	await _frames(30)
	check(walker.is_on_floor() and absf(walker.global_position.y - top) < 0.1, "standing on the ground")
	wall.queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)


func _hemmed_in(top: float) -> Array:
	var p := buggy.global_position
	var half := Buggy.BOX.x * 0.5
	var back := Buggy.BOX.z * 0.5
	return [
		_box(Vector3(4, 3, 8), Vector3(p.x - half - 2.0 - 0.02, top + 1.5, p.z)),
		_box(Vector3(4, 3, 8), Vector3(p.x + half + 2.0 + 0.02, top + 1.5, p.z)),
		_box(Vector3(12, 3, 4), Vector3(p.x, top + 1.5, p.z + back + 2.0 + 0.02)),
	]


func test_exit_roof() -> void:
	var pad: Array = await _beside(1.0)
	var top: float = pad[1]
	check(avatar.interact(), "got in")
	var walls := _hemmed_in(top)
	await _frames(5)
	check(avatar.interact() and avatar.mode == &"foot", "both sides and the back blocked, still gets out")
	await _frames(30)
	var roof := buggy.global_position.y + Buggy.BOX_Y + Buggy.BOX.y * 0.5
	var w := walker.global_position
	check(absf(w.y - roof) < 0.15 and Vector2(w.x, w.z).distance_to(Vector2(buggy.global_position.x, buggy.global_position.z)) < 1.0,
		"onto the roof (feet %.2f m over it)" % (w.y - roof))
	check(_walker_clear(), "clear of the walls")
	for b in walls:
		(b as Node).queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)


func test_exit_behind() -> void:
	var pad: Array = await _beside(1.0)
	var top: float = pad[1]
	check(avatar.interact(), "got in")
	var walls := _hemmed_in(top)
	(walls.pop_back() as Node).queue_free() # the back one
	await _frames(5)
	check(avatar.interact() and avatar.mode == &"foot", "both sides blocked, the back clear: out")
	var rel := walker.global_position - buggy.global_position
	check(rel.z > Buggy.BOX.z * 0.5 and absf(rel.x) < 0.5, "out behind (x %+.2f, z %+.2f)" % [rel.x, rel.z])
	check(_walker_clear(), "clear of the walls")
	for b in walls:
		(b as Node).queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)


func test_exit_nowhere() -> void:
	var pad: Array = await _beside(1.0)
	var top: float = pad[1]
	check(avatar.interact(), "got in")
	var walls := _hemmed_in(top)
	walls.append(_box(Vector3(12, 1, 12), Vector3(buggy.global_position.x, top + Buggy.BOX_Y + Buggy.BOX.y * 0.5 + 1.0, buggy.global_position.z)))
	await _frames(5)
	check(not avatar.interact() and avatar.mode == &"driving" and not walker.visible, "no clear spot at all: you stay in")
	for b in walls:
		(b as Node).queue_free()
	await _frames(2)
	check(avatar.interact() and avatar.mode == &"foot", "walls gone, out you get")
	(pad[0] as Node).queue_free()
	await _frames(1)


func test_reset() -> void:
	var s := field.spawn
	var at := Vector3(s.x + 3, 0, s.z)
	at.y = _ground(at) + 0.3
	_park(at)
	var door := buggy.to_global(PlayerAvatar.DOOR)
	_put_walker(Vector3(door.x, _ground(door) + 0.05, door.z))
	check(avatar.interact(), "got in")
	await _frames(20)
	buggy.set_control(0, 1, 0)
	await _frames(60)
	check(not avatar.reset_vehicle(), "no reset while it's moving (%.1f m/s)" % buggy.forward_speed)
	# Up against a wall, throttle held.
	_park(at)
	await _frames(20)
	var front := buggy.global_position.z - Buggy.BOX.z * 0.5
	var wall := _box(Vector3(6, 6, 1), Vector3(at.x, at.y + 1.0, front - 0.5 - 0.03))
	await _frames(2)
	buggy.set_control(0, 1, 0)
	await _frames(90)
	check(not avatar.reset_vehicle(), "no reset 1.5 s into pushing a wall")
	await _frames(36)
	check(avatar.reset_vehicle(), "after 2.1 s stuck with throttle held, reset works")
	buggy.set_control(0, 0, 0)
	var p := buggy.global_position
	check(absf(p.y - (_ground(p) + 1.0)) < 0.05, "it goes 1 m over the ground")
	check(buggy.global_basis.y.dot(Vector3.UP) > 0.999, "upright")
	await _frames(40)
	p = buggy.global_position
	var n := field.normal_at(p.x, p.z)
	check(buggy.global_basis.y.dot(n) > 0.97, "on its wheels, leaning with the ground (%.3f)" % buggy.global_basis.y.dot(n))
	check(absf(p.y - _ground(p)) < 0.4 and buggy.is_on_floor(), "and back on the ground (%.2f m off)" % (p.y - _ground(p)))
	check(absf(p.x - at.x) < 0.5 and absf(p.z - at.z) < 1.0, "where it was")
	wall.queue_free()
	await _get_out_if_in()
	await _frames(1)


func test_reset_tilted() -> void:
	var s := field.spawn
	var at := Vector3(s.x + 3, 0, s.z)
	at.y = _ground(at) + 2.0
	_park(at)
	buggy.rotate_object_local(Vector3.FORWARD, deg_to_rad(90))
	_put_walker(at + Vector3(0, 0, 40))
	check(not avatar.reset_vehicle(), "on its side but you're 40 m away: no reset")
	_put_walker(at + Vector3(-2.0, 0, 0))
	buggy.rotate_object_local(Vector3.FORWARD, deg_to_rad(-40))
	check(not avatar.reset_vehicle(), "tilted 50° and still: no reset")
	buggy.rotate_object_local(Vector3.FORWARD, deg_to_rad(40))
	check(avatar.reset_vehicle(), "on its side: reset works")
	check(buggy.global_basis.y.dot(Vector3.UP) > 0.999, "and it's upright at once")
	await _frames(40)


## The camera drifts behind a buggy that's pointing straight up a cliff,
## where its -Z has no flat part at all: the heading is in its roof.
func test_drift_tilted() -> void:
	var dummy := Node3D.new()
	main.add_child(dummy)
	var yaw := 0.7
	var h := Vector3(-sin(yaw), 0, -cos(yaw))
	var nose_up := Basis((-h).cross(Vector3.DOWN), -h, Vector3.DOWN)
	dummy.global_transform = Transform3D(nose_up, field.spawn + Vector3(0, 40, 0))
	rig.follow(dummy, &"drive")
	rig.snap()
	rig.yaw = yaw + 1.2
	rig.add_look(Vector2.ZERO)
	for i in 300:
		await t.process_frame
	check(absf(angle_difference(rig.yaw, yaw)) < 0.1, "drift goes behind a nose-up target's heading (%.2f, want %.2f)" % [rig.yaw, yaw])
	# Pitched and rolled on a slope: still its heading.
	dummy.global_transform = Transform3D(Basis.from_euler(Vector3(0.5, yaw, 0.4)), dummy.global_position)
	rig.yaw = yaw - 1.0
	rig.add_look(Vector2.ZERO)
	for i in 300:
		await t.process_frame
	check(absf(angle_difference(rig.yaw, yaw)) < 0.1, "and behind a pitched, rolled one (%.2f)" % rig.yaw)
	rig.follow(walker, &"walk")
	rig.snap()
	dummy.queue_free()


## Getting in mid-scramble ends the scramble, so getting out doesn't drag
## you back to the ledge.
func test_scramble_then_ride() -> void:
	var pad: Array = _pad()
	var top: float = pad[1]
	var s := field.spawn
	_park(Vector3(s.x + 40, top + 0.05, s.z)) # out of the way for now
	await _frames(2) # let it leave before the walker lands where it was
	_put_walker(Vector3(s.x, top + 0.05, s.z))
	rig.yaw = 0.0
	await _frames(20)
	var box := _box(Vector3(2, 0.9, 8), Vector3(s.x, top + 0.45, s.z - 5.5))
	await _frames(2)
	walker.set_move(Vector2(0, 1), false, true)
	for i in 150:
		await t.physics_frame
		if walker.is_scrambling():
			break
	walker.set_move(Vector2.ZERO, false, false)
	check(walker.is_scrambling(), "a scramble started")
	var w := walker.global_position
	_park(Vector3(w.x + 2.0, top + 0.05, w.z + 2.5))
	check(avatar.interact(), "got in mid-scramble")
	await _frames(5)
	check(avatar.interact(), "and out")
	var spot := walker.global_position
	await _frames(30)
	var d := Vector2(walker.global_position.x, walker.global_position.z).distance_to(Vector2(spot.x, spot.z))
	check(not walker.is_scrambling() and d < 0.3, "the walker stays where it got out (%.2f m away)" % d)
	box.queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)


## Nobody in it, nobody on the pedals: it stays put on a 20° slope.
func test_parked_on_slope() -> void:
	var pad: Array = _pad()
	var top: float = pad[1]
	var s := field.spawn
	var a := deg_to_rad(20.0)
	var ramp := _box(Vector3(12, 0.4, 20), Vector3(s.x, top + 6.0, s.z))
	ramp.rotation.x = a
	var n := Vector3(0, cos(a), sin(a))
	_park(ramp.global_position + n * 0.25)
	buggy.global_basis = Basis(Vector3.RIGHT, a) # sitting on it, nose uphill
	await _frames(60)
	var p0 := buggy.global_position
	await _frames(300)
	var moved := buggy.global_position.distance_to(p0)
	check(buggy.is_on_floor() and moved < 0.2, "parked on a 20° ramp, it moves %.3f m in 5 s" % moved)
	ramp.queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)
