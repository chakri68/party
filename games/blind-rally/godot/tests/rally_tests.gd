extends RefCounted
## Rally (rally-spec.md): initSession `selfDrive` and `keyboard`, the car
## driven from this device. The keyboard drives in the room, the page's
## receiveControl still does, no guess pins, R asks the server for a reset,
## and the shared-stage ghosts still feed. Run from run_tests.gd, with its
## helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
var main: Node3D
var car: CarController
var map: MapController
var events: Array = []

const RALLY := {"room": true, "selfDrive": true, "keyboard": true, "ghosts": true,
	"teamColor": "#56b4e9", "teamNumber": 2, "teamShape": "square",
	"assists": {"liveMarker": true, "tripMeter": true, "paceNotes": true, "camera3d": true}}


func _init(runner) -> void:
	t = runner


func run() -> void:
	main = t.main
	car = t.car
	map = t.map
	main.bridge.physics_event.connect(_on_event)
	await test_keyboard_drives()
	await test_control_still_drives()
	await test_no_pins()
	await test_r_asks()
	await test_ghost_feed()
	await test_rematch_session()
	main.bridge.physics_event.disconnect(_on_event)
	car.keyboard_enabled = false
	map.restore_pins({})
	t._probe_session()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _on_event(ev: Dictionary) -> void:
	events.append(ev)


func _start() -> void:
	t._probe_session()
	main._on_session(RALLY, "")
	main._on_race_event({"kind": "go"})
	await t.place(main.track.get_spawn().global_transform)
	await t.idle(0.2)


func _hold(code: Key, down: bool) -> void:
	var k := InputEventKey.new()
	k.physical_keycode = code
	k.keycode = code
	k.pressed = down
	Input.parse_input_event(k)
	Input.flush_buffered_events()


## Laptop: W in the course's own window drives, with no receiveControl at all.
func test_keyboard_drives() -> void:
	print("rally: keyboard")
	await _start()
	check(car.keyboard_enabled, "selfDrive session: keyboard on")
	var from := car.global_position
	_hold(KEY_W, true)
	await t.idle(1.5)
	_hold(KEY_W, false)
	var moved := car.global_position.distance_to(from)
	check(moved > 5.0, "W held 1.5 s: %.1f m" % moved)
	# Blind Rally's Navigator: the same keys do nothing.
	main._on_session({"room": true}, "")
	await t.place(main.track.get_spawn().global_transform)
	await t.idle(0.2)
	from = car.global_position
	_hold(KEY_W, true)
	await t.idle(1.0)
	_hold(KEY_W, false)
	check(car.global_position.distance_to(from) < 0.5 and not car.keyboard_enabled, "Blind Rally Navigator: W is dead")


## Phone: the page's pads come in on receiveControl, same as a Driver's relay did.
func test_control_still_drives() -> void:
	print("rally: pads")
	await _start()
	var from := car.global_position
	await t.drive(1.5, 0.0, 1.0, 0.0)
	check(car.global_position.distance_to(from) > 5.0, "set_control at 30 Hz drives a selfDrive car")
	# Held while frozen (countdown): nothing moves.
	main._on_race_event({"kind": "freeze"})
	await t.place(main.track.get_spawn().global_transform)
	await t.idle(0.3) # let it settle on its wheels first
	from = car.global_position
	await t.drive(1.0, 0.0, 1.0, 0.0)
	check(car.global_position.distance_to(from) < 0.5, "frozen until GO, pads or not")
	main._on_race_event({"kind": "go"})


## The map shows the car: a tap on the open big map closes it, no pin.
func test_no_pins() -> void:
	print("rally: no guess pins")
	await _start()
	check(not map.pins_enabled, "selfDrive: pins off")
	main.set_map_expanded(true, false)
	await t.process_frame
	check(not map.pinnable(), "the open big map doesn't take one")
	events.clear()
	await t.click(map.get_global_rect().get_center())
	await t.settle()
	check(map.pin == null and not events.any(func(e: Dictionary) -> bool: return e.get("kind") == "pin"), "a tap places nothing, says nothing")
	check(not main.map_expanded, "and closes the big map")
	main._on_session({"room": true}, "")
	check(map.pins_enabled, "a Blind Rally session turns them back on")


## R: the room owns resets, so a selfDrive R asks; nothing moves until the server says.
func test_r_asks() -> void:
	print("rally: R asks for a reset")
	await _start()
	await t.drive(1.0, 0.0, 1.0, 0.0)
	var at := car.global_position
	var before := int(main.recoveries)
	events.clear()
	await t._press(KEY_R)
	var asks := events.filter(func(e: Dictionary) -> bool: return e.get("kind") == "reset")
	check(asks.size() == 1, "one {kind: reset} on the bridge")
	check(main.recoveries == before and car.global_position.distance_to(at) < 3.0, "and no local teleport")
	main._on_session({"room": true}, "")
	events.clear()
	await t._press(KEY_R)
	check(events.is_empty(), "Blind Rally's Navigator: R is dead in the room")


## A rematch on the same Godot: the page sends the session again, from the new
## run. Last race's gates and finish don't carry over.
func test_rematch_session() -> void:
	print("rally: rematch on the same Godot")
	await _start()
	main.checkpoints_passed = track_gates()
	main.bridge.checkpoint_hint = main.checkpoints_passed
	main.finished = true
	var again: Dictionary = RALLY.duplicate()
	again["checkpoints"] = 0
	again["holdMs"] = 0
	main._on_session(again, "")
	await t.idle(0.2)
	check(main.checkpoints_passed == 0 and main.bridge.checkpoint_hint == 0, "gates back to 0, the hint too")
	check(not main.finished, "and the finish can be crossed again")
	var spawn: Vector3 = main.track.recovery_for(0).global_position
	check(car.global_position.distance_to(spawn) < 3.0, "the car's back at the start")


func track_gates() -> int:
	return main.track.get_checkpoints().size()


## Shared stage: ghosts still arrive and draw while this device drives.
func test_ghost_feed() -> void:
	print("rally: ghosts")
	await _start()
	var g: GhostCars = main.ghosts
	check(g.enabled and g.own_team == 2, "ghosts on, own car is 2")
	var o := car.global_position + Vector3(0, 0, -20)
	g.receive(2, {"t": "ghost", "teamId": 2, "color": "#56b4e9", "tick": 1, "position": [o.x, o.y, o.z], "heading": 0.0, "speed": 10.0})
	check(g.count() == 0, "our own relay, if one ever came, draws nothing")
	for i in 4:
		g.receive(1, {"t": "ghost", "teamId": 1, "color": "#e69f00", "tick": i, "position": [o.x, o.y, o.z - i], "heading": 0.0, "speed": 10.0})
		await t.idle(0.1)
	check(g.count() == 1 and g.ghost_node(1) != null, "a rival's relays make one ghost")
	var from := car.global_position
	await t.drive(1.0, 0.0, 1.0, 0.0)
	check(car.global_position.distance_to(from) > 3.0, "and our car still drives under it")
	g.clear()
