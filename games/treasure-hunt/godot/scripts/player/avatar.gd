class_name PlayerAvatar
extends Node
## You, as the game sees you: on foot or driving. Holds the walker, the
## buggy and the camera, and moves you between them (spec §7.3). main.gd
## routes the interact and reset_vehicle keys here and follows mode_changed
## to point the streamer at whatever you're controlling.

signal mode_changed(mode: StringName)

const ENTER_RANGE := 3.0
## In buggy space (-Z forward, +X right): just outside the driver's door,
## at ground level, and the seat you're snapped to while driving.
const DOOR := Vector3(-1.3, 0.0, -0.3)
const SEAT := Vector3(-0.45, 0.6, -0.2)
## Ways out, in order: left door, right door, behind. The roof comes last.
const EXITS: Array[Vector3] = [Vector3(-2, 0, 0), Vector3(2, 0, 0), Vector3(0, 0, 3)]
## Ground under an exit spot is looked for this far above and below the buggy.
const EXIT_PROBE_UP := 2.5
const EXIT_PROBE_DOWN := 3.0
## §7.2: reset after 2 s stuck, or once it's on its side.
const STUCK_S := 2.0
const RESET_TILT_DEG := 60.0

var mode: StringName = &"foot"
var walker: Walker
var buggy: Buggy
var camera: RigCamera
var field: TerrainField ## for the reset's ground height; main sets it per world


func setup(w: Walker, b: Buggy, c: RigCamera) -> void:
	walker = w
	buggy = b
	camera = c


## Get in if you're by the door, get out if you're driving and there's room.
func interact() -> bool:
	if mode == &"driving":
		return _get_out()
	if walker.global_position.distance_to(buggy.to_global(DOOR)) > ENTER_RANGE:
		return false
	# Disabled also takes it out of physics (disable_mode REMOVE), so nothing
	# bumps into a walker that's sitting in the seat.
	walker.set_move(Vector2.ZERO, false, false)
	walker.cancel_scramble()
	walker.process_mode = Node.PROCESS_MODE_DISABLED
	walker.visible = false
	_snap_to_seat()
	buggy.driver = walker
	camera.follow(buggy, &"drive")
	_set_mode(&"driving")
	return true


## Puts the buggy back on its wheels, 1 m over the ground where it is. Only
## when it's stuck (throttle held, going nowhere, for STUCK_S) or tipped,
## and only from the seat or from beside it, not from across the map.
func reset_vehicle() -> bool:
	if field == null or (buggy.stuck_s < STUCK_S and buggy.tilt_deg() <= RESET_TILT_DEG):
		return false
	if mode != &"driving" and walker.global_position.distance_to(buggy.global_position) > ENTER_RANGE:
		return false
	var p := buggy.global_position
	buggy.place_upright(Vector3(p.x, field.height_at(p.x, p.z) + 1.0, p.z))
	if mode == &"driving":
		_snap_to_seat()
	return true


## Back on foot, no questions asked (a new world is being built).
func on_foot() -> void:
	buggy.driver = null
	buggy.set_control(0, 0, 0)
	_set_mode(&"foot")


func _physics_process(_dt: float) -> void:
	if mode == &"driving":
		_snap_to_seat()


func _snap_to_seat() -> void:
	walker.global_transform = buggy.global_transform * Transform3D(Basis.IDENTITY, SEAT)


func _get_out() -> bool:
	var spot: Variant = _exit_spot()
	if spot == null:
		return false
	var fwd := Buggy.flat_forward(buggy.global_basis)
	walker.global_transform = Transform3D(Basis(Vector3.UP, atan2(-fwd.x, -fwd.z)), spot)
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()
	walker.process_mode = Node.PROCESS_MODE_INHERIT
	walker.visible = true
	buggy.driver = null
	buggy.set_control(0, 0, 0)
	camera.follow(walker, &"walk")
	_set_mode(&"foot")
	return true


## Feet position of the first clear way out, or null. Side and back spots
## stand on whatever ground is under them, so a slope doesn't rule them out.
func _exit_spot() -> Variant:
	var space := buggy.get_world_3d().direct_space_state
	var o := buggy.global_position
	var fwd := Buggy.flat_forward(buggy.global_basis)
	var right := Vector3(-fwd.z, 0, fwd.x)
	for e in EXITS:
		var at := o + right * e.x - fwd * e.z
		var ray := PhysicsRayQueryParameters3D.create(Vector3(at.x, o.y + EXIT_PROBE_UP, at.z), Vector3(at.x, o.y - EXIT_PROBE_DOWN, at.z), 1)
		var hit := space.intersect_ray(ray)
		var feet := Vector3(at.x, (hit.position as Vector3).y if hit else o.y, at.z) + Vector3(0, 0.05, 0)
		if _clear(space, feet):
			return feet
	var roof := buggy.to_global(Vector3(0, Buggy.BOX_Y + Buggy.BOX.y * 0.5, 0)) + Vector3(0, 0.05, 0)
	return roof if _clear(space, roof) else null


## Would the walker's capsule, standing at `feet`, touch anything?
func _clear(space: PhysicsDirectSpaceState3D, feet: Vector3) -> bool:
	var cap := CapsuleShape3D.new()
	cap.radius = Walker.RADIUS
	cap.height = Walker.HEIGHT
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = cap
	q.transform = Transform3D(Basis.IDENTITY, feet + Vector3(0, Walker.HEIGHT * 0.5, 0))
	q.collision_mask = walker.collision_mask
	q.exclude = [walker.get_rid()]
	return space.intersect_shape(q, 1).is_empty()


func _set_mode(m: StringName) -> void:
	if m == mode:
		return
	mode = m
	mode_changed.emit(m)
