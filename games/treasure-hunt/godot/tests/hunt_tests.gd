extends RefCounted
## M2's hunt, Godot side: caches revealed and found through the bridge,
## claiming with E, the phase's input lock, the compass, and the position
## stream. Over main.tscn with layout_1 (built by _ready off-web).
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
var main: Node3D
var bridge: WebBridge
var walker: Walker
var avatar: PlayerAvatar
var field: TerrainField

var claims: Array[Dictionary] = []
var positions: Array[Dictionary] = []


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("hunt")
	main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	bridge = main.bridge
	walker = main.walker
	avatar = main.avatar
	field = main.field
	if field == null:
		check(false, "main builds layout_1")
		main.queue_free()
		return
	walker.input_enabled = false
	bridge.claim_sent.connect(func(d: Dictionary) -> void: claims.append(d))
	bridge.pos_sent.connect(func(d: Dictionary) -> void: positions.append(d))
	check(main.phase == &"hunting", "off-web with no host, the phase starts as hunting")
	await t.physics_frame
	test_reveal()
	test_nearest()
	await test_claim()
	await test_one_press_one_claim()
	await test_claim_beats_the_buggy()
	await test_no_claim_from_the_buggy()
	await test_phase_lock()
	await test_compass()
	await test_pos_stream()
	await test_reveal_before_world()
	test_same_seed_new_round()
	main.queue_free()
	await t.process_frame


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _frames(n: int) -> void:
	for i in n:
		await t.physics_frame


## A spot `d` metres ahead of the spawn, well clear of the buggy.
func _ahead(d: float) -> Vector3:
	var fwd := Vector3(-sin(field.spawn_yaw), 0, -cos(field.spawn_yaw))
	var p := field.spawn + fwd * d
	p.y = field.height_at(p.x, p.z)
	return p


func _reveal(id: String, at: Vector3, dy := 0.0) -> void:
	bridge.receive_reveal_json(JSON.stringify({"id": id, "x": at.x, "z": at.z, "dy": dy}))


## The walker on the ground at `at`, still.
func _put(at: Vector3) -> void:
	walker.set_move(Vector2.ZERO, false, false)
	main.streamer.ensure_around(at)
	walker.global_position = Vector3(at.x, field.height_at(at.x, at.z) + 0.05, at.z)
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()


func test_reveal() -> void:
	var at := _ahead(20)
	_reveal("c1", at)
	_reveal("c1", at)
	var caches: Caches = main.caches
	check(caches != null and caches.count() == 1, "a repeated reveal makes one crate (%d)" % (caches.count() if caches else -1))
	var crate: Node3D = caches.crate("c1") if caches else null
	check(crate != null and absf(crate.global_position.y - field.height_at(at.x, at.z)) <= 0.05, "the crate sits on the ground")
	_reveal("c1b", _ahead(26), 0.6)
	var up: Node3D = caches.crate("c1b")
	var g := _ahead(26)
	check(up != null and absf(up.global_position.y - (g.y + 0.6)) <= 0.05, "dy lifts the crate off the ground")
	var collide := up != null and not up.find_children("*", "CollisionObject3D", true, false).is_empty()
	check(up != null and not collide, "a crate has no collider")


func test_nearest() -> void:
	var caches: Caches = main.caches
	var at := _ahead(40)
	_reveal("c2", at)
	var side := Vector3(1, 0, 0)
	var far := at + side * 3.5
	var near := at + side * 2.5
	far.y = field.height_at(far.x, far.z)
	near.y = field.height_at(near.x, near.z)
	check(caches.nearest_claimable(far) == "", "nothing is claimable at 3.5 m")
	check(caches.nearest_claimable(near) == "c2", "the cache is claimable at 2.5 m")
	bridge.receive_found_json(JSON.stringify({"id": "c2"}))
	check(caches.nearest_claimable(near) == "", "a found cache isn't claimable")


func test_claim() -> void:
	var at := _ahead(60)
	_reveal("c3", at)
	_put(at + Vector3(1.0, 0, 0))
	await _frames(10)
	main.prompt_tick()
	check(main.prompt.visible, "on foot by a cache, the prompt shows")
	check(main.prompt.text == "Press E to pick up", "the prompt reads \"Press E to pick up\"")
	claims.clear()
	var ok := avatar.interact()
	check(ok and avatar.mode == &"foot", "interact by a cache claims it and stays on foot")
	check(claims.size() == 1 and claims[0].get("id") == "c3", "emitClaim fires with the id (%s)" % [claims])
	bridge.receive_found_json(JSON.stringify({"id": "c3"}))
	var crate: Node3D = main.caches.crate("c3")
	await t.create_timer(0.45).timeout
	check(crate != null and not crate.visible, "a found crate is gone after its scale-down")
	main.prompt_tick()
	check(not main.prompt.visible, "and the prompt goes with it")


## Two presses inside one round trip send one claim. With no found back
## (a reject), the hold lapses after 1.5 s and E claims again.
func test_one_press_one_claim() -> void:
	var at := _ahead(70)
	_reveal("c6", at)
	_put(at + Vector3(1.0, 0, 0))
	await _frames(10)
	claims.clear()
	avatar.interact()
	avatar.interact()
	check(claims.size() == 1, "two quick presses send one claim (%d)" % claims.size())
	main.prompt_tick()
	check(not main.prompt.visible, "no prompt while the claim is out")
	await t.create_timer(0.5).timeout
	avatar.interact()
	check(claims.size() == 1, "still one claim 0.5 s on")
	await t.create_timer(1.1).timeout
	avatar.interact()
	check(claims.size() == 2 and claims[1].get("id") == "c6", "1.5 s with no found: E claims again (%d)" % claims.size())
	bridge.receive_found_json(JSON.stringify({"id": "c6"}))
	check(main.caches.nearest_claimable(walker.global_position) == "", "found ends it")
	# The prompt is for the round only.
	_reveal("c7", _ahead(80))
	_put(_ahead(80) + Vector3(1.0, 0, 0))
	await _frames(10)
	bridge.receive_phase_json(JSON.stringify({"phase": "countdown"}))
	main.prompt_tick()
	check(not main.prompt.visible, "no prompt in countdown")
	bridge.receive_phase_json(JSON.stringify({"phase": "hunting"}))
	main.prompt_tick()
	check(main.prompt.visible, "it's back in hunting")
	bridge.receive_found_json(JSON.stringify({"id": "c7"}))


## Standing at the buggy's door with a cache right there, E picks up.
func test_claim_beats_the_buggy() -> void:
	var door: Vector3 = main.buggy.to_global(PlayerAvatar.DOOR)
	_put(door)
	await _frames(10)
	_reveal("c4", walker.global_position + Vector3(0, 0, 0.5))
	claims.clear()
	var ok := avatar.interact()
	check(ok and avatar.mode == &"foot" and claims.size() == 1 and claims[0].get("id") == "c4", "at the door with a cache by you, E claims instead of getting in")
	bridge.receive_found_json(JSON.stringify({"id": "c4"}))


func test_no_claim_from_the_buggy() -> void:
	var door: Vector3 = main.buggy.to_global(PlayerAvatar.DOOR)
	_put(door)
	await _frames(10)
	check(avatar.interact() and avatar.mode == &"driving", "got in the buggy")
	_reveal("c5", walker.global_position + Vector3(0, 0, 0.5))
	main.prompt_tick()
	check(not main.prompt.visible, "no prompt while driving")
	claims.clear()
	avatar.interact()
	check(claims.is_empty(), "interact in the buggy by a cache doesn't claim")
	if avatar.mode == &"driving":
		avatar.on_foot()
	await _frames(5)
	bridge.receive_found_json(JSON.stringify({"id": "c5"}))


func test_phase_lock() -> void:
	# A flat slab well over the terrain, so held W is the only thing moving us.
	var top := field.spawn.y + 30.0
	var slab := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(40, 1, 40)
	cs.shape = box
	slab.add_child(cs)
	main.add_child(slab)
	slab.global_position = Vector3(field.spawn.x, top - 0.5, field.spawn.z)
	walker.global_position = Vector3(field.spawn.x, top + 0.05, field.spawn.z)
	walker.velocity = Vector3.ZERO
	walker.reset_physics_interpolation()
	await _frames(10)

	bridge.receive_phase_json(JSON.stringify({"phase": "countdown"}))
	check(main.phase == &"countdown", "setPhase sets the phase")
	walker.input_enabled = true
	Input.action_press("move_forward")
	var a := walker.global_position
	await _frames(30)
	var moved := Vector2(a.x, a.z).distance_to(Vector2(walker.global_position.x, walker.global_position.z))
	check(moved < 0.05, "in countdown, held W doesn't move the walker (%.2f m)" % moved)
	bridge.receive_phase_json(JSON.stringify({"phase": "hunting"}))
	a = walker.global_position
	await _frames(30)
	moved = Vector2(a.x, a.z).distance_to(Vector2(walker.global_position.x, walker.global_position.z))
	check(moved > 0.3, "in hunting, held W moves it (%.2f m)" % moved)
	Input.action_release("move_forward")
	walker.input_enabled = false
	walker.set_move(Vector2.ZERO, false, false)

	# The buggy's keyboard goes quiet too.
	var buggy: Buggy = main.buggy
	bridge.receive_phase_json(JSON.stringify({"phase": "countdown"}))
	buggy.driver = walker
	Input.action_press("move_forward")
	await _frames(2)
	check(buggy.throttle_input == 0.0, "in countdown, held W gives the buggy no throttle")
	bridge.receive_phase_json(JSON.stringify({"phase": "hunting"}))
	await _frames(2)
	check(buggy.throttle_input > 0.0, "in hunting, it does")
	Input.action_release("move_forward")
	buggy.driver = null
	buggy.set_control(0, 0, 0)
	slab.queue_free()
	await _frames(2)


func test_compass() -> void:
	var c: Compass = main.compass
	check(c != null and c.mouse_filter == Control.MOUSE_FILTER_IGNORE, "the compass ignores the mouse")
	check(main.prompt.mouse_filter == Control.MOUSE_FILTER_IGNORE, "the prompt ignores the mouse")
	for want: Array in [[0.0, 0.0, "-Z"], [-PI / 2, 90.0, "+X"], [PI / 2, 270.0, "-X"]]:
		main.rig.yaw = want[0]
		await t.process_frame
		await t.process_frame
		var got: float = c.heading_deg
		check(absf(angle_difference(deg_to_rad(got), deg_to_rad(want[1]))) < deg_to_rad(0.6), "the compass reads %d facing %s (%.1f)" % [int(want[1]), want[2], got])
	check(Compass.heading_of(Vector3(0, 0, 1)) == 180.0, "facing +Z is 180")


func test_pos_stream() -> void:
	bridge.receive_phase_json(JSON.stringify({"phase": "hunting"}))
	await _frames(1)
	positions.clear()
	await _frames(120)
	var n := positions.size()
	check(absf(n - 20) <= 1, "emitPos fires about 10 times a second (%d in 2 s)" % n)
	if n > 0:
		var p: Dictionary = positions[-1]
		var w := walker.global_position
		check(p.has_all(["x", "y", "z", "foot"]) and p.foot == true and Vector3(p.x, p.y, p.z).distance_to(w) < 1.0, "a pos carries x, y, z and foot (%s)" % p)
	bridge.receive_phase_json(JSON.stringify({"phase": "finished"}))
	positions.clear()
	await _frames(60)
	check(positions.is_empty(), "no pos once the round is finished")
	bridge.receive_phase_json(JSON.stringify({"phase": "countdown"}))
	await _frames(60)
	check(positions.size() >= 1, "pos goes out in countdown too")
	bridge.receive_phase_json(JSON.stringify({"phase": "hunting"}))


## An iframe reload: reveals (and a found) come in before the session.
## They wait for the world, then land on its ground.
func test_reveal_before_world() -> void:
	main._teardown()
	check(main.world == null, "world torn down")
	var l2: Dictionary = t.layout(2)
	var f2 := TerrainField.from_layout(l2)
	var x := f2.spawn.x + 15.0
	var z := f2.spawn.z
	bridge.receive_reveal_json(JSON.stringify({"id": "early", "x": x, "z": z, "dy": 0.0}))
	bridge.receive_reveal_json(JSON.stringify({"id": "gone", "x": x + 5.0, "z": z, "dy": 0.0}))
	bridge.receive_found_json(JSON.stringify({"id": "gone"}))
	main.start_world(l2)
	var caches: Caches = main.caches
	var crate: Node3D = caches.crate("early") if caches else null
	check(crate != null and absf(crate.global_position.y - main.field.height_at(x, z)) <= 0.05, "a reveal before the world waits, then sits on the new ground")
	check(caches != null and caches.count() == 2 and caches.nearest_claimable(Vector3(x + 5.0, main.field.height_at(x + 5.0, z), z)) == "", "a found before the world applies too")


## "Same map again": the seed repeats, the round doesn't. A new round builds
## from scratch, so round 1's caches and finds are gone; the same round again
## is a resend and does nothing.
func test_same_seed_new_round() -> void:
	var l2: Dictionary = t.layout(2)
	var statuses: Array = []
	var on_status := func(d: Dictionary) -> void: statuses.append(d)
	bridge.status_sent.connect(on_status)
	bridge.receive_session_json(JSON.stringify({"layout": l2, "round": 4}))
	var f: TerrainField = main.field
	var x := f.spawn.x + 15.0
	var z := f.spawn.z
	bridge.receive_reveal_json(JSON.stringify({"id": "c1", "x": x, "z": z, "dy": 0.0}))
	bridge.receive_found_json(JSON.stringify({"id": "c1"}))
	var at := Vector3(x, f.height_at(x, z), z)
	var world: Node = main.world
	var caches: Caches = main.caches
	statuses.clear()
	bridge.receive_session_json(JSON.stringify({"layout": l2, "round": 4}))
	check(main.world == world and main.caches == caches and statuses.is_empty(), "the same seed and round again does nothing")
	check(caches.count() >= 1 and caches.nearest_claimable(at) == "", "round 4: c1 is found")
	main._pinged_reveals["c1"] = true
	bridge.receive_session_json(JSON.stringify({"layout": l2, "round": 5}))
	check(main.world != world and main.caches != caches and main.field.seed == int(l2.seed), "the same seed in a new round rebuilds")
	check(main.caches.count() == 0 and main._pending_reveals.is_empty() and main._pending_found.is_empty(), "the new round has no caches and nothing pending")
	check(main._pinged_reveals.is_empty(), "and its ping memory starts over")
	check(statuses.size() == 1 and statuses[0].get("seed") == int(l2.seed) and statuses[0].get("round") == 5, "world-ready goes again, with the round (%s)" % [statuses])
	bridge.receive_reveal_json(JSON.stringify({"id": "c1", "x": x, "z": z, "dy": 0.0}))
	check(main.caches.count() == 1 and main.caches.nearest_claimable(at) == "c1", "round 5's c1 can be claimed")
	bridge.status_sent.disconnect(on_status)
