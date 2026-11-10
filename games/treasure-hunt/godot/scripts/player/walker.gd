class_name Walker
extends CharacterBody3D
## You, on foot: a capsule with a head, until a character pack lands.
## Walks, runs, jumps, and scrambles up ledges about 1 m high (spec §7.1).
## Moves relative to look_yaw, which main copies from the camera each tick.
## Origin is at the feet.

const RADIUS := 0.35
const HEIGHT := 1.8
const WALK_SPEED := 1.7 # 6 km/h, the spec's crossing speed (§4.3)
const RUN_SPEED := 3.4
const JUMP_VELOCITY := 4.5
const GRAVITY := 20.0
const ACCEL := 20.0 # m/s² towards the wanted speed on the ground
const AIR_ACCEL := 5.0 # a little steering in the air, not much
const TURN_RATE := 12.0 # how fast the body turns to face where it walks

## Moving into a ledge up to this high with jump held lifts you onto it.
const SCRAMBLE_HEIGHT := 1.0
const SCRAMBLE_S := 0.25
## Anything lower is a step or a jump, not a scramble.
const SCRAMBLE_MIN := 0.3
## How far past the capsule's front we look for the ledge's top.
const SCRAMBLE_REACH := 0.35

var input_enabled := true
var look_yaw := 0.0

var _move := Vector2.ZERO # x right, y forward
var _run := false
var _jump := false
var _jump_was := false
var _ground_y := 0.0 # feet height the last time we stood on something
var _shape: CapsuleShape3D

var _scramble_t := -1.0 # 0..1 while scrambling, -1 otherwise
var _scramble_from := Vector3.ZERO
var _scramble_to := Vector3.ZERO


func _init() -> void:
	floor_max_angle = deg_to_rad(40.0) # reachable on foot (§4.2)
	collision_layer = 2 # not 1, so the camera's spring arm looks past us
	collision_mask = 1 | 2 # the world, and the buggy: you can stand on its roof

	_shape = CapsuleShape3D.new()
	_shape.radius = RADIUS
	_shape.height = HEIGHT
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	cs.shape = _shape
	cs.position.y = HEIGHT * 0.5
	add_child(cs)

	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.85, 0.42, 0.18)
	mat.roughness = 0.8
	var body := MeshInstance3D.new()
	body.name = "Body"
	var cm := CapsuleMesh.new()
	cm.radius = RADIUS
	cm.height = HEIGHT
	body.mesh = cm
	body.position.y = HEIGHT * 0.5
	body.material_override = mat
	add_child(body)

	# Out the front, so you can see which way it faces.
	var head := MeshInstance3D.new()
	head.name = "Head"
	var sm := SphereMesh.new()
	sm.radius = 0.14
	sm.height = 0.28
	head.mesh = sm
	head.position = Vector3(0, HEIGHT - 0.3, -RADIUS + 0.05)
	var hm := StandardMaterial3D.new()
	hm.albedo_color = Color(0.95, 0.85, 0.7)
	head.material_override = hm
	add_child(head)


## Tests drive the walker with this (and input_enabled = false). Real input
## goes through it too, from the InputMap.
func set_move(input: Vector2, run: bool, jump: bool) -> void:
	_move = input.limit_length(1.0)
	_run = run
	_jump = jump


func is_scrambling() -> bool:
	return _scramble_t >= 0.0


func _physics_process(dt: float) -> void:
	if input_enabled:
		set_move(Input.get_vector("move_left", "move_right", "move_back", "move_forward"), Input.is_action_pressed("run"), Input.is_action_pressed("jump"))

	if is_scrambling():
		_step_scramble(dt)
		return

	var jump_pressed := _jump and not _jump_was
	_jump_was = _jump
	var on_floor := is_on_floor()
	if on_floor:
		_ground_y = global_position.y
	else:
		velocity.y -= GRAVITY * dt
	if jump_pressed and on_floor:
		velocity.y = JUMP_VELOCITY

	var dir := _wish_dir()
	var want := dir * (RUN_SPEED if _run else WALK_SPEED)
	var flat := Vector2(velocity.x, velocity.z).move_toward(Vector2(want.x, want.z), (ACCEL if on_floor else AIR_ACCEL) * dt)
	velocity.x = flat.x
	velocity.z = flat.y
	move_and_slide()

	if dir != Vector3.ZERO:
		rotation.y = lerp_angle(rotation.y, atan2(-dir.x, -dir.z), 1.0 - exp(-TURN_RATE * dt))
		if _jump and is_on_wall():
			_try_scramble(dir)


## Input turned into a world direction: forward at yaw θ is (−sin θ, 0, −cos θ).
func _wish_dir() -> Vector3:
	if _move == Vector2.ZERO:
		return Vector3.ZERO
	return Vector3(_move.x, 0, -_move.y).rotated(Vector3.UP, look_yaw)


## Looks down just past our front for a top we can stand on, between
## SCRAMBLE_MIN and SCRAMBLE_HEIGHT over a base height, with room for the
## whole capsule up there. The base is the ground we last stood on, so a
## jump doesn't add to the reach, or our feet if they're lower: off a ledge
## and falling, the old floor is too high to measure from.
func _try_scramble(dir: Vector3) -> void:
	var space := get_world_3d().direct_space_state
	var fwd := dir.normalized()
	var probe := global_position + fwd * (RADIUS + SCRAMBLE_REACH)
	var base := minf(_ground_y, global_position.y)
	var from := Vector3(probe.x, base + SCRAMBLE_HEIGHT + HEIGHT, probe.z)
	var to := Vector3(probe.x, base + SCRAMBLE_MIN * 0.5, probe.z)
	var q := PhysicsRayQueryParameters3D.create(from, to, collision_mask, [get_rid()])
	var hit := space.intersect_ray(q)
	if hit.is_empty():
		return
	var top: Vector3 = hit.position
	var rise := top.y - base
	if rise < SCRAMBLE_MIN or rise > SCRAMBLE_HEIGHT + 0.02:
		return
	# A steep face isn't a ledge, or you could climb any slope a metre at a time.
	if (hit.normal as Vector3).y < cos(floor_max_angle):
		return
	var stand := Vector3(probe.x, top.y + 0.02, probe.z)
	var p := PhysicsShapeQueryParameters3D.new()
	p.shape = _shape
	p.transform = Transform3D(Basis.IDENTITY, stand + Vector3(0, HEIGHT * 0.5 + 0.02, 0))
	p.collision_mask = collision_mask
	p.exclude = [get_rid()]
	if not space.intersect_shape(p, 1).is_empty():
		return
	_scramble_from = global_position
	_scramble_to = stand
	_scramble_t = 0.0
	velocity = Vector3.ZERO


## Up first, then over the edge: no collision on the way, the start and the
## end were both checked.
func _step_scramble(dt: float) -> void:
	_scramble_t = minf(1.0, _scramble_t + dt / SCRAMBLE_S)
	var up := smoothstep(0.0, 0.5, _scramble_t)
	var over := smoothstep(0.5, 1.0, _scramble_t)
	var a := _scramble_from
	var b := _scramble_to
	global_position = Vector3(lerpf(a.x, b.x, over), lerpf(a.y, b.y, up), lerpf(a.z, b.z, over))
	if _scramble_t >= 1.0:
		_scramble_t = -1.0
		_ground_y = b.y
		velocity = Vector3.ZERO
