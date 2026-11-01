extends RefCounted
## Physics interpolation: the car moves on 60 Hz ticks, the screen refreshes
## at whatever the display does (57, 120, 144 Hz). Everything that follows
## the car per frame has to follow where the car is *drawn* (its
## interpolated transform), or the view steps with the physics clock: a
## double tick reads as a jump, a 0-tick frame as a freeze.
##
## The suite runs with --fixed-fps 60, which ties frames to ticks, so these
## tests drop the tick rate to TICKS for a while: 60 frames over 25 ticks
## gives 0-tick and 1-tick frames, the same shape as a 144 Hz screen.

var t ## the runner (run_tests.gd)
var main: Node3D
var car: CarController

const TICKS := 25


func _init(runner) -> void:
	t = runner


func run() -> void:
	main = t.main
	car = t.car
	test_setting_and_modes()
	await test_camera_moves_every_frame()
	await test_teleport_no_smear()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func test_setting_and_modes() -> void:
	print("physics interpolation")
	check(bool(ProjectSettings.get_setting("physics/common/physics_interpolation", false)), "physics/common/physics_interpolation is on")
	check(car.is_physics_interpolated_and_enabled(), "the car is interpolated")
	# Moved in _process: interpolating them too would lerp between the last
	# two ticks' values of something that never changed on a tick.
	var cam: FollowCamera = main.cam
	check(not cam.is_physics_interpolated(), "the camera isn't: it follows the car's interpolated transform itself")
	check(not (car.get_node("Visual") as Node3D).is_physics_interpolated(), "nor the car's visual (wheels, roll, slope tilt are per frame)")
	check(not (car.get_node("Fx") as Node3D).is_physics_interpolated(), "nor its dust, marks and streaks")
	check(not main.ghosts.is_physics_interpolated(), "nor the ghosts (they interpolate snapshots themselves)")


## Throttle down the straight off the spawn with ticks at TICKS Hz and frames
## at 60, and log how far the camera moves each frame. Following the raw
## transform, a frame without a tick doesn't move the view at all and the
## next one jumps; following the interpolated one, every frame moves about
## speed / 60.
func test_camera_moves_every_frame() -> void:
	for mode in [FollowCamera.Mode.TOP_DOWN, FollowCamera.Mode.CHASE, FollowCamera.Mode.BONNET]:
		var r: Dictionary = await _run_straight(mode)
		var name: String = ["top-down", "chase", "bonnet"][mode]
		check(r.min_k > 0.8 and r.max_k < 1.2, "%s: the camera moves every frame, by %.2f-%.2f of its neighbours' mean (ticks %d Hz, 60 fps)" % [name, r.min_k, r.max_k, TICKS])
		check(r.jitter < 0.05, "%s: step jitter %.3f of the mean step" % [name, r.jitter])
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)


func _run_straight(mode: int) -> Dictionary:
	var cam: FollowCamera = main.cam
	await t.place(t.track.get_spawn().global_transform)
	main.set_camera_mode(mode)
	await t.drive(1.2, 0.0, 1.0)
	var dir := -car.global_basis.z
	Engine.physics_ticks_per_second = TICKS
	var steps: Array[float] = []
	var last := cam.global_position
	for f in 50:
		car.set_control(0.0, 1.0, 0.0)
		await t.process_frame
		var p := cam.global_position
		if f >= 8: # let the lead and arm settle onto the new tick rate
			steps.append((p - last).dot(dir))
		last = p
	Engine.physics_ticks_per_second = 60
	car.neutralize()
	# The car is still pulling, so each step is judged against its two
	# neighbours rather than one mean: a steady ramp scores 1.
	var mean := 0.0
	for s in steps:
		mean += s
	mean /= steps.size()
	var lo := INF
	var hi := -INF
	var dev := 0.0
	for i in range(1, steps.size() - 1):
		var around := (steps[i - 1] + steps[i + 1]) * 0.5
		lo = minf(lo, steps[i] / around)
		hi = maxf(hi, steps[i] / around)
		dev += pow((steps[i] - around) / mean, 2.0)
	return {"min_k": lo, "max_k": hi, "jitter": sqrt(dev / (steps.size() - 2)), "mean": mean}


## A recovery while flat out: the next frame draws the car (and points the
## camera) at the anchor, not somewhere between where it was and the anchor.
func test_teleport_no_smear() -> void:
	var cam: FollowCamera = main.cam
	await t.place(t.track.get_spawn().global_transform)
	await t.drive(1.5, 0.0, 1.0)
	Engine.physics_ticks_per_second = TICKS
	await t.process_frame
	await t.physics_frame
	var kept := [main.checkpoints_passed, main.recoveries]
	main.recover(1)
	var anchor: Vector3 = t.track.recovery_for(1).global_position
	var worst := 0.0
	var worst_cam := 0.0
	for f in 4:
		await t.process_frame
		var at := car.get_global_transform_interpolated().origin
		worst = maxf(worst, Vector2(at.x - anchor.x, at.z - anchor.z).length())
		# Top-down looks at the car plus a lead that starts at zero after a snap.
		var ray_hit := _ground_point(cam)
		worst_cam = maxf(worst_cam, Vector2(ray_hit.x - anchor.x, ray_hit.z - anchor.z).length())
	Engine.physics_ticks_per_second = 60
	main.checkpoints_passed = kept[0]
	main.bridge.checkpoint_hint = kept[0]
	main.recoveries = kept[1]
	car.neutralize()
	check(worst < 0.3, "after a recovery at speed the car is drawn on the anchor from the next frame (worst %.2f m off)" % worst)
	check(worst_cam < 3.0, "and the camera looks at it there (worst %.2f m off)" % worst_cam)


## Where the top-down camera's view axis meets the anchor's height.
func _ground_point(cam: Camera3D) -> Vector3:
	var o := cam.global_position
	var d := -cam.global_basis.z
	var y: float = t.track.recovery_for(1).global_position.y
	return o + d * ((y - o.y) / d.y)
