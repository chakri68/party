class_name FollowCamera
extends Camera3D
## Tilted orthographic follow camera for the Navigator (spec §4.2). Leads the
## car so there's more road in front than behind, and with speed it pulls
## back and leads further, which is most of what makes it feel fast from
## above. North-up by default; rotate_with_car is the optional "camera rotation".
##
## The car stays pinned (no positional lag); only the lead and the zoom are
## smoothed, so the car never swims around the screen at speed.
##
## Small screens: view_size is metres across the screen's short side on a
## desktop-sized view. On a phone that many metres would shrink the car to a
## few pixels, so the view tightens until at least min_px_per_m CSS pixels
## show each metre, but never below min_view, because the Navigator still
## has to read the next corner. The speed pull-back works on top of that.
##
## Experimental, off by default: two perspective modes (Y cycles, or
## initSession `camera`). CHASE sits behind and above the car on a lagged
## arm, BONNET rides the roof line. Both swap in their own Environment (sky
## and distance fog) through Camera3D.environment, so the world's environment
## and the static map, which renders through it, stay exactly as they were.

@export var target: Node3D
@export var pitch_deg := 55.0 ## down-tilt from horizontal
@export var distance := 80.0 ## along the view axis; ortho, so only clipping cares
@export var view_size := 42.0 ## ortho height in metres, the player's zoom
@export var zoom_range := Vector2(28.0, 64.0) ## limited zoom, per spec; speed pull-back stays inside it
@export var look_ahead := 0.35 ## seconds of velocity to lead by, at low speed
@export var look_ahead_fast := 0.8 ## ... and at top speed
@export var max_lead := 0.3 ## lead never exceeds this fraction of the view height
@export var speed_zoom := 0.25 ## extra view size at top speed, as a fraction
@export var smoothing := 6.0 ## 1/s, how fast the lead settles
@export var zoom_smoothing := 1.8 ## 1/s, slower: the pull-back should breathe, not pump
@export var rotate_with_car := false
@export var min_px_per_m := 12.5 ## CSS pixels per metre the view won't drop below
@export var min_view := 27.0 ## ...unless that would show fewer metres than this
@export_group("Perspective (experimental)")
@export var chase_back := 6.0 ## metres behind the car
@export var chase_up := 2.5 ## metres above it
@export var chase_aim := Vector2(10.0, 0.8) ## look at: metres ahead, metres up
@export var chase_lag := 7.0 ## 1/s, how fast the arm swings round after the car
@export var chase_fov := Vector2(68.0, 80.0) ## vertical FOV at rest, at top speed
@export var bonnet_offset := Vector3(0.0, 1.3, -1.05) ## car space, -z forward: over the bonnet, ahead of the light pod
@export var bonnet_fov := Vector2(70.0, 78.0)
@export var persp_far := 130.0 ## fog has closed in by here; the tree walls hide the rest
@export_group("Impact kick")
@export var kick_enabled := true ## off = no shake at all (reduced motion)
@export var kick_per_ms := 0.035 ## metres of kick per m/s of impact speed
@export var kick_max := 0.45 ## metres; mild on purpose (spec §10)

var _focus := Vector3.ZERO
var _lead := Vector3.ZERO
var _yaw := 0.0
var _speed_k := 0.0
var _kick := Vector3.ZERO
var _kick_vel := Vector3.ZERO
var _fit := 1.0 ## small-screen tightening, 0..1 multiplier on view_size

enum Mode { TOP_DOWN, CHASE, BONNET }
var mode := Mode.TOP_DOWN
## Set by main: the environment the perspective modes see (sky + fog).
var perspective_env: Environment
var _arm_yaw := 0.0
var _arm_pos := Vector3.ZERO


func _ready() -> void:
	_apply_projection()
	cull_mask &= ~4 # render layer 3 is the map-only overlay
	get_viewport().size_changed.connect(fit_to_screen)
	fit_to_screen()
	if target:
		snap()


## Recomputes the small-screen fit. Runs on every resize (rotation included).
func fit_to_screen() -> void:
	var win := Vector2(DisplayServer.window_get_size())
	if DisplayServer.get_name() == "headless" or win.x <= 0.0:
		_fit = 1.0
		return
	# window_get_size is device pixels; the web reports devicePixelRatio as the scale.
	fit_css(win / maxf(DisplayServer.screen_get_scale(), 1.0))


## The fit for a screen of `css` CSS pixels. Split out so tests can ask
## "what would a 844x390 phone get" without a phone.
func fit_css(css: Vector2) -> void:
	# Portrait: size the short (horizontal) side, not the long one.
	keep_aspect = KEEP_WIDTH if css.x < css.y else KEEP_HEIGHT
	var want := maxf(minf(css.x, css.y) / min_px_per_m, min_view)
	_fit = clampf(want / view_size, 0.0, 1.0)


## Metres across the short side of the screen right now, before speed.
func base_view() -> float:
	return maxf(view_size * _fit, minf(min_view, view_size))


func set_mode(m: int) -> void:
	mode = clampi(m, 0, 2) as Mode
	_apply_projection()
	fit_to_screen()
	if target:
		snap()


func _apply_projection() -> void:
	if mode == Mode.TOP_DOWN:
		projection = PROJECTION_ORTHOGONAL
		size = view_size
		near = 1.0
		far = distance * 2.5
		environment = null
	else:
		projection = PROJECTION_PERSPECTIVE
		near = 0.1 if mode == Mode.BONNET else 0.25
		far = persp_far
		fov = chase_fov.x if mode == Mode.CHASE else bonnet_fov.x
		environment = perspective_env


func snap() -> void:
	_arm_yaw = target.global_rotation.y
	_arm_pos = target.global_position
	_focus = target.global_position
	_lead = Vector3.ZERO
	_kick = Vector3.ZERO
	_kick_vel = Vector3.ZERO
	_yaw = target.global_rotation.y if rotate_with_car else 0.0
	if mode == Mode.TOP_DOWN:
		_place()
	else:
		_process_perspective(0.0, Vector3.ZERO, 30.0)


func zoom(step: float) -> void:
	view_size = clampf(view_size * step, zoom_range.x, zoom_range.y)


## A short, damped nudge away from the hit. strength is the impact speed in
## m/s; dir is the direction the car was pushed (world, horizontal).
func kick(strength: float, dir: Vector3) -> void:
	if not kick_enabled:
		return
	var v := Vector3(dir.x, 0, dir.z).normalized() * minf(strength * kick_per_ms, kick_max) * 14.0
	_kick_vel += v


func _process(dt: float) -> void:
	if not target:
		return
	var v := Vector3.ZERO
	var top := 30.0
	if target is CharacterBody3D:
		v = (target as CharacterBody3D).velocity
		v.y = 0.0
	if target is CarController:
		top = (target as CarController).max_speed
	if mode != Mode.TOP_DOWN:
		_process_perspective(dt, v, top)
		return
	var k_zoom := 1.0 - exp(-zoom_smoothing * dt)
	_speed_k = lerpf(_speed_k, clampf(v.length() / top, 0.0, 1.0), k_zoom)
	size = clampf(base_view() * (1.0 + speed_zoom * _speed_k * _speed_k), minf(zoom_range.x, min_view), zoom_range.y)

	var lead_t := lerpf(look_ahead, look_ahead_fast, _speed_k)
	var want := v * lead_t
	var cap := size * max_lead
	if want.length() > cap:
		want = want.normalized() * cap
	var k := 1.0 - exp(-smoothing * dt)
	_lead = _lead.lerp(want, k)
	_focus = target.global_position + _lead
	if rotate_with_car:
		_yaw = lerp_angle(_yaw, target.global_rotation.y, k)

	# Kick: a stiff, well-damped spring, settles in ~0.3 s with one small overshoot.
	if kick_enabled:
		_kick_vel += (-_kick * 170.0 - _kick_vel * 18.0) * dt
		_kick += _kick_vel * dt
		_kick = _kick.limit_length(kick_max)
	else:
		_kick = Vector3.ZERO
		_kick_vel = Vector3.ZERO
	_place()


func _place() -> void:
	var pitch := deg_to_rad(pitch_deg)
	var back := Basis(Vector3.UP, _yaw) * Vector3(0, sin(pitch), cos(pitch))
	global_position = _focus + back * distance
	look_at(_focus, Vector3.UP)
	global_position += _kick


## Chase and bonnet. The arm follows the car's heading with lag (so a slide
## swings the car sideways in frame, which is the point), the FOV opens a
## little with speed, and the chase arm is pulled in if a trunk is between
## it and the car.
func _process_perspective(dt: float, v: Vector3, top: float) -> void:
	var k_speed := 1.0 - exp(-zoom_smoothing * dt)
	_speed_k = lerpf(_speed_k, clampf(v.length() / top, 0.0, 1.0), k_speed)
	var car_yaw := target.global_rotation.y
	var fovs := chase_fov if mode == Mode.CHASE else bonnet_fov
	fov = lerpf(fovs.x, fovs.y, _speed_k * _speed_k)
	if kick_enabled:
		_kick_vel += (-_kick * 170.0 - _kick_vel * 18.0) * dt
		_kick += _kick_vel * dt
		_kick = _kick.limit_length(kick_max * 0.5)
	if mode == Mode.BONNET:
		var b := Basis(Vector3.UP, car_yaw)
		global_transform = Transform3D(b, target.global_position + b * bonnet_offset + _kick * 0.3)
		return
	var k := 1.0 - exp(-chase_lag * dt)
	_arm_yaw = lerp_angle(_arm_yaw, car_yaw, k)
	# Height follows a touch slower than the car, so crests don't jolt the view.
	_arm_pos = Vector3(target.global_position.x, lerpf(_arm_pos.y, target.global_position.y, k * 0.6), target.global_position.z)
	var b := Basis(Vector3.UP, _arm_yaw)
	var pivot := _arm_pos + Vector3(0, 1.0, 0)
	var want := _arm_pos + b * Vector3(0, chase_up, chase_back)
	var hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(pivot, want, 1))
	if not hit.is_empty():
		want = pivot.lerp(hit.position, 0.85) + Vector3(0, 0.6, 0)
	global_position = want + _kick
	look_at(_arm_pos + b * Vector3(0, chase_aim.y, -chase_aim.x), Vector3.UP)
