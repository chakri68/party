extends RefCounted
## The sea is the edge (spec §4.4): on layout_1's east side, walking or
## driving seaward stops you at the waterline, wading at most, well inside
## the wall. Along the shore and back inland still work. Run from
## run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
var main: Node3D
var walker: Walker
var buggy: Buggy
var rig: RigCamera
var field: TerrainField
## How far short of the wall counts as "well inside" it.
const WALL_MARGIN := 20.0
## One tick of motion can carry you a hair past the depth before the rule bites.
const SLACK := 0.05


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("the sea")
	main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	field = main.field
	walker = main.walker
	buggy = main.buggy
	rig = main.rig
	if field == null or field.ring[1] != "sea":
		check(false, "layout_1's east side is sea")
		main.queue_free()
		return
	walker.input_enabled = false
	buggy.input_enabled = false
	var water := main.world.get_node("Water") as MeshInstance3D
	var m := water.material_override as BaseMaterial3D
	check(m.cull_mode == BaseMaterial3D.CULL_DISABLED, "the sea surface draws from below too")
	await test_walk_seaward()
	await test_drive_seaward()
	main.queue_free()
	await t.process_frame


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _depth(p: Vector3) -> float:
	return TerrainField.SEA_LEVEL - field.height_at(p.x, p.z)


## Along z, the first x (heading east) where the ground is `d` under the sea.
func _line_x(z: float, d: float) -> float:
	var x := 500.0
	while x < TerrainField.WALL_HALF:
		if _depth(Vector3(x, 0, z)) > d:
			return x
		x += 0.5
	return NAN


func test_walk_seaward() -> void:
	var d: float = main.SEA_WALK_DEPTH
	var z := field.spawn.z
	var line := _line_x(z, d)
	check(not is_nan(line) and line < TerrainField.WALL_HALF - 40.0, "layout_1 is %.1f m deep 40 m short of the wall (line at x %.1f)" % [d, line])
	if is_nan(line):
		return
	var at := Vector3(line - 15.0, 0, z)
	at.y = field.height_at(at.x, at.z) + 0.3
	walker.set_move(Vector2.ZERO, false, false)
	walker.global_position = at
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()
	main.streamer.ensure_around(at)
	rig.yaw = 0.0
	walker.set_move(Vector2(1, 0), true, false) # +x, running
	var deepest := 0.0
	var max_x := at.x
	for i in 600:
		await t.physics_frame
		deepest = maxf(deepest, _depth(walker.global_position))
		max_x = maxf(max_x, walker.global_position.x)
	check(deepest <= d + SLACK, "10 s running out to sea, the walker never gets deeper than %.1f m (%.2f)" % [d, deepest])
	check(deepest > d - 0.3, "and it does wade out to it, not stop on something")
	check(max_x < TerrainField.WALL_HALF - WALL_MARGIN, "well inside the wall (x %.1f)" % max_x)

	var p0 := walker.global_position
	walker.set_move(Vector2(0, 1), true, false) # -z, along the shore
	for i in 120:
		await t.physics_frame
		deepest = maxf(deepest, _depth(walker.global_position))
	var along := absf(walker.global_position.z - p0.z)
	check(along > 3.0 and deepest <= d + SLACK, "it can still walk along the shore (%.1f m in 2 s, %.2f m deep at most)" % [along, deepest])

	p0 = walker.global_position
	walker.set_move(Vector2(-1, 0), true, false) # -x, inland
	for i in 180:
		await t.physics_frame
	walker.set_move(Vector2.ZERO, false, false)
	var back := p0.x - walker.global_position.x
	check(back > 4.0 and _depth(walker.global_position) < d - 0.2, "and back inland (%.1f m in 3 s)" % back)


## Buggy at `at`, its nose along `fwd` (flat), still, on the ground.
func _park(at: Vector3, fwd: Vector3) -> void:
	buggy.set_control(0, 0, 0)
	at.y = field.height_at(at.x, at.z) + 0.3
	buggy.global_transform = Transform3D(Basis(Vector3.UP, atan2(-fwd.x, -fwd.z)), at)
	buggy.velocity = Vector3.ZERO
	buggy.reset_physics_interpolation()
	main.streamer.ensure_around(at)


func _drive(frames: int, deepest: float) -> float:
	for i in frames:
		await t.physics_frame
		main.streamer.ensure_around(buggy.global_position)
		deepest = maxf(deepest, _depth(buggy.global_position))
	return deepest


func test_drive_seaward() -> void:
	var d: float = main.SEA_DRIVE_DEPTH
	var z := field.spawn.z - 20.0 # out of the walker's way
	var line := _line_x(z, d)
	if is_nan(line):
		check(false, "layout_1 is %.1f m deep somewhere short of the wall" % d)
		return
	_park(Vector3(line - 30.0, 0, z), Vector3.RIGHT)
	await _drive(20, 0.0)
	buggy.set_control(0, 1, 0)
	var x0 := buggy.global_position.x
	var deepest := await _drive(600, 0.0)
	var max_x := buggy.global_position.x
	check(deepest <= d + SLACK, "10 s of full throttle out to sea, the buggy never gets deeper than %.1f m (%.2f)" % [d, deepest])
	check(deepest > d - 0.3 and max_x - x0 > 20.0, "and it does drive out to it (%.1f m)" % (max_x - x0))
	check(max_x < TerrainField.WALL_HALF - WALL_MARGIN, "well inside the wall (x %.1f)" % max_x)

	buggy.set_control(0, 0, 1) # reverse, inland
	var p0 := buggy.global_position
	await _drive(180, 0.0)
	var back := p0.x - buggy.global_position.x
	check(back > 4.0, "reverse backs it out (%.1f m in 3 s)" % back)

	_park(Vector3(line - 1.0, 0, z), Vector3.FORWARD) # -z, along the shore
	await _drive(10, 0.0)
	p0 = buggy.global_position
	buggy.set_control(0, 1, 0)
	deepest = await _drive(180, 0.0)
	buggy.set_control(0, 0, 0)
	var along := absf(buggy.global_position.z - p0.z)
	check(along > 10.0 and deepest <= d + SLACK, "it can drive along the shore (%.1f m in 3 s, %.2f m deep at most)" % [along, deepest])
