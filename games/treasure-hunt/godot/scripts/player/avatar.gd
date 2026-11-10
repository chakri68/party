class_name PlayerAvatar
extends Node
## You, as the game sees you: on foot, driving, or riding as the passenger.
## Holds the walker, the fleet and the camera, and moves you between them
## (spec §7.2, §7.3). main.gd routes the interact and reset_vehicle keys here
## and follows mode_changed to point the streamer at whatever you're
## controlling.
##
## Standalone (no vehicles list yet: headless, the editor) E gets you
## straight into the buggy, as in M2. Online, a seat is the server's: E only
## asks (seat_asked), and you get in when a list names you in that seat.
## Getting out is local and at once; unseated tells the server where.

signal mode_changed(mode: StringName)
## E by a cache, on foot. main sends it on as emitClaim.
signal claimed(id: String)
## E by a buggy, online. main sends it on as emitSeat.
signal seat_asked(vehicle_id: String, seat: String)
## You got out yourself, online: {x, y, z, yaw}, the buggy's pose. main
## sends it on as emitUnseat. (The server ignores it for a passenger.)
signal unseated(pose: Dictionary)

const ENTER_RANGE := 3.0
## In buggy space (-Z forward, +X right): just outside the driver's door,
## at ground level, and the seat you're snapped to while driving.
const DOOR := Vector3(-1.3, 0.0, -0.3)
const SEAT := Vector3(-0.45, 0.6, -0.2)
## The passenger's seat, across from the driver's.
const RIDE_SEAT := SEAT + Vector3(0.9, 0, 0)
## An ask nobody answered (turned down, or lost) is dropped after this.
const PENDING_S := 3.0
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
var fleet: Fleet
## The buggy you're in, driving or riding; null on foot.
var buggy: Buggy
var camera: RigCamera
## {id, seat} while an ask is out, else {}.
var pending_seat: Dictionary = {}
var pending_left := 0.0
var field: TerrainField ## for the reset's ground height; main sets it per world
var caches: Caches ## main sets it per world; null, there's nothing to pick up


func setup(w: Walker, f: Fleet, c: RigCamera) -> void:
	walker = w
	fleet = f
	camera = c
	fleet.applied.connect(_on_vehicles)


## On foot by a cache: pick it up (claimed, and the buggy's left alone).
## Else by a buggy's door: get in (standalone), or ask for a seat (online).
## In a buggy: get out, if there's room.
func interact() -> bool:
	if mode == &"driving" or mode == &"riding":
		return _get_out()
	var id := claimable()
	if id != "":
		caches.mark_claimed(id)
		claimed.emit(id)
		return true
	var b := _by_door()
	if b == null:
		return false
	if not fleet.seen:
		_enter(b, &"driver")
		return true
	var v := fleet.vehicle(b.id)
	var driver: Variant = v.get("driver")
	var passenger: Variant = v.get("passenger")
	# Already ours (a late yes after the ask timed out): no need to ask.
	if driver == fleet.me or passenger == fleet.me:
		_enter(b, &"driver" if driver == fleet.me else &"passenger")
		return true
	if not pending_seat.is_empty():
		return false
	var seat := "driver" if driver == null else ("passenger" if passenger == null else "")
	if seat == "":
		return false
	pending_seat = {"id": b.id, "seat": seat}
	pending_left = PENDING_S
	seat_asked.emit(b.id, seat)
	return true


## The buggy whose driver's door is closest, within ENTER_RANGE, or null.
func _by_door() -> Buggy:
	var best: Buggy = null
	var best_d := ENTER_RANGE
	for b in fleet.all():
		if not b.visible:
			continue
		var d := walker.global_position.distance_to(b.to_global(DOOR))
		if d <= best_d:
			best = b
			best_d = d
	return best


## Into `b`'s seat. The walker's hidden and out of physics either way;
## driving puts the keys on the buggy, riding only the camera.
func _enter(b: Buggy, seat: StringName) -> void:
	pending_seat = {}
	buggy = b
	# Disabled also takes it out of physics (disable_mode REMOVE), so nothing
	# bumps into a walker that's sitting in the seat.
	walker.set_move(Vector2.ZERO, false, false)
	walker.cancel_scramble()
	walker.process_mode = Node.PROCESS_MODE_DISABLED
	walker.visible = false
	if seat == &"driver":
		buggy.driver = walker
		_snap_to_seat()
		camera.follow(buggy, &"drive")
		_set_mode(&"driving")
	else:
		_snap_to_seat()
		camera.follow(buggy, &"ride")
		_set_mode(&"riding")


## A new vehicles list (the fleet has already set the modes). Out if the
## seat you're in isn't yours any more; in if it answers your ask.
func _on_vehicles() -> void:
	if buggy != null:
		var held: Variant = fleet.vehicle(buggy.id).get("driver" if mode == &"driving" else "passenger")
		if held != fleet.me:
			_get_out(true)
	if pending_seat.is_empty():
		return
	var v := fleet.vehicle(pending_seat.id)
	var holder: Variant = v.get(pending_seat.seat)
	if v.is_empty() or (holder != null and holder != fleet.me):
		pending_seat = {}
	elif holder == fleet.me and mode == &"foot":
		var b := fleet.get_buggy(pending_seat.id)
		if b != null:
			_enter(b, StringName(pending_seat.seat))


## The vehicle you're in, for the pos stream: null on foot and in the
## standalone buggy.
func vehicle_id() -> Variant:
	return buggy.id if buggy != null and buggy.id != "" else null


## The cache E would pick up right now, or "". Only on foot.
func claimable() -> String:
	if mode != &"foot" or caches == null:
		return ""
	return caches.nearest_claimable(walker.global_position)


## Puts the buggy back on its wheels, 1 m over the ground where it is. Only
## when it's stuck (throttle held, going nowhere, for STUCK_S) or tipped,
## and only from the seat or from beside it, not from across the map.
## Only a local buggy (one whose physics are ours): the one you drive, or
## one beside you.
func reset_vehicle() -> bool:
	if mode == &"riding":
		return false
	var b := buggy if mode == &"driving" else _near_local()
	if field == null or b == null or (b.stuck_s < STUCK_S and b.tilt_deg() <= RESET_TILT_DEG):
		return false
	var p := b.global_position
	b.place_upright(Vector3(p.x, field.height_at(p.x, p.z) + 1.0, p.z))
	if mode == &"driving":
		_snap_to_seat()
	return true


func _near_local() -> Buggy:
	for b in fleet.local_buggies():
		if walker.global_position.distance_to(b.global_position) <= ENTER_RANGE:
			return b
	return null


## Back on foot, no questions asked (a new world is being built).
func on_foot() -> void:
	if buggy != null and mode == &"driving":
		buggy.driver = null
		buggy.set_control(0, 0, 0)
	buggy = null
	pending_seat = {}
	_set_mode(&"foot")


func _physics_process(dt: float) -> void:
	if mode == &"driving" or mode == &"riding":
		_snap_to_seat()
	if not pending_seat.is_empty():
		pending_left -= dt
		if pending_left <= 0.0:
			pending_seat = {}


func _snap_to_seat() -> void:
	walker.global_transform = buggy.global_transform * Transform3D(Basis.IDENTITY, RIDE_SEAT if mode == &"riding" else SEAT)


## Out at the first clear spot. `forced` (the server took the seat away):
## out even with nowhere clear (on the roof's spot), and nothing to tell it.
func _get_out(forced := false) -> bool:
	var spot: Variant = _exit_spot()
	if spot == null:
		if not forced:
			return false
		spot = buggy.to_global(Vector3(0, Buggy.BOX_Y + Buggy.BOX.y * 0.5, 0)) + Vector3(0, 0.05, 0)
	var fwd := Buggy.flat_forward(buggy.global_basis)
	walker.global_transform = Transform3D(Basis(Vector3.UP, atan2(-fwd.x, -fwd.z)), spot)
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()
	walker.process_mode = Node.PROCESS_MODE_INHERIT
	walker.visible = true
	if mode == &"driving":
		buggy.driver = null
		buggy.set_control(0, 0, 0)
	if fleet.seen and not forced:
		var p := buggy.global_position
		unseated.emit({"x": snappedf(p.x, 0.01), "y": snappedf(p.y, 0.01), "z": snappedf(p.z, 0.01), "yaw": snappedf(Fleet.yaw_of(buggy), 0.001)})
	buggy = null
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
