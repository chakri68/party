class_name Autopilot
extends Node
## Debug autopilot: drives the stage so the probe, the screenshots and the
## headless tests have something sensible behind the wheel. A test and demo
## tool, not an AI opponent; the spec (§16) rules those out, and nothing in
## a real race turns this on.
##
## Pure pursuit on Track.centerline: aim at a point some way down the road
## (further at speed), steer for the curvature that reaches it. Speed is
## planned from the corners ahead: each upcoming sample allows a cornering
## speed from its radius, and braking distance turns that into a speed limit
## now. Over the limit it brakes, under it it's flat out, which on gravel
## gets the tail out a little on the way into the tight ones.
##
## Output goes through car.set_control(), the same call the Driver's phone
## ends up in, so it exercises the real handling, timeout and all.
##
## `pads`: drive the way the Driver's phone does, on/off. Steer is left,
## right or nothing, throttle and brake on or off, and all of it lands
## pad_delay late (a network round trip). The stage tests use it to show a
## stage can be driven on pads with the softened steering, not just by a
## perfect analogue hand.

@export var enabled := false:
	set(v):
		enabled = v
		_i = -1
		_late.clear()
		if not v and car:
			car.neutralize()
@export var lookahead_min := 7.0 ## metres
@export var lookahead_per_ms := 0.55 ## extra metres per m/s
@export var lateral_g := 9.0 ## m/s² it trusts the car to corner at
@export var brake_g := 14.0 ## m/s² it plans to brake at (the car can do ~26)
@export var plan_ahead := 90.0 ## metres of road it reads for corners
@export var flat_out := false ## tests: ignore the speed plan, full throttle
@export var pads := false ## on/off controls, late, like the Driver's phone
@export var pad_delay := 0.12 ## seconds the pads land late

var car: CarController
var track: Track

var _i := -1 # centreline sample we're nearest, tracked forward
var _corner_v := PackedFloat32Array() # per sample: cornering speed from its radius
var _late: Array = [] # pads: [due time, steer, throttle, brake], oldest first
var _clock := 0.0

const STEP_GUESS := 2.0


func setup(t: Track, c: CarController) -> void:
	track = t
	car = c
	var pts := t.centerline
	var n := pts.size()
	_corner_v.resize(n)
	for i in n:
		# Radius from three samples ~8 m apart (Menger curvature), flat in XZ.
		var a := _xz(pts[maxi(i - 4, 0)])
		var b := _xz(pts[i])
		var c2 := _xz(pts[mini(i + 4, n - 1)])
		var area2 := absf((b - a).cross(c2 - a))
		var k := 2.0 * area2 / maxf(a.distance_to(b) * b.distance_to(c2) * c2.distance_to(a), 0.001)
		_corner_v[i] = sqrt(lateral_g / maxf(k, 0.0005))
	# A corner's limit holds a little before and after it (the car isn't a point).
	var smoothed := _corner_v.duplicate()
	for i in n:
		for j in range(maxi(i - 3, 0), mini(i + 4, n)):
			smoothed[i] = minf(smoothed[i], _corner_v[j])
	_corner_v = smoothed


func _physics_process(dt: float) -> void:
	if not enabled or car == null or track == null or track.centerline.size() < 2:
		return
	_clock += dt
	var pts := track.centerline
	var n := pts.size()
	var pos := _xz(car.global_position)
	_i = _nearest(pos)
	var speed := maxf(car.forward_speed, 0.0)
	var step := track.length_m / maxf(n - 1, 1) if track.length_m > 0.0 else STEP_GUESS

	# Steering: pure pursuit.
	var la := lookahead_min + lookahead_per_ms * speed
	var target := _xz(pts[mini(_i + int(ceil(la / step)), n - 1)])
	var fwd3 := -car.global_basis.z
	var fwd := Vector2(fwd3.x, fwd3.z).normalized()
	var to := target - pos
	var alpha := fwd.angle_to(to) # + = target to the right (screen +x is east, +z south)
	var curv := 2.0 * sin(alpha) / maxf(to.length(), 1.0)
	# The car's yaw rate at full lock, as car_controller works it out.
	var low := clampf(speed / car.full_steer_speed, 0.0, 1.0)
	var high := lerpf(1.0, car.high_speed_steer, clampf(speed / car.max_speed, 0.0, 1.0))
	var full_lock_yaw := maxf(car.max_yaw_rate * maxf(low, 0.2) * high, 0.1)
	var steer := clampf(curv * maxf(speed, 3.0) / full_lock_yaw, -1.0, 1.0)

	# Speed: the tightest limit within plan_ahead, carried back by braking distance.
	var limit := car.max_speed
	var samples := int(plan_ahead / step)
	for k in range(0, samples):
		var j := _i + k
		if j >= n:
			break
		var d := k * step
		limit = minf(limit, sqrt(_corner_v[j] * _corner_v[j] + 2.0 * brake_g * d))
	var throttle := 0.0
	var brake := 0.0
	if speed > limit + 1.0:
		brake = clampf((speed - limit) / 4.0, 0.3, 1.0)
	else:
		throttle = clampf((limit - speed) / 3.0 + 0.35, 0.0, 1.0)
	if flat_out:
		throttle = 1.0
		brake = 0.0
	# Way off line (spun, or a tree said no): slow down and let pursuit recover.
	if absf(alpha) > 1.2:
		throttle = minf(throttle, 0.4)
	if pads:
		_press(steer, throttle, brake)
		return
	car.set_control(steer, throttle, brake)


## Pads: what a thumb would press for that (steer past a third of lock is
## a press, throttle past half, any real braking), sent now, arriving
## pad_delay later. No feathering: it holds a pad or it doesn't, which is
## the hard case for the handling.
func _press(steer: float, throttle: float, brake: float) -> void:
	var s := 0.0
	if absf(steer) > 0.33:
		s = signf(steer)
	var b := 1.0 if brake > 0.25 else 0.0
	var th := 1.0 if throttle > 0.5 and b == 0.0 else 0.0
	_late.append([_clock + pad_delay, s, th, b])
	var now: Array = []
	while not _late.is_empty() and float(_late[0][0]) <= _clock:
		now = _late.pop_front()
	if not now.is_empty():
		car.set_control(now[1], now[2], now[3])


## Nearest sample, searched in a window ahead of the last one so it can't
## jump to the other leg of a hairpin. Full search the first time.
func _nearest(pos: Vector2) -> int:
	var pts := track.centerline
	var n := pts.size()
	var lo := 0
	var hi := n
	if _i >= 0:
		lo = maxi(_i - 10, 0)
		hi = mini(_i + 40, n)
	var best := INF
	var bi := maxi(_i, 0)
	for j in range(lo, hi):
		var d := pos.distance_squared_to(_xz(pts[j]))
		if d < best:
			best = d
			bi = j
	return bi


func _xz(p: Vector3) -> Vector2:
	return Vector2(p.x, p.z)
