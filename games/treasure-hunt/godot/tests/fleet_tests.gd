extends RefCounted
## M3's shared buggies, over main.tscn on layout_1 and the bridge seams:
## the fleet's modes (local, puppet, parked), asking for a seat and waiting
## for the server's say-so, riding as the passenger, and getting out.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
var main: Node3D
var bridge: WebBridge
var fleet: Fleet
var walker: Walker
var avatar: PlayerAvatar
var rig: RigCamera
var field: TerrainField
var seats: Array[Dictionary] = []
var unseats: Array[Dictionary] = []
var positions: Array[Dictionary] = []
## Where t0 sits, parked: 10 m to the right of the spawn.
var at0 := Vector3.ZERO


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("shared buggies")
	main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	field = main.field
	bridge = main.bridge
	fleet = main.get("fleet")
	walker = main.walker
	avatar = main.avatar
	rig = main.rig
	if field == null or fleet == null:
		check(false, "main builds layout_1 and has a fleet")
		main.queue_free()
		return
	walker.input_enabled = false
	bridge.seat_sent.connect(func(d: Dictionary) -> void: seats.append(d))
	bridge.unseat_sent.connect(func(d: Dictionary) -> void: unseats.append(d))
	bridge.pos_sent.connect(func(d: Dictionary) -> void: positions.append(d))
	var right := Vector3(cos(field.spawn_yaw), 0, -sin(field.spawn_yaw))
	at0 = field.spawn + right * 10.0
	await test_standalone()
	await test_ask_then_confirm()
	await test_exit()
	await test_lost_seat()
	await test_my_model()
	await test_puppet()
	await test_ride()
	await test_full()
	await test_pending_timeout()
	await test_parked()
	await test_phase_lock()
	await test_dropped_while_in()
	await test_new_seed()
	main.queue_free()
	await t.process_frame
	await test_reload_takes_seat_back()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _frames(n: int) -> void:
	for i in n:
		await t.physics_frame


func _v(id: String, x: float, z: float, driver: Variant = null, passenger: Variant = null, y: Variant = null, yaw := 0.0) -> Dictionary:
	return {"id": id, "x": x, "y": y, "z": z, "yaw": yaw, "driver": driver, "passenger": passenger}


func _t0(driver: Variant = null, passenger: Variant = null) -> Dictionary:
	return _v("t0", at0.x, at0.z, driver, passenger, null, field.spawn_yaw)


func _vehicles(list: Array, me := "me") -> void:
	bridge.receive_vehicles_json(JSON.stringify({"me": me, "list": list}))


func _to_door(b: Buggy) -> void:
	var door := b.to_global(PlayerAvatar.DOOR)
	walker.set_move(Vector2.ZERO, false, false)
	walker.global_position = Vector3(door.x, field.height_at(door.x, door.z) + 0.05, door.z)
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()
	main.streamer.ensure_around(door)
	await _frames(5)


## The yaw a pose is sent with: from the forward vector, not the Euler y.
func _yaw_of(n: Node3D) -> float:
	var f := -n.global_basis.z
	return atan2(-f.x, -f.z)


## Gets me into t0 the proper way: E, then a list naming me.
func _seat_in_t0(seat: String, others: Dictionary = {}) -> void:
	var b := fleet.get_buggy("t0")
	await _to_door(b)
	avatar.interact()
	var v := _t0(others.get("driver"), others.get("passenger"))
	v[seat] = "me"
	_vehicles([v])
	await _frames(1)


func test_standalone() -> void:
	check(not fleet.seen and fleet.count() == 1 and fleet.get_buggy("") == main.buggy, "before any vehicles call, the fleet is the one buggy, id \"\"")
	check(main.buggy.mode == &"local", "and it's a local buggy, as in M2")


## Review Focus 1: E only asks. Nothing moves until the server says so.
func test_ask_then_confirm() -> void:
	_vehicles([_t0()])
	var b := fleet.get_buggy("t0")
	check(fleet.seen and fleet.count() == 1 and fleet.get_buggy("") == null and b != null, "the first vehicles call swaps the standalone buggy for the list")
	await _to_door(b)
	seats.clear()
	check(avatar.interact(), "E by t0's door does something")
	check(seats.size() == 1 and seats[0] == {"vehicleId": "t0", "seat": "driver"}, "E asks for the driver's seat (%s)" % [seats])
	check(avatar.mode == &"foot" and walker.visible and b.driver == null, "E asks, doesn't enter until confirmed")
	check(avatar.pending_seat == {"id": "t0", "seat": "driver"}, "the ask is pending")
	_vehicles([_t0()]) # the same list again: a resync, not an answer
	check(avatar.mode == &"foot" and not avatar.pending_seat.is_empty(), "a repeat list that doesn't name me changes nothing")
	_vehicles([_t0("me")])
	check(avatar.mode == &"driving" and b.driver == walker and walker.model.state() == &"drive", "confirm as driver: in, with M2's enter")
	check(b.mode == &"local" and b.collision_layer == 2 and b.collision_mask == 1, "confirm as driver → local mode, collider on")
	check(rig.target == b and rig.profile == &"drive" and main.focus == b, "the camera and streamer follow t0")
	check(avatar.pending_seat.is_empty(), "the ask is answered")
	positions.clear()
	await _frames(15)
	var p: Dictionary = positions[-1] if positions.size() > 0 else {}
	check(p.get("v") == "t0" and p.get("foot") == false and absf(float(p.get("yaw", 99.0)) - snappedf(_yaw_of(b), 0.001)) < 0.002, "driving t0, a pos carries v t0, foot false and the forward yaw (%s)" % p)


## Me seated: the model shows at the seat, driving or sitting; on foot it's back on the walker.
func test_my_model() -> void:
	_vehicles([_t0()])
	await _seat_in_t0("driver")
	var b := fleet.get_buggy("t0")
	var m := walker.model
	check(avatar.mode == &"driving" and walker.visible and m.is_visible_in_tree() and m.state() == &"drive", "driving: my model is up, in the drive pose")
	check(m.global_position.distance_to(b.to_global(PlayerAvatar.SEAT)) < 0.15 and m.can_process(), "driving: at the seat, and animating")
	avatar.interact()
	check(avatar.mode == &"foot" and walker.visible and m.get_parent() == walker, "out: my model is the walker's again")
	await _frames(3)
	check(m.state() != &"drive", "out: motion states again (%s)" % m.state())
	_vehicles([_t0("p2")])
	await _seat_in_t0("passenger", {"driver": "p2"})
	check(avatar.mode == &"riding" and m.is_visible_in_tree() and m.state() == &"sit", "riding: sitting (%s, %s)" % [avatar.mode, m.state()])
	check(m.global_position.distance_to(b.to_global(PlayerAvatar.RIDE_SEAT)) < 0.15, "riding: at the passenger seat")
	avatar.interact()
	_vehicles([_t0()])
	await _frames(3)
	check(avatar.mode == &"foot" and m.state() != &"sit", "on foot again, no longer sitting (%s)" % m.state())


func test_exit() -> void:
	var b := fleet.get_buggy("t0")
	unseats.clear()
	check(avatar.interact() and avatar.mode == &"foot" and walker.visible, "E while driving gets out locally")
	var p := b.global_position
	var u: Dictionary = unseats[0] if unseats.size() == 1 else {}
	check(u.has_all(["x", "y", "z", "yaw"]) and Vector3(u.x, u.y, u.z).distance_to(p) < 0.02 and absf(angle_difference(float(u.yaw), _yaw_of(b))) < 0.002, "exit sends unseat with the pose (%s)" % [unseats])
	# The server hasn't heard yet: a resync still names me. Not back in.
	_vehicles([_t0("me")])
	check(avatar.mode == &"foot" and walker.visible, "after a local exit, a stale list still naming me doesn't pull me back in")
	seats.clear()
	check(not avatar.interact() and avatar.mode == &"foot" and seats.is_empty(), "nor does E on the buggy I just left, while the server catches up")
	_vehicles([_v("t0", p.x, p.z, null, null, p.y, _yaw_of(b))])
	check(b.mode == &"parked" and b.collision_layer == 2, "the list frees the seat: t0 is parked, collider on")
	_vehicles([_v("t0", p.x, p.z, "me", null, p.y, _yaw_of(b))])
	check(avatar.mode == &"driving" and b.driver == walker, "after a clearing list, a new list naming me takes the seat")
	avatar.interact()
	_vehicles([_v("t0", p.x, p.z, null, null, p.y, _yaw_of(b))])
	await _frames(1)
	check(not main.watched.has(b), "the fall check skips a parked buggy")


func test_lost_seat() -> void:
	await _seat_in_t0("driver")
	check(avatar.mode == &"driving", "back in t0")
	unseats.clear()
	_vehicles([_t0("p2")])
	check(avatar.mode == &"foot" and walker.visible and walker.process_mode != Node.PROCESS_MODE_DISABLED, "a list without me in my seat puts me out")
	check(unseats.is_empty(), "and sends no unseat: the server did it")
	_vehicles([_t0()])


## someone else drives → puppet, no collider, moved by the driver's stream.
func test_puppet() -> void:
	_vehicles([_t0("p2")])
	var b := fleet.get_buggy("t0")
	check(b.mode == &"puppet" and b.collision_layer == 0 and b.collision_mask == 0, "someone else drives → puppet, no collider")
	var to := at0 + Vector3(4, 0, 3)
	to.y = field.height_at(to.x, to.z)
	bridge.receive_remote_json(JSON.stringify({"id": "p2", "x": to.x, "y": to.y, "z": to.z, "yaw": 0.7, "foot": false, "v": "t0"}))
	await _frames(3)
	var mid := b.global_position
	await _frames(8)
	check(mid.distance_to(to) > 0.2 and b.global_position.distance_to(to) < 0.01, "the driver's snapshot moves it there over 100 ms")
	check(absf(angle_difference(_yaw_of(b), 0.7)) < 0.01, "facing the streamed yaw (%.3f)" % _yaw_of(b))
	# Pitch and roll from the ground under the wheels, not from the stream.
	var fwd := Vector3(-sin(0.7), 0, -cos(0.7))
	var rt := Vector3(-fwd.z, 0, fwd.x)
	var c := []
	for s in [[-1.0, -1.6], [1.0, -1.6], [-1.0, 1.6], [1.0, 1.6]]:
		var q: Vector3 = to + rt * s[0] - fwd * s[1]
		c.append(Vector3(q.x, field.height_at(q.x, q.z), q.z))
	var n: Vector3 = (c[3] - c[0]).cross(c[1] - c[2]).normalized()
	n = n if n.y > 0 else -n
	check(b.global_basis.y.normalized().dot(n) > 0.9999, "its up is the normal of the ground at the four wheels")
	bridge.receive_remote_json(JSON.stringify({"id": "p3", "x": to.x + 20.0, "y": to.y, "z": to.z, "yaw": 0.0, "foot": false, "v": "t0"}))
	await _frames(10)
	check(b.global_position.distance_to(to) < 0.01, "a passenger's snapshot doesn't move a puppet")
	await _frames(1)
	check(not main.watched.has(b), "the fall check skips a puppet")


func test_ride() -> void:
	var b := fleet.get_buggy("t0")
	seats.clear()
	await _to_door(b)
	avatar.interact()
	check(seats.size() == 1 and seats[0] == {"vehicleId": "t0", "seat": "passenger"}, "driver taken: E asks for the passenger seat (%s)" % [seats])
	check(avatar.mode == &"foot", "still on foot until the list says so")
	_vehicles([_t0("p2", "me")])
	check(avatar.mode == &"riding" and walker.process_mode == Node.PROCESS_MODE_DISABLED and walker.model.state() == &"sit", "named passenger: riding, the walker off and sitting")
	check(rig.target == b and rig.profile == &"ride", "the camera rides along, free look")
	check(b.mode == &"puppet" and b.driver == null, "the buggy is still p2's puppet")
	var seat := PlayerAvatar.SEAT + Vector3(0.9, 0, 0)
	await _frames(1)
	check(walker.global_position.distance_to(b.to_global(seat)) < 0.01, "passenger snaps to the seat")
	var to := b.global_position + Vector3(6, 0, 0)
	to.y = field.height_at(to.x, to.z)
	bridge.receive_remote_json(JSON.stringify({"id": "p2", "x": to.x, "y": to.y, "z": to.z, "yaw": 0.2, "foot": false, "v": "t0"}))
	positions.clear()
	await _frames(15)
	check(b.global_position.distance_to(to) < 0.01 and walker.global_position.distance_to(b.to_global(seat)) < 0.01, "passenger snaps to the seat and follows the puppet")
	var p: Dictionary = positions[-1] if positions.size() > 0 else {}
	var sp := b.to_global(seat)
	check(p.get("v") == "t0" and p.get("foot") == false and p.has("x") and Vector3(p.x, p.y, p.z).distance_to(sp) < 0.05, "riding streams the seat position with v t0 (%s)" % p)
	_vehicles([_v("t0", to.x, to.z, null, "me", to.y, 0.2)])
	await _frames(2)
	check(avatar.mode == &"riding" and b.mode == &"parked" and walker.global_position.distance_to(b.to_global(seat)) < 0.01, "the driver leaves while I ride: still riding, the buggy parked")
	unseats.clear()
	check(avatar.interact() and avatar.mode == &"foot" and walker.visible, "E while riding gets out")
	check(unseats.size() == 1 and Vector3(unseats[0].x, unseats[0].y, unseats[0].z).distance_to(b.global_position) < 0.02, "a passenger's exit sends unseat with the buggy's pose")
	check(rig.target == walker and rig.profile == &"walk", "the camera is back on the walker")
	_vehicles([_t0("p2")])


func test_full() -> void:
	_vehicles([_t0("p2", "p3")])
	var b := fleet.get_buggy("t0")
	await _to_door(b)
	seats.clear()
	check(not avatar.interact() and seats.is_empty() and avatar.mode == &"foot", "both seats taken: E does nothing")
	_vehicles([_t0()])


func test_pending_timeout() -> void:
	var b := fleet.get_buggy("t0")
	await _to_door(b)
	avatar.interact()
	check(not avatar.pending_seat.is_empty(), "asked again")
	await _frames(int(PlayerAvatar.PENDING_S * 60) + 5)
	check(avatar.pending_seat.is_empty() and avatar.mode == &"foot", "an ask nobody answers clears after 3 s")
	# The server did seat me after all: the seat is mine, so I take it.
	_vehicles([_t0("me")])
	check(avatar.mode == &"driving" and avatar.buggy == b, "a late yes after the timeout takes the seat")
	avatar.interact()
	_vehicles([_t0()])
	# Left by hand: the 3 s guard runs out, and a list naming me counts again.
	await _seat_in_t0("driver")
	avatar.interact()
	await _frames(int(PlayerAvatar.PENDING_S * 60) + 5)
	_vehicles([_t0("me")])
	check(avatar.mode == &"driving", "after the 3 s guard, a list naming me takes the seat")
	avatar.interact()
	_vehicles([_t0()])


func test_parked() -> void:
	var yaw := 0.6
	var at := field.spawn + Vector3(-12, 0, 6)
	_vehicles([_t0(), _v("t1", at.x, at.z, null, null, null, yaw)])
	var b := fleet.get_buggy("t1")
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var rt := Vector3(-fwd.z, 0, fwd.x)
	var hi := -INF
	for sx in [-0.5, 0.5]:
		for sz in [-0.5, 0.5]:
			var c: Vector3 = at + rt * sx * Buggy.BOX.x + fwd * sz * Buggy.BOX.z
			hi = maxf(hi, field.height_at(c.x, c.z))
	check(b != null and b.mode == &"parked" and absf(b.global_position.y - (hi + 0.05)) < 0.01, "parked y from the highest corner (%.2f vs %.2f)" % [b.global_position.y if b else 0.0, hi + 0.05])
	check(b != null and absf(angle_difference(_yaw_of(b), yaw)) < 0.001 and b.collision_layer == 2, "at its yaw, with a collider")
	var before := b.global_position
	await _frames(30)
	check(b.global_position.distance_to(before) < 0.001, "a parked buggy doesn't drift")
	_vehicles([_t0(), _v("t1", at.x, at.z, null, null, hi + 3.0, yaw)])
	check(absf(b.global_position.y - (hi + 3.0)) < 0.06, "a parked buggy with a y sits at it")
	_vehicles([_t0()])
	await _frames(1)
	check(fleet.get_buggy("t1") == null and fleet.count() == 1, "a vehicle gone from the list goes")


func test_dropped_while_in() -> void:
	_vehicles([_t0("me")])
	check(avatar.mode == &"driving", "in t0 again")
	unseats.clear()
	_vehicles([])
	check(avatar.mode == &"foot" and walker.visible and unseats.is_empty(), "a list that drops the buggy I'm in: out locally, nothing sent")
	await _frames(1)
	check(fleet.count() == 0 and fleet.get_child_count() == 0, "and the buggy is gone")
	_vehicles([_t0(), _v("t1", at0.x + 8, at0.z)])


func test_new_seed() -> void:
	main.start_world(t.layout(2))
	field = main.field
	await _frames(1)
	var buggies := main.find_children("*", "Buggy", true, false)
	check(fleet.count() == 2 and buggies.size() == 2 and fleet.get_child_count() == 2, "a new seed with fleet buggies: no leftover nodes (%d)" % buggies.size())
	check(fleet.get_buggy("t0").visible and fleet.get_buggy("t1").visible and fleet.get_buggy("t0").process_mode == Node.PROCESS_MODE_INHERIT, "they're back on the new ground")
	main._teardown()
	check(not fleet.get_buggy("t0").visible and fleet.get_buggy("t0").process_mode == Node.PROCESS_MODE_DISABLED, "and hidden while there's no world")


## I1: an iframe reload is a fresh Godot. The server still seats me, and
## the re-sent list has to put me back in that seat.
func test_reload_takes_seat_back() -> void:
	main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	bridge = main.bridge
	fleet = main.fleet
	avatar = main.avatar
	walker = main.walker
	field = main.field
	walker.input_enabled = false
	_vehicles([_t0("me")])
	var b := fleet.get_buggy("t0")
	check(avatar.mode == &"driving" and avatar.buggy == b and b.driver == walker and b.mode == &"local", "a fresh avatar with a list naming me as driver ends up driving")
	_vehicles([_t0("p2")])
	check(avatar.mode == &"foot", "out again")
	_vehicles([_t0("p2", "me")])
	check(avatar.mode == &"riding" and avatar.buggy == b and main.rig.profile == &"ride", "a fresh avatar with a list naming me as passenger ends up riding")
	main.queue_free()
	await t.process_frame


func test_phase_lock() -> void:
	_vehicles([_t0(), _v("t1", at0.x + 8, at0.z)])
	bridge.receive_phase_json(JSON.stringify({"phase": "countdown"}))
	check(fleet.get_buggy("t0").locked and fleet.get_buggy("t1").locked, "set_phase locks every buggy")
	bridge.receive_phase_json(JSON.stringify({"phase": "hunting"}))
	check(not fleet.get_buggy("t0").locked and not fleet.get_buggy("t1").locked, "and unlocks them")
