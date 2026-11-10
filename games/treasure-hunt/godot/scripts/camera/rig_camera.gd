class_name RigCamera
extends Node3D
## Third-person camera: this node sits at the pivot over the target and
## turns (yaw, then pitch); a SpringArm3D runs back along +Z and keeps the
## camera out of the ground (spec §7.1). follow() swaps profiles and blends
## length, pivot and pitch over BLEND_S (§7.3, getting in and out).

const BLEND_S := 0.4
const SENSITIVITY := 0.003 # rad per pixel
const PITCH_MIN := -70.0 * PI / 180.0
const PITCH_MAX := 30.0 * PI / 180.0
## Drive: with the mouse still this long, the yaw swings back behind.
const DRIFT_AFTER_S := 1.5
const DRIFT_RATE := 2.0 # 1/s, exponential

const PROFILES := {
	&"walk": {"length": 4.0, "pivot": 1.5, "pitch": -15.0},
	&"drive": {"length": 7.0, "pivot": 2.0, "pitch": -12.0},
}

var yaw := 0.0
var pitch := deg_to_rad(-15.0)
var target: Node3D
var profile: StringName = &"walk"
var arm: SpringArm3D
var camera: Camera3D

var _blend := 1.0 # 0..1, 1 = settled on the profile
var _from_len := 4.0
var _from_pivot := Vector3.ZERO
var _from_pitch := 0.0
var _to_pitch := 0.0
var _since_look := 0.0


func _init() -> void:
	# Placed every frame from the target's interpolated transform, so the
	# engine mustn't interpolate it again.
	physics_interpolation_mode = PHYSICS_INTERPOLATION_MODE_OFF
	arm = SpringArm3D.new()
	arm.name = "Arm"
	arm.collision_mask = 1
	arm.spring_length = PROFILES[&"walk"].length
	arm.margin = 0.2
	var ball := SphereShape3D.new()
	ball.radius = 0.2 # a ray lets the near plane graze slopes
	arm.shape = ball
	add_child(arm)
	camera = Camera3D.new()
	camera.name = "Camera"
	camera.near = 0.05
	camera.far = 1500.0
	camera.current = true
	arm.add_child(camera)


## Follow `t` with a profile. The first follow snaps; later ones blend from
## wherever the camera is now.
func follow(t: Node3D, p: StringName) -> void:
	assert(PROFILES.has(p), "unknown camera profile %s" % p)
	var first := target == null or not is_instance_valid(target)
	if not first and target is CollisionObject3D:
		arm.remove_excluded_object((target as CollisionObject3D).get_rid())
	_from_len = arm.spring_length
	_from_pivot = global_position
	_from_pitch = pitch
	_to_pitch = deg_to_rad(PROFILES[p].pitch)
	target = t
	profile = p
	if t is CollisionObject3D:
		arm.add_excluded_object((t as CollisionObject3D).get_rid())
	_since_look = 0.0
	if first:
		snap()
	else:
		_blend = 0.0


## Jump straight to the profile (after a teleport or a new world).
func snap() -> void:
	_blend = 1.0
	pitch = _to_pitch
	if target:
		_place(target.global_transform, 0.0)


## Mouse look. Called from captured mouse motion, or directly by tests.
func add_look(delta: Vector2) -> void:
	yaw = wrapf(yaw - delta.x * SENSITIVITY, -PI, PI)
	var p := clampf(pitch - delta.y * SENSITIVITY, PITCH_MIN, PITCH_MAX)
	var dp := p - pitch
	pitch = p
	_from_pitch = clampf(_from_pitch + dp, PITCH_MIN, PITCH_MAX)
	_to_pitch = clampf(_to_pitch + dp, PITCH_MIN, PITCH_MAX)
	_since_look = 0.0


func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and _can_capture():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif e.is_action_pressed("release_mouse") and _can_capture():
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		add_look((e as InputEventMouseMotion).relative)


static func _can_capture() -> bool:
	return DisplayServer.get_name() != "headless"


func _process(dt: float) -> void:
	if target == null or not is_instance_valid(target):
		return
	_place(target.get_global_transform_interpolated(), dt)


## Where a body is heading: its -Z flattened onto the ground plane, so a
## pitched or rolled buggy still reads as facing the same way. Nose straight
## up or down, -Z has no flat part and the roof says which way it was going.
static func heading(b: Basis) -> Vector3:
	var f := -b.z
	var flat := Vector3(f.x, 0, f.z)
	if flat.length_squared() < 1e-6:
		flat = -b.y * signf(f.y)
		flat.y = 0
	return flat.normalized() if flat.length_squared() > 1e-12 else Vector3.FORWARD


func _place(at: Transform3D, dt: float) -> void:
	var prof: Dictionary = PROFILES[profile]
	_since_look += dt
	if profile == &"drive" and _since_look > DRIFT_AFTER_S:
		# Behind = looking where the target is heading, flat on the ground.
		var f := heading(at.basis)
		yaw = lerp_angle(yaw, atan2(-f.x, -f.z), 1.0 - exp(-DRIFT_RATE * dt))
	var pivot := at.origin + Vector3.UP * float(prof.pivot)
	var length := float(prof.length)
	if _blend < 1.0:
		_blend = minf(1.0, _blend + dt / BLEND_S)
		if _blend > 0.999:
			_blend = 1.0
		var e := smoothstep(0.0, 1.0, _blend)
		pivot = _from_pivot.lerp(pivot, e)
		length = lerpf(_from_len, length, e)
		pitch = lerpf(_from_pitch, _to_pitch, e)
	global_position = pivot
	rotation = Vector3(pitch, yaw, 0.0)
	arm.spring_length = length
