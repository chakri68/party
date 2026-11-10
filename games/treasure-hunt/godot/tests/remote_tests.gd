extends RefCounted
## M3's other players: Remotes on its own (capsules, tags, interpolation,
## lifetime), then through main and the bridge seams, and the yaw and v
## our own pos now carries.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)

const ROSTER := [
	{"id": "me", "name": "Asha", "color": "#e69f00", "team": 1.0},
	{"id": "p2", "name": "Ravi", "color": "#56b4e9", "team": 2.0},
	{"id": "p3", "name": "Meena", "color": "#009e73", "team": 3.0},
]


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("remotes")
	await test_upsert()
	await test_roster()
	await test_stale()
	await test_vehicle()
	await test_label()
	await test_interpolation()
	await test_bridge()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _remotes() -> Remotes:
	var r := Remotes.new()
	r.auto_tick = false
	t.root.add_child(r)
	r.set_roster(ROSTER, "me")
	return r


func _snap(x: float, y: float, z: float, yaw := 0.0, v: Variant = null) -> Dictionary:
	return {"x": x, "y": y, "z": z, "yaw": yaw, "foot": v == null, "v": v}


func _done(r: Remotes) -> void:
	r.queue_free()
	await t.process_frame


func test_upsert() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(1, 2, 3), 0.0)
	r.upsert("p2", _snap(1.5, 2, 3), 0.1)
	check(r.count() == 1, "upsert twice → one capsule (%d)" % r.count())
	var cap := r.capsule("p2")
	var mesh := cap.mesh as CapsuleMesh if cap else null
	check(mesh != null and is_equal_approx(mesh.radius, 0.35) and is_equal_approx(mesh.height, 1.8), "a capsule 0.35 m by 1.8 m")
	var mat := cap.material_override as StandardMaterial3D if cap else null
	check(mat != null and mat.albedo_color.is_equal_approx(Color("#56b4e9")), "the capsule is tinted the team colour")
	var body := r.body("p2")
	check(body != null and body.find_children("*", "CollisionObject3D", true, false).is_empty(), "a remote has no collider")
	r.tick(1.0)
	check(body != null and absf(cap.global_position.y - (2.0 + 0.9)) < 0.01, "the capsule's centre is 0.9 m over the streamed feet")
	r.upsert("me", _snap(0, 0, 0), 0.2)
	r.upsert("nobody", _snap(0, 0, 0), 0.2)
	check(r.count() == 1, "me and players not in the roster get no capsule")
	await _done(r)


func test_roster() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(0, 0, 0), 0.0)
	r.upsert("p3", _snap(5, 0, 0), 0.0)
	var before := r.body("p2")
	r.set_roster(ROSTER, "me")
	check(r.body("p2") == before, "the same roster again keeps the capsule")
	var recoloured := ROSTER.duplicate(true)
	recoloured[1].color = "#d55e00"
	recoloured[1].name = "Ravi K"
	r.set_roster(recoloured, "me")
	var mat := r.capsule("p2").material_override as StandardMaterial3D
	check(r.body("p2") == before and mat.albedo_color.is_equal_approx(Color("#d55e00")) and r.label("p2").text == "Ravi K", "a new colour or name changes the capsule in place")
	r.set_roster([ROSTER[0], ROSTER[1]], "me")
	check(r.count() == 1 and r.body("p3") == null, "a roster that drops a player removes them at once")
	await _done(r)


func test_stale() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(0, 0, 0), 10.0)
	r.tick(14.9)
	check(r.count() == 1, "4.9 s without a snapshot: still there")
	r.tick(15.1)
	check(r.count() == 0, "stale 5 s → removed")
	await _done(r)


func test_vehicle() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(0, 0, 0), 0.0)
	r.tick(0.0)
	check(r.body("p2").visible, "on foot, the capsule shows")
	# In a buggy they're still drawn: the streamed pos is already the seat.
	r.upsert("p2", _snap(3, 1, 4, 0.0, "b1"), 0.1)
	r.tick(0.2)
	check(r.body("p2").visible and r.capsule("p2").visible and r.label("p2").visible, "v set → capsule and tag still show")
	check(r.body("p2").position.is_equal_approx(Vector3(3, 1, 4)), "drawn at the streamed seat")
	r.upsert("p2", _snap(0, 0, 0), 0.3)
	r.tick(0.3)
	check(r.body("p2").visible, "out of the buggy, it still shows")
	await _done(r)


func test_label() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(0, 0, 0), 0.0)
	r.tick(0.0)
	var l := r.label("p2")
	check(l != null and is_equal_approx(l.visibility_range_end, 50.0) and Remotes.NAME_RANGE == 50.0, "name label range is 50")
	check(l != null and l.billboard == BaseMaterial3D.BILLBOARD_ENABLED and l.text == "Ravi", "the tag is a billboard with the seat name")
	var cap := r.capsule("p2")
	check(l != null and absf(l.global_position.y - (cap.global_position.y + 1.2)) < 0.01, "the tag sits 1.2 m over the capsule's centre")
	await _done(r)


func test_interpolation() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(0, 0, 0, 3.0), 0.0)
	r.tick(0.5)
	r.upsert("p2", _snap(10, 0, 0, -3.0), 1.0)
	r.tick(1.05)
	var b := r.body("p2")
	check(absf(b.position.x - 5.0) < 0.01, "halfway through 100 ms, halfway there (%.2f)" % b.position.x)
	# 3.0 to -3.0 the short way round is through PI, not through 0.
	check(absf(angle_difference(b.rotation.y, PI)) < 0.05, "yaw is lerped by angle, the short way (%.2f)" % b.rotation.y)
	r.tick(1.2)
	check(absf(b.position.x - 10.0) < 0.01 and absf(angle_difference(b.rotation.y, -3.0)) < 0.01, "after 100 ms it's at the latest snapshot")
	await _done(r)


func test_bridge() -> void:
	var main: Node3D = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	var bridge: WebBridge = main.bridge
	var remotes: Remotes = main.remotes
	if main.field == null or remotes == null:
		check(false, "main builds layout_1 and has remotes")
		main.queue_free()
		return
	main.walker.input_enabled = false
	bridge.receive_roster_json(JSON.stringify({"me": "me", "players": ROSTER}))
	bridge.receive_remote_json(JSON.stringify({"id": "p2", "x": 4.0, "y": 1.0, "z": 2.0, "yaw": 0.5, "foot": true, "v": null}))
	bridge.receive_remote_json(JSON.stringify({"id": "p3", "x": "4", "y": 1.0, "z": 2.0, "yaw": 0.5, "foot": true, "v": null}))
	check(remotes.count() == 1 and remotes.body("p2") != null, "roster and remotePos through the bridge seams make a capsule")
	bridge.receive_roster_json(JSON.stringify({"me": "me", "players": [ROSTER[0]]}))
	check(remotes.count() == 0, "a roster through the bridge drops a player")

	var positions: Array[Dictionary] = []
	bridge.pos_sent.connect(func(d: Dictionary) -> void: positions.append(d))
	main.walker.rotation.y = 1.25
	for i in 15:
		await t.physics_frame
	var p: Dictionary = positions[-1] if positions.size() > 0 else {}
	check(p.has_all(["yaw", "v"]) and p.v == null and p.foot == true and absf(float(p.yaw) - main.walker.global_rotation.y) < 0.01, "on foot, a pos carries the walker's yaw and v null (%s)" % p)
	var door: Vector3 = main.buggy.to_global(PlayerAvatar.DOOR)
	main.walker.global_position = Vector3(door.x, main.field.height_at(door.x, door.z) + 0.05, door.z)
	main.walker.reset_physics_interpolation()
	for i in 5:
		await t.physics_frame
	check(main.avatar.interact() and main.avatar.mode == &"driving", "got in the buggy")
	positions.clear()
	for i in 15:
		await t.physics_frame
	p = positions[-1] if positions.size() > 0 else {}
	check(p.get("foot") == false and p.has("v") and p.v == null and absf(float(p.get("yaw", 99.0)) - main.buggy.global_rotation.y) < 0.01, "driving, foot is false, v is null (no fleet yet) and yaw is the buggy's (%s)" % p)
	main.queue_free()
	await t.process_frame
