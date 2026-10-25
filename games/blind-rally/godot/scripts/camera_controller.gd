class_name FollowCamera
extends Camera3D
## Tilted orthographic follow camera for the Navigator (spec §4.2). Centred a
## little ahead of the car so there's more road in front than behind.
## North-up by default; rotate_with_car is the optional "camera rotation".

@export var target: Node3D
@export var pitch_deg := 55.0 ## down-tilt from horizontal
@export var distance := 80.0 ## along the view axis; ortho, so only clipping cares
@export var view_size := 42.0 ## ortho height in metres
@export var zoom_range := Vector2(28.0, 64.0) ## limited zoom, per spec
@export var look_ahead := 0.35 ## seconds of velocity to lead by
@export var smoothing := 6.0 ## 1/s
@export var rotate_with_car := false

var _focus := Vector3.ZERO
var _yaw := 0.0


func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	size = view_size
	near = 1.0
	far = distance * 2.5
	if target:
		snap()


func snap() -> void:
	_focus = target.global_position
	_yaw = target.global_rotation.y if rotate_with_car else 0.0
	_place()


func zoom(step: float) -> void:
	view_size = clampf(view_size * step, zoom_range.x, zoom_range.y)
	size = view_size


func _process(dt: float) -> void:
	if not target:
		return
	var lead := Vector3.ZERO
	if target is CharacterBody3D:
		var v: Vector3 = (target as CharacterBody3D).velocity
		lead = Vector3(v.x, 0, v.z) * look_ahead
	var k := 1.0 - exp(-smoothing * dt)
	_focus = _focus.lerp(target.global_position + lead, k)
	if rotate_with_car:
		_yaw = lerp_angle(_yaw, target.global_rotation.y, k)
	_place()


func _place() -> void:
	var pitch := deg_to_rad(pitch_deg)
	var back := Basis(Vector3.UP, _yaw) * Vector3(0, sin(pitch), cos(pitch))
	global_position = _focus + back * distance
	look_at(_focus, Vector3.UP)
