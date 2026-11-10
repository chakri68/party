class_name Buggy
extends CharacterBody3D
## The buggy: Blind Rally's arcade car (car_controller.gd), cut down to one
## vehicle on one kind of ground. Not a tyre model: a forward speed, a
## sideways slip that grip bleeds off, and a yaw rate with a little inertia.
## All ground is offroad here, with more grip than the rally hatch gets on
## dirt, and no surface probe.
##
## Unlike the rally car it leans with the ground: the body's up eases towards
## the floor normal, and its heading (the flat part of -Z) is kept exactly,
## so a cross slope doesn't creep the yaw. Floors steeper than 35° are walls:
## throttle does nothing on them and gravity slides it back down.
##
## Control is set_control(). The keyboard feeds it only while someone is in
## the driver's seat (and input_enabled, which tests turn off).
##
## M3 shares buggies, and the Fleet sets each one's mode: &"local" (I drive,
## or it's the standalone one: all of the above), &"puppet" (someone else
## drives: no collider and no physics, the fleet poses it from their stream)
## or &"parked" (nobody drives: a collider, but no physics, so it can't
## creep down a slope between the server's poses).

## Collision box, metres: the 4x4 body from wheel bottoms to roof, its floor
## 5 cm up like Blind Rally's. BOX_Y is the box's centre height.
const BOX := Vector3(2.4, 2.0, 4.3)
const BOX_Y := 1.05
const GRAVITY := 20.0
## How fast the body leans to the floor, 1/s.
const LEAN_RATE := 8.0
## Throttle held and slower than this counts as stuck.
const STUCK_SPEED := 0.5

@export_group("Engine")
@export var engine_accel := 9.0 ## m/s² at full throttle, tapering toward top speed
@export var brake_decel := 22.0
@export var reverse_accel := 6.0
@export var max_speed := 15.3 ## m/s, 55 km/h (spec §7.2)
@export var max_reverse := 5.0
@export var drag := 0.3 ## linear drag, 1/s
@export var rolling := 1.2 ## rolling resistance off the throttle, m/s²
@export var slope_pull := 5.0 ## m/s² per unit of grade, uphill slows, downhill speeds

@export_group("Steering")
@export var max_yaw_rate := 1.9 ## rad/s at full lock and ideal speed
@export var steer_rate := 3.0 ## how fast the wheel winds on, full lock per 1/rate s
@export var centre_rate := 6.0 ## how fast it comes back
@export var full_steer_speed := 4.0 ## below this, steering fades toward zero
@export var high_speed_steer := 0.6 ## fraction of yaw rate left at max_speed
@export var yaw_response := 7.0 ## how fast yaw rate chases its target, 1/s

@export_group("Grip")
@export var grip := 8.0 ## how fast lateral slip decays, 1/s (rally hatch on dirt: 4.5)
@export var drift_grip := 0.3 ## grip multiplier with full lock, full throttle, full speed
@export var loose := 0.6 ## how far throttle and brake unstick the rear
@export var power_oversteer := 0.5 ## extra yaw, rad/s, from throttle at full lock and speed
@export var brake_rotation := 0.7 ## extra yaw, rad/s, from braking at full lock and speed
@export var max_slip_deg := 30.0 ## grip ramps hard past this slip angle so it never spins
@export var slide_scrub := 0.18 ## forward speed lost per m/s of sideways slide, per s

@export_group("Collision")
@export var impact_threshold := 2.0 ## m/s into the wall before it counts
@export var impact_keep := 0.65 ## fraction of speed kept after a real hit

## The vehicle id from the server's list; "" for the standalone buggy.
var id := ""
var mode: StringName = &"local"
## Who's in the driver's seat, or null.
var driver: Node = null
var input_enabled := true
## Out of the hunting phase (main sets it): no controls at all, it coasts.
var locked := false
## main.seaward, bound to the buggy's depth: down the seabed where it's too
## deep, else zero. Unset, there's no sea rule.
var seaward := Callable()
## Read-only state.
var forward_speed := 0.0
var steer_input := 0.0
var throttle_input := 0.0
var brake_input := 0.0
## Seconds of throttle held while going nowhere.
var stuck_s := 0.0

## Headlights, on while it has a driver in the dark (Fleet sets them).
var lights_on := false
var _heads: Array[SpotLight3D] = []

var _steer := 0.0 # the wheel, after its wind-on rate
var _yaw_rate := 0.0


func _init() -> void:
	floor_max_angle = deg_to_rad(35.0)
	collision_layer = 2 # not 1, so the camera's spring arm looks past it
	collision_mask = 1
	for sx in [-0.8, 0.8]:
		var l := SpotLight3D.new()
		l.name = "Head%s" % ("L" if sx < 0 else "R")
		l.position = Vector3(sx, 0.9, -2.1)
		l.spot_range = DayClock.HEAD_RANGE
		l.spot_angle = DayClock.HEAD_ANGLE
		l.light_energy = 4.0
		l.visible = false
		add_child(l)
		_heads.append(l)


func set_lights(on: bool) -> void:
	lights_on = on
	for l in _heads:
		l.visible = on


## Local and parked keep the M2 collider (layer 2, the world under it). A
## puppet has none: players pass through each other's buggies (§13.3).
func set_mode(m: StringName) -> void:
	assert(m in [&"local", &"puppet", &"parked"], "unknown buggy mode %s" % m)
	if m == mode:
		return
	mode = m
	collision_layer = 0 if m == &"puppet" else 2
	collision_mask = 0 if m == &"puppet" else 1
	velocity = Vector3.ZERO
	forward_speed = 0.0
	_steer = 0.0
	_yaw_rate = 0.0
	stuck_s = 0.0
	set_control(0, 0, 0)


func set_control(steer: float, throttle: float, brake: float) -> void:
	steer_input = clampf(steer, -1, 1)
	throttle_input = clampf(throttle, 0, 1)
	brake_input = clampf(brake, 0, 1)


## Degrees between the body's up and the world's.
func tilt_deg() -> float:
	return rad_to_deg(global_basis.y.angle_to(Vector3.UP))


## Upright at `at`, keeping the heading, stopped dead.
func place_upright(at: Vector3) -> void:
	global_transform = Transform3D(_lean(Vector3.UP, flat_forward(global_basis)), at)
	velocity = Vector3.ZERO
	forward_speed = 0.0
	_steer = 0.0
	_yaw_rate = 0.0
	stuck_s = 0.0
	reset_physics_interpolation()


## The heading: -Z flattened onto the ground plane. Nose straight up or down,
## -Z has no flat part, so the roof says which way it was going.
static func flat_forward(b: Basis) -> Vector3:
	var f := -b.z
	var flat := Vector3(f.x, 0, f.z)
	if flat.length_squared() < 1e-6:
		flat = -b.y * signf(f.y)
		flat.y = 0
	return flat.normalized() if flat.length_squared() > 1e-12 else Vector3.FORWARD


## A basis with this up whose -Z flattens to exactly `heading`.
static func _lean(up: Vector3, heading: Vector3) -> Basis:
	var f := (heading - Vector3.UP * heading.dot(up) / up.y).normalized()
	return Basis(f.cross(up).normalized(), up, -f)


func _physics_process(dt: float) -> void:
	if mode != &"local":
		return
	if driver != null and input_enabled:
		set_control(Input.get_axis("move_left", "move_right"), Input.get_action_strength("move_forward"), Input.get_action_strength("move_back"))
	if locked:
		set_control(0, 0, 0)

	var fwd := flat_forward(global_basis)
	var right := Vector3(-fwd.z, 0, fwd.x)
	var v_fwd := velocity.dot(fwd)
	var v_lat := velocity.dot(right)
	var on_floor := is_on_floor()
	# A floor too steep to stand on: the wheels can't push, it slides back.
	var throttle := throttle_input if on_floor or not _on_steep() else 0.0
	var brake := brake_input
	# Too deep: the engine won't push you further out. Pointing straight out
	# cuts it all; side-on to the shore keeps it all.
	var down: Vector3 = seaward.call(global_position) if seaward.is_valid() else Vector3.ZERO
	throttle *= 1.0 - maxf(0.0, fwd.dot(down))

	# Longitudinal: throttle forward, brake until stopped, then reverse. Thrust
	# tapers near the top so the last few km/h take a moment.
	if throttle > 0.0 and v_fwd < max_speed:
		var taper := lerpf(1.0, 0.6, clampf(v_fwd / max_speed, 0.0, 1.0))
		v_fwd = minf(v_fwd + engine_accel * taper * throttle * dt, max_speed)
	if brake > 0.0:
		if v_fwd > 0.5:
			v_fwd = maxf(v_fwd - brake_decel * brake * dt, 0.0)
		else:
			v_fwd = maxf(v_fwd - reverse_accel * brake * dt, -max_reverse)
	var d := drag + (1.5 if absf(v_fwd) > max_speed else 0.0)
	v_fwd -= v_fwd * d * dt
	v_fwd = move_toward(v_fwd, 0.0, rolling * dt * (0.0 if throttle > 0.0 else 1.0))
	# Hills: an arcade share of gravity along the slope.
	if on_floor:
		v_fwd -= slope_pull * -get_floor_normal().dot(fwd) * dt
	# Empty and nobody on the pedals: the handbrake's on. Without it the
	# slope pull beats rolling resistance past ~14° and it wanders off.
	var parked := on_floor and driver == null and throttle_input == 0.0 and brake_input == 0.0
	if parked:
		v_fwd = 0.0

	# Steering: the wheel turns at a limited rate; the yaw rate scales with
	# speed, fades out near standstill and tightens at the top.
	var unwinding := absf(steer_input) < absf(_steer) or steer_input * _steer < 0.0
	_steer = move_toward(_steer, steer_input, (centre_rate if unwinding else steer_rate) * dt)
	var speed_k := clampf(absf(v_fwd) / max_speed, 0.0, 1.0)
	var low := clampf(absf(v_fwd) / full_steer_speed, 0.0, 1.0)
	var target_yaw := -_steer * max_yaw_rate * low * lerpf(1.0, high_speed_steer, speed_k) * signf(v_fwd)
	# Power on with lock swings the tail, brake with lock tucks the nose.
	if v_fwd > 0.0:
		target_yaw -= _steer * (power_oversteer * throttle + brake_rotation * brake) * loose * speed_k
	_yaw_rate = lerpf(_yaw_rate, target_yaw, clampf(yaw_response * dt, 0.0, 1.0))

	# Grip: kill lateral slip. Lock, speed and throttle loosen it; past
	# max_slip_deg it bites hard again, so a slide always comes back.
	var slip := atan2(v_lat, maxf(absf(v_fwd), 1.0))
	var slide := absf(_steer) * speed_k * lerpf(0.55, 1.0, throttle) * loose
	var g := grip * lerpf(1.0, drift_grip, clampf(slide, 0.0, 1.0))
	var cap := deg_to_rad(max_slip_deg)
	g *= 1.0 + 5.0 * smoothstep(cap * 0.7, cap, absf(slip))
	v_lat = 0.0 if parked else lerpf(v_lat, 0.0, clampf(g * dt, 0.0, 1.0))
	v_fwd = move_toward(v_fwd, 0.0, absf(v_lat) * slide_scrub * dt)

	# Recompose against the old axes, then turn: the car points slightly away
	# from where it's going, which is where the drift comes from.
	var vy := velocity.y - GRAVITY * dt if not on_floor else -0.5
	var before := fwd * v_fwd + right * v_lat
	velocity = before + Vector3.UP * vy
	# And nothing else takes you there either: slope, slide or reverse.
	velocity -= down * maxf(0.0, velocity.dot(down))
	move_and_slide()
	_handle_collisions(before)

	var up := global_basis.y
	if is_on_floor():
		up = up.slerp(get_floor_normal(), clampf(LEAN_RATE * dt, 0.0, 1.0)).normalized()
	if up.y > 0.05:
		global_basis = _lean(up, fwd.rotated(Vector3.UP, _yaw_rate * dt))
	else:
		rotate(Vector3.UP, _yaw_rate * dt) # on its side or worse: no lean, just turn

	forward_speed = velocity.dot(flat_forward(global_basis))
	if throttle_input > 0.0 and absf(forward_speed) < STUCK_SPEED:
		stuck_s += dt
	else:
		stuck_s = 0.0


## Touching a floor too steep to drive on.
func _on_steep() -> bool:
	for i in get_slide_collision_count():
		var n := get_slide_collision(i).get_normal()
		if n.y > 0.1 and n.angle_to(Vector3.UP) > floor_max_angle:
			return true
	return false


## move_and_slide already strips the velocity going into a wall. On top of
## that a real hit costs momentum, so trees hurt instead of acting as rails.
func _handle_collisions(before: Vector3) -> void:
	var worst := 0.0
	for i in get_slide_collision_count():
		var n := get_slide_collision(i).get_normal()
		if absf(n.y) > 0.6:
			continue # floor
		worst = maxf(worst, -before.dot(n))
	if worst > impact_threshold:
		var keep := lerpf(1.0, impact_keep, clampf(worst / max_speed * 2.0, 0.0, 1.0))
		velocity.x *= keep
		velocity.z *= keep
