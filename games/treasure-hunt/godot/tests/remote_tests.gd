extends RefCounted
## M3's other players: Remotes on its own (models, tags, interpolation,
## lifetime), then through main and the bridge seams, and the yaw and v
## our own pos now carries.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)

const ROSTER := [
	{"id": "me", "name": "Asha", "color": "#e69f00", "team": 1.0},
	{"id": "p2", "name": "Ravi", "color": "#56b4e9", "team": 2.0, "character": "male-b"},
	{"id": "p3", "name": "Meena", "color": "#009e73", "team": 3.0, "character": "nobody-knows"},
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
	await test_models()
	await test_animation()
	await test_seats()
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
	check(r.count() == 1, "upsert twice → one model (%d)" % r.count())
	var m := r.model("p2")
	check(m != null and m.id == "male-b", "a remote shows the roster's character")
	var mat := m.find_child("body-mesh", true, false).get_surface_override_material(0) as ShaderMaterial if m else null
	check(mat != null and (mat.get_shader_parameter("team_color") as Color).is_equal_approx(Color("#56b4e9")), "the shirt is the team colour")
	var body := r.body("p2")
	check(body != null and body.find_children("*", "CollisionObject3D", true, false).is_empty(), "a remote has no collider")
	r.tick(1.0)
	check(body != null and absf(m.global_position.y - 2.0) < 0.01, "the model stands on the streamed feet")
	r.upsert("me", _snap(0, 0, 0), 0.2)
	r.upsert("nobody", _snap(0, 0, 0), 0.2)
	check(r.count() == 1, "me and players not in the roster get no model")
	await _done(r)


func test_roster() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(0, 0, 0), 0.0)
	r.upsert("p3", _snap(5, 0, 0), 0.0)
	var before := r.body("p2")
	r.set_roster(ROSTER, "me")
	check(r.body("p2") == before, "the same roster again keeps the model")
	var recoloured := ROSTER.duplicate(true)
	recoloured[1].color = "#d55e00"
	recoloured[1].name = "Ravi K"
	r.set_roster(recoloured, "me")
	check(r.body("p2") == before and r.label("p2").text == "Ravi K", "a new name changes the tag in place")
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
	check(r.body("p2").visible, "on foot, the model shows")
	# In a buggy they're still drawn: the streamed pos is already the seat.
	r.upsert("p2", _snap(3, 1, 4, 0.0, "b1"), 0.1)
	r.tick(0.2)
	check(r.body("p2").visible and r.model("p2").visible and r.label("p2").visible, "v set → model and tag still show")
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
	check(l != null and absf(l.position.y - (CharacterModel.HEIGHT + 0.4)) < 0.001, "the tag sits 0.4 m over the model's head")
	await _done(r)


func test_models() -> void:
	var r := _remotes()
	r.upsert("p2", _snap(0, 0, 0), 0.0)
	r.upsert("p3", _snap(5, 0, 0), 0.0)
	var m := r.model("p2")
	check(r.model("p3").id == CharacterModel.IDS[0], "an unknown character falls back, no crash")
	var teamed := ROSTER.duplicate(true)
	teamed[1].color = "#d55e00"
	r.set_roster(teamed, "me")
	var mat := m.find_child("body-mesh", true, false).get_surface_override_material(0) as ShaderMaterial
	check(r.model("p2") == m and m.id == "male-b" and (mat.get_shader_parameter("team_color") as Color).is_equal_approx(Color("#d55e00")), "a team colour change keeps the model and moves the tint")
	var swapped := teamed.duplicate(true)
	swapped[1].character = "female-c"
	r.set_roster(swapped, "me")
	check(r.model("p2") == m and m.id == "female-c" and r.body("p2").find_children("*", "CharacterModel", true, false).size() == 1, "a character change leaves one model with the new id")
	var mat2 := m.find_child("body-mesh", true, false).get_surface_override_material(0) as ShaderMaterial
	check((mat2.get_shader_parameter("team_color") as Color).is_equal_approx(Color("#d55e00")), "and keeps the colour")
	await _done(r)


func test_animation() -> void:
	var r := _remotes()
	var m: CharacterModel
	r.upsert("p2", _snap(0, 0, 0), 0.0)
	r.upsert("p2", _snap(0.17, 0, 0), 0.1)
	r.tick(0.1)
	m = r.model("p2")
	check(m.state() == &"walk", "1.7 m/s between snapshots: walk (%s)" % m.state())
	r.upsert("p2", _snap(0.67, 0, 0), 0.2)
	r.tick(0.2)
	check(m.state() == &"sprint", "5 m/s: sprint (%s)" % m.state())
	r.upsert("p2", _snap(0.67, 0, 0), 0.3)
	r.tick(0.3)
	check(m.state() == &"idle", "still between snapshots: idle (%s)" % m.state())
	r.upsert("p2", _snap(0.97, 0, 0), 0.4)
	r.tick(0.4)
	r.tick(1.0)
	check(m.state() == &"idle", "no snapshot for a while: idle")
	# Beyond 150 m the animation stops; back within it, it runs.
	var viewer := [Vector3(0, 0, 0)]
	r.viewer = func() -> Vector3: return viewer[0]
	var ap: AnimationPlayer = m.find_child("AnimationPlayer", true, false)
	r.tick(1.0)
	check(ap.active, "within 150 m: animating")
	viewer[0] = Vector3(200, 0, 0)
	r.tick(1.0)
	check(not ap.active, "beyond 150 m: frozen")
	viewer[0] = Vector3(100, 0, 0)
	r.tick(1.0)
	check(ap.active, "back within 150 m: animating again")
	await _done(r)


func _veh(id: String, driver: Variant, passenger: Variant, x := 0.0, z := 0.0) -> Dictionary:
	return {"id": id, "x": x, "y": 0.0, "z": z, "yaw": 0.0, "driver": driver, "passenger": passenger}


func test_seats() -> void:
	var r := _remotes()
	var fleet := Fleet.new()
	t.root.add_child(fleet)
	r.fleet = fleet
	var list := [_veh("t0", "p2", "p3", 10, 20)]
	fleet.apply(list, "me")
	var b := fleet.get_buggy("t0")
	b.global_transform = Transform3D(Basis(Vector3.UP, 0.7), Vector3(10, 5, 20))
	r.set_seats(list)
	r.upsert("p2", _snap(1, 0, 1, 0, "t0"), 0.0)
	r.upsert("p3", _snap(2, 0, 2, 0, "t0"), 0.0)
	r.tick(0.05)
	var d := r.model("p2")
	var p := r.model("p3")
	check(d.global_position.distance_to(b.to_global(PlayerAvatar.SEAT)) < 0.05, "the driver sits at the driver's seat (%s)" % d.global_position)
	check(p.global_position.distance_to(b.to_global(PlayerAvatar.RIDE_SEAT)) < 0.05, "the passenger sits at the other seat")
	check(d.global_position.distance_to(p.global_position) >= 0.8, "two in one buggy are at least 0.8 m apart")
	check(d.state() == &"drive" and p.state() == &"sit", "they drive and sit (%s, %s)" % [d.state(), p.state()])
	check((-d.global_basis.z).distance_to(-b.global_basis.z) < 0.01, "a seated model faces the buggy's forward")
	b.global_transform = Transform3D(Basis(Vector3.UP, -1.2), Vector3(30, 6, -4))
	r.tick(0.06)
	check(d.global_position.distance_to(b.to_global(PlayerAvatar.SEAT)) < 0.05 and p.global_position.distance_to(b.to_global(PlayerAvatar.RIDE_SEAT)) < 0.05, "both follow the buggy when it moves")
	# Far away: the animation freezes, the seat still follows.
	r.viewer = func() -> Vector3: return Vector3(1000, 0, 0)
	r.tick(0.07)
	var ap: AnimationPlayer = d.find_child("AnimationPlayer", true, false)
	check(not ap.active, "a seated remote beyond 150 m is frozen")
	r.viewer = Callable()
	# Getting out: v null, back on the relayed pos, motion states.
	r.upsert("p2", _snap(1, 0, 1, 0.3, null), 0.1)
	r.tick(0.2)
	check(r.body("p2").global_position.distance_to(Vector3(1, 0, 1)) < 0.01 and d.state() == &"idle", "v null: back at the relayed pos, idle (%s)" % d.state())
	check(absf(r.body("p2").rotation.x) < 0.001 and absf(r.body("p2").rotation.z) < 0.001, "and upright")
	# v set but not in a fleet vehicle (or not in the list's seats): relayed pos, idle.
	# The snapshot moves 1.5 m between upserts (5 m/s over 0.3 s): without the
	# fix the buggy's speed would play sprint here.
	r.upsert("p3", _snap(3.5, 0, 2, 0, "ghost"), 0.3)
	r.tick(0.4)
	check(r.body("p3").global_position.distance_to(Vector3(3.5, 0, 2)) < 0.01 and p.state() == &"idle", "a vehicle not in the fleet: relayed pos, idle (%s)" % p.state())
	r.upsert("p3", _snap(5.0, 0, 2, 0, "t0"), 0.5)
	r.set_seats([_veh("t0", "p2", null)])
	r.tick(0.6)
	check(r.body("p3").global_position.distance_to(Vector3(5, 0, 2)) < 0.01 and p.state() == &"idle", "v set but not in the vehicle's seats: relayed pos, idle (%s)" % p.state())
	r.set_seats([{"id": 5}, "junk", {"id": "t0", "driver": 3, "passenger": null}])
	r.tick(0.7)
	check(r.count() == 2, "a bad seats list is skipped without errors")
	fleet.queue_free()
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
	check(remotes.count() == 1 and remotes.body("p2") != null, "roster and remotePos through the bridge seams make a model")
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
