extends RefCounted
## The walker, the camera rig and main.tscn, over layout_1. Run from
## run_tests.gd, with its helpers and its pass/fail count. Locally (not web)
## main.tscn builds layout_1 by itself in _ready, so that's what we get.

var t ## the runner (run_tests.gd)
var main: Node3D
var walker: Walker
var rig: RigCamera
var field: TerrainField


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("walking")
	main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	field = main.field
	walker = main.walker
	rig = main.rig
	check(field != null and field.seed == int(t.layout(1).seed), "main builds layout_1 when there's no host")
	if field == null:
		main.queue_free()
		return
	walker.input_enabled = false
	await test_spawn()
	await test_walk_and_run()
	await test_jump()
	await test_pose()
	await test_scramble()
	await test_no_scramble_from_a_ditch()
	await test_no_scramble_up_a_steep_slope()
	await test_wall()
	await test_fall()
	await test_camera()
	await test_start_world()
	test_layout_arg()
	main.queue_free()
	await t.process_frame


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _frames(n: int) -> void:
	for i in n:
		await t.physics_frame


func _ground(p: Vector3) -> float:
	return field.height_at(p.x, p.z)


## Puts the walker at `at`, still, no input.
func _put(at: Vector3) -> void:
	walker.set_move(Vector2.ZERO, false, false)
	walker.global_position = at
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()
	main.streamer.ensure_around(at)


## A flat 40 × 40 m slab, 30 m over the spawn, top at the returned height.
## Out of the terrain's way, so "flat ground" really is flat.
func _pad() -> Array:
	var top := field.spawn.y + 30.0
	var b := _box(Vector3(40, 1, 40), Vector3(field.spawn.x, top - 0.5, field.spawn.z))
	return [b, top]


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


func _flat(p: Vector3) -> Vector2:
	return Vector2(p.x, p.z)


func test_spawn() -> void:
	await _frames(30)
	var p := walker.global_position
	check(absf(p.y - _ground(p)) < 0.3, "walker stands on the ground at the spawn (%.2f m off)" % (p.y - _ground(p)))
	check(_flat(p).distance_to(_flat(field.spawn)) < 0.3, "walker starts at the spawn")
	check(absf(angle_difference(walker.rotation.y, field.spawn_yaw)) < 0.01, "walker faces spawn_yaw")
	check(walker.is_on_floor(), "walker is on the floor")


func test_walk_and_run() -> void:
	var pad: Array = _pad()
	var top: float = pad[1]
	for run in [false, true]:
		_put(Vector3(field.spawn.x - 10, top + 0.05, field.spawn.z + 10))
		rig.yaw = 0.0
		await _frames(20)
		var a := walker.global_position
		walker.set_move(Vector2(0, 1), run, false)
		await _frames(120)
		var b := walker.global_position
		walker.set_move(Vector2.ZERO, false, false)
		var d := _flat(a).distance_to(_flat(b))
		var want := 6.8 if run else 3.4
		var tol := 0.8 if run else 0.5
		check(absf(d - want) <= tol, "2 s %s covers %.2f m (%.1f ± %.1f)" % ["running" if run else "walking", d, want, tol])
		check(b.z < a.z - 0.5 * want and absf(b.x - a.x) < 0.2, "yaw 0 forward goes -Z")
	# Movement is relative to the camera's yaw.
	_put(Vector3(field.spawn.x, top + 0.05, field.spawn.z))
	rig.yaw = -PI / 2
	await _frames(10)
	var a2 := walker.global_position
	walker.set_move(Vector2(0, 1), false, false)
	await _frames(60)
	walker.set_move(Vector2.ZERO, false, false)
	var b2 := walker.global_position
	check(b2.x - a2.x > 1.0 and absf(b2.z - a2.z) < 0.2, "forward at yaw -90° goes +X")
	check(absf(angle_difference(walker.rotation.y, -PI / 2)) < 0.2, "walker turns to face where it walks")
	rig.yaw = 0.0
	(pad[0] as Node).queue_free()


func test_jump() -> void:
	var pad: Array = _pad()
	var top: float = pad[1]
	_put(Vector3(field.spawn.x, top + 0.05, field.spawn.z))
	await _frames(20)
	var y0 := walker.global_position.y
	walker.set_move(Vector2.ZERO, false, true)
	await _frames(1)
	walker.set_move(Vector2.ZERO, false, false)
	var peak := y0
	var left := false
	var landed := false
	for i in 90:
		await t.physics_frame
		peak = maxf(peak, walker.global_position.y)
		if not walker.is_on_floor():
			left = true
		elif left:
			landed = true
			break
	check(left and peak - y0 > 0.3, "a jump leaves the ground (peak %.2f m)" % (peak - y0))
	check(landed and absf(walker.global_position.y - y0) < 0.05, "and lands again")
	(pad[0] as Node).queue_free()


func test_pose() -> void:
	var pad: Array = _pad()
	var top: float = pad[1]
	check(walker.model != null and walker.model.get_parent() == walker and walker.get_node("Shape") != null, "the walker wears a CharacterModel over its collider")
	_put(Vector3(field.spawn.x, top + 0.05, field.spawn.z))
	await _frames(20)
	check(walker.model.state() == &"idle", "standing: idle (%s)" % walker.model.state())
	walker.set_move(Vector2(0, 1), false, false)
	await _frames(40)
	check(walker.model.state() == &"walk", "walking: walk (%s)" % walker.model.state())
	walker.set_move(Vector2(0, 1), true, false)
	await _frames(40)
	check(walker.model.state() == &"sprint", "running: sprint (%s)" % walker.model.state())
	walker.set_move(Vector2.ZERO, false, false)
	await _frames(60)
	walker.set_move(Vector2.ZERO, false, true)
	await _frames(2)
	walker.set_move(Vector2.ZERO, false, false)
	check(walker.model.state() == &"jump", "going up: jump (%s)" % walker.model.state())
	var fell := false
	for i in 60:
		await t.physics_frame
		if walker.model.state() == &"fall":
			fell = true
	check(fell, "coming down: fall")
	await _frames(30)
	walker.set_move(Vector2(0, 1), false, false)
	walker.pick_up()
	check(walker.model.state() == &"pick-up", "a claim plays pick-up")
	await _frames(15)
	check(walker.model.state() == &"pick-up", "and holds it a moment")
	await _frames(25)
	check(walker.model.state() == &"walk", "then back to the motion state within 0.7 s (%s)" % walker.model.state())
	walker.set_move(Vector2.ZERO, false, false)
	walker.set_character("male-d", Color("#112233"))
	check(walker.model.id == "male-d", "set_character swaps the model")
	walker.set_character("junk", Color("#112233"))
	check(walker.model.id == CharacterModel.IDS[0], "an unknown id falls back")
	(pad[0] as Node).queue_free()


func test_scramble() -> void:
	for h in [0.9, 1.6]:
		var pad: Array = _pad()
		var top: float = pad[1]
		var s := field.spawn
		_put(Vector3(s.x, top + 0.05, s.z))
		rig.yaw = 0.0
		await _frames(20)
		# A 2 m wide, 8 m deep box whose near face is 1.5 m ahead (-Z): deep
		# enough that 2.5 s of walking doesn't carry on off the far side.
		var box := _box(Vector3(2, h, 8), Vector3(s.x, top + h * 0.5, s.z - 5.5))
		await _frames(2)
		walker.set_move(Vector2(0, 1), false, true)
		await _frames(150)
		walker.set_move(Vector2.ZERO, false, false)
		await _frames(10)
		var y := walker.global_position.y - top
		if h < 1.0:
			check(absf(y - h) < 0.1 and walker.is_on_floor(), "forward + jump onto a %.1f m box ends on top (%.2f m up)" % [h, y])
		else:
			check(y < 0.1, "a %.1f m box isn't climbed (%.2f m up)" % [h, y])
		box.queue_free()
		(pad[0] as Node).queue_free()
		await _frames(1)


## Off a 3 m ledge and falling beside a 3.5 m wall, the wall's top is only
## 0.5 m over the ledge we last stood on. Measured from there, that's a
## scramble; measured from where we are, it's 2 m too tall. The walker
## walks off for real (a teleport would reset the floor), lets go of the
## keys so it drops straight into the 0.9 m gap, then pushes the wall
## with jump held on the way down.
func test_no_scramble_from_a_ditch() -> void:
	var pad: Array = _pad()
	var top: float = pad[1]
	var s := field.spawn
	var ledge := _box(Vector3(4, 3, 4), Vector3(s.x, top + 1.5, s.z + 3)) # z +1..+5
	var wall := _box(Vector3(4, 3.5, 4), Vector3(s.x, top + 1.75, s.z - 1.9)) # face at z +0.1
	rig.yaw = 0.0
	_put(Vector3(s.x, top + 3.05, s.z + 1.6))
	await _frames(20)
	check(walker.is_on_floor() and absf(walker.global_position.y - top - 3.0) < 0.1, "stood on the 3 m ledge")
	walker.set_move(Vector2(0, 1), false, false)
	for i in 120:
		await t.physics_frame
		if not walker.is_on_floor():
			break
	walker.set_move(Vector2.ZERO, false, false)
	for i in 120:
		await t.physics_frame
		if walker.global_position.y < top + 1.8:
			break
	var fell_to := walker.global_position.y - top
	walker.set_move(Vector2(0, 1), false, true)
	var peak := fell_to
	for i in 120:
		await t.physics_frame
		peak = maxf(peak, walker.global_position.y - top)
	walker.set_move(Vector2.ZERO, false, false)
	await _frames(10)
	var y := walker.global_position.y - top
	check(fell_to > 1.0 and fell_to < 1.8, "walked off and fell into the gap (%.2f m up)" % fell_to)
	check(y < 0.1 and peak <= fell_to + 0.01, "falling into a ditch, a 3.5 m wall isn't scrambled (ends %.2f m up, peak %.2f)" % [y, peak])
	ledge.queue_free()
	wall.queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)


## A 50° ramp is a wall, not a ledge: forward + jump doesn't climb it.
func test_no_scramble_up_a_steep_slope() -> void:
	var pad: Array = _pad()
	var top: float = pad[1]
	var s := field.spawn
	var a := deg_to_rad(50.0)
	# 6 m long, rising towards -Z, its foot 1.5 m ahead of the walker.
	var ramp := _box(Vector3(4, 0.4, 6), Vector3(s.x, top + 3.0 * sin(a), s.z - 1.5 - 3.0 * cos(a)))
	ramp.rotation.x = a
	rig.yaw = 0.0
	_put(Vector3(s.x, top + 0.05, s.z))
	await _frames(20)
	walker.set_move(Vector2(0, 1), false, true)
	await _frames(150)
	walker.set_move(Vector2.ZERO, false, false)
	await _frames(20)
	var y := walker.global_position.y - top
	check(y < 0.3, "a 50° slope isn't scrambled (%.2f m up)" % y)
	ramp.queue_free()
	(pad[0] as Node).queue_free()
	await _frames(1)


func test_layout_arg() -> void:
	check(main.parse_layout_arg("3") == 3, "--layout=3 picks layout 3")
	check(main.parse_layout_arg("abc") == 1, "--layout=abc falls back to layout 1")
	check(main.parse_layout_arg("0") == 1 and main.parse_layout_arg("99") == 1, "--layout outside the fixtures falls back to layout 1")


func test_wall() -> void:
	var at := Vector3(765, 0, field.spawn.z)
	at.y = _ground(at) + 0.3
	_put(at)
	rig.yaw = 0.0
	walker.set_move(Vector2(1, 0), true, false)
	var max_x := at.x
	for i in 180:
		await t.physics_frame
		max_x = maxf(max_x, walker.global_position.x)
	walker.set_move(Vector2.ZERO, false, false)
	check(max_x < TerrainField.WALL_HALF, "can't pass the wall at x = 770 (got to %.2f)" % max_x)


func test_fall() -> void:
	var s := field.spawn
	_put(Vector3(s.x, _ground(s) - 20.0, s.z))
	await t.physics_frame
	var p := walker.global_position
	check(p.y > _ground(p) - 0.5 and p.y < _ground(p) + 1.0, "20 m under the ground, next frame on the surface (%.2f m off)" % (p.y - _ground(p)))
	await _frames(30)
	p = walker.global_position
	check(absf(p.y - _ground(p)) < 0.3, "and stays there")


func test_camera() -> void:
	check(rig.arm is SpringArm3D and rig.arm.collision_mask == 1, "rig has a SpringArm3D on mask 1")
	check(rig.camera is Camera3D and rig.camera.get_parent() == rig.arm, "the camera hangs off the arm")
	check(is_equal_approx(rig.arm.spring_length, 4.0), "walk arm is 4 m")
	rig.follow(walker, &"drive")
	for i in 6:
		await t.process_frame
	var mid: float = rig.arm.spring_length
	check(mid > 4.0 and mid < 7.0, "drive profile blends, not snaps (%.2f m at 0.1 s)" % mid)
	for i in 21:
		await t.process_frame
	check(absf(rig.arm.spring_length - 7.0) < 0.01, "after follow(drive), the arm is 7 m within 0.45 s (%.2f)" % rig.arm.spring_length)
	var pivot := walker.global_position + Vector3.UP * 2.0
	check(rig.global_position.distance_to(pivot) < 0.05, "drive pivot is 2 m over the target")

	# Drive: yaw drifts back behind the target once the mouse is still.
	var behind := walker.rotation.y
	rig.yaw = behind + 1.0
	rig.add_look(Vector2.ZERO)
	for i in 60:
		await t.process_frame
	check(absf(angle_difference(rig.yaw, behind + 1.0)) < 0.05, "no drift in the first 1.5 s")
	for i in 150:
		await t.process_frame
	check(absf(angle_difference(rig.yaw, behind)) < 0.1, "then yaw drifts back behind the target")

	rig.follow(walker, &"walk")
	for i in 30:
		await t.process_frame
	check(absf(rig.arm.spring_length - 4.0) < 0.01, "and back to the 4 m walk arm")

	# Look input, as a captured mouse would send it.
	var y0 := rig.yaw
	rig.add_look(Vector2(100, 0))
	check(absf(rig.yaw - (y0 - 0.3)) < 1e-4, "mouse x turns yaw at 0.003 rad/px")
	rig.add_look(Vector2(0, -100000))
	check(is_equal_approx(rig.pitch, deg_to_rad(30.0)), "pitch stops at 30° up")
	rig.add_look(Vector2(0, 100000))
	check(is_equal_approx(rig.pitch, deg_to_rad(-70.0)), "pitch stops at 70° down")
	rig.add_look(Vector2(0, -(deg_to_rad(55.0) / RigCamera.SENSITIVITY)))
	await t.process_frame
	check(absf(walker.look_yaw - rig.yaw) < 1e-6, "the walker reads the camera's yaw")


func test_start_world() -> void:
	var ready_ms := [-1]
	var on_ready := func(ms: int) -> void: ready_ms[0] = ms
	main.world_ready.connect(on_ready)
	var before: TerrainField = main.field
	var world: Node = main.world
	main.start_world(t.layout(1))
	check(main.field == before and main.world == world and ready_ms[0] == -1, "start_world with the same seed does nothing")
	main.start_world(t.layout(2))
	check(main.field != before and main.field.seed == int(t.layout(2).seed), "a new seed builds a new field")
	check(ready_ms[0] >= 0, "world_ready fires with the build time (%d ms)" % ready_ms[0])
	check(not is_instance_valid(world) or world.is_queued_for_deletion() or not world.is_inside_tree(), "the old world is torn down")
	field = main.field
	await _frames(30)
	var p := walker.global_position
	check(_flat(p).distance_to(_flat(field.spawn)) < 0.3 and absf(p.y - _ground(p)) < 0.3, "the walker moves to the new spawn")
	main.world_ready.disconnect(on_ready)
