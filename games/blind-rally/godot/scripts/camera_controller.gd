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


func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	size = view_size
	near = 1.0
	far = distance * 2.5
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


func snap() -> void:
	_focus = target.global_position
	_lead = Vector3.ZERO
	_kick = Vector3.ZERO
	_kick_vel = Vector3.ZERO
	_yaw = target.global_rotation.y if rotate_with_car else 0.0
	_place()


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
