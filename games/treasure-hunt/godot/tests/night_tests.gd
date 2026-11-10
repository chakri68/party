extends RefCounted
## M4a night tools: headlights, set-piece lamps, the torch on F, and the
## glint on a cache's strip. Run from run_tests.gd.

var t ## the runner


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("night")
	await test_main()
	test_glint()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _veh(id: String, x: float, driver: Variant) -> Dictionary:
	return {"id": id, "x": x, "y": null, "z": 0.0, "yaw": 0.0, "driver": driver, "passenger": null}


func _heads_on(b: Buggy) -> bool:
	return b.get_node("HeadL").visible and b.get_node("HeadR").visible


func test_main() -> void:
	var main: Node3D = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	await t.process_frame
	var fleet: Fleet = main.fleet
	fleet.apply([_veh("a", 0, "other"), _veh("b", 10, null)], "me")
	var a := fleet.get_buggy("a")
	var b := fleet.get_buggy("b")
	var hl := a.get_node("HeadL") as SpotLight3D
	check(is_equal_approx(hl.spot_range, 60.0) and is_equal_approx(hl.spot_angle, 18.0) and is_equal_approx(hl.light_energy, 4.0), "headlights: range 60, angle 18, energy 4")
	main._on_dark(0.4)
	check(_heads_on(a) and not b.get_node("HeadL").visible, "dark 0.4: the driven buggy's lights are on, the parked one's off")
	main._on_dark(0.2)
	check(not _heads_on(a) and not _heads_on(b), "dark 0.2: all off")
	main._on_dark(0.4)
	fleet.apply([_veh("a", 0, null), _veh("b", 10, null)], "me")
	check(not _heads_on(a), "the driver leaves: lights go off")
	fleet.apply([_veh("a", 0, "me"), _veh("b", 10, null)], "me")
	check(not _heads_on(a) and a.mode == &"local", "listed as mine but nobody seated yet: off")
	a.driver = main.walker
	fleet.set_dark(0.4)
	check(_heads_on(a) and a.mode == &"local", "I drive it: lights on")
	a.driver = null
	fleet.set_dark(0.4)
	check(not _heads_on(a), "I get out: lights off before any new list")
	a.driver = main.walker
	# Edges of LAMP_ON.
	fleet.set_dark(0.30)
	check(_heads_on(a), "headlights: dark 0.30 is on")
	fleet.set_dark(0.29)
	check(not _heads_on(a), "headlights: dark 0.29 is off")
	main._on_dark(0.30)
	var edge: Array = main.pieces.find_children("Lamp*", "OmniLight3D", true, false)
	check(edge.all(func(l: OmniLight3D) -> bool: return l.visible), "lamps: dark 0.30 is on")
	main._on_dark(0.29)
	check(edge.all(func(l: OmniLight3D) -> bool: return not l.visible), "lamps: dark 0.29 is off")
	main._on_dark(0.4)

	# Pieces and lamps.
	var lamps: Array = main.pieces.find_children("Lamp*", "OmniLight3D", true, false)
	check(lamps.size() > 0, "layout 1 has lamp lights (%d)" % lamps.size())
	check(lamps.all(func(l: OmniLight3D) -> bool: return l.visible), "world built in the dark (0.4): every lamp visible")
	main.pieces.set_lamps(false)
	check(lamps.all(func(l: OmniLight3D) -> bool: return not l.visible), "set_lamps(false) hides every lamp")
	main.pieces.set_lamps(true)
	check(lamps.all(func(l: OmniLight3D) -> bool: return l.visible), "set_lamps(true) shows every lamp")
	main._on_dark(0.1)
	check(lamps.all(func(l: OmniLight3D) -> bool: return not l.visible), "dark 0.1 puts the lamps out")

	# A world built after the dark was already known picks it up.
	main._on_dark(0.6)
	var lay: Dictionary = t.layout(1).duplicate(true)
	lay.seed = int(lay.seed) + 1
	main.start_world(lay)
	var again: Array = main.pieces.find_children("Lamp*", "OmniLight3D", true, false)
	check(again.size() > 0 and again.all(func(l: OmniLight3D) -> bool: return l.visible), "a rebuilt world is lit at once when it is already dark")

	# The torch.
	var torch: SpotLight3D = main.rig.torch
	check(not main.torch_on and not torch.visible, "the torch starts off")
	check(is_equal_approx(torch.spot_range, 18.0) and is_equal_approx(torch.spot_angle, 35.0) and is_equal_approx(torch.light_energy, 2.0), "torch: range 18, angle 35, energy 2")
	var ev := InputEventAction.new()
	ev.action = &"torch"
	ev.pressed = true
	main._unhandled_input(ev)
	check(main.torch_on and torch.visible, "F: the torch comes on")
	main._unhandled_input(ev)
	check(not main.torch_on and not torch.visible, "F again: it goes off")
	check(InputMap.has_action("torch"), "an InputMap action torch exists")
	# The glint is measured from the player, not the camera.
	main.set_phase(&"hunting")
	main.caches.reveal("g1", 0.0, 0.0, 0.0)
	var cr: Cache = main.caches.crate("g1")
	main.walker.global_position = cr.global_position + Vector3(7, 0, 0)
	main.rig.camera.global_position = cr.global_position + Vector3(7, 0, 0) + Vector3(0, 0, 12)
	main.torch_on = true
	main.dark = 0.6
	main.glint_tick()
	check(main.rig.camera.global_position.distance_to(cr.global_position) > 8.0 and is_equal_approx(cr.strip_mat.emission_energy_multiplier, 2.0), "glint: 7 m from me but over 8 m from the camera: it glints")
	main.queue_free()
	await t.process_frame


func test_glint() -> void:
	var cs := Caches.new()
	cs.field = TerrainField.from_layout(t.layout(1))
	t.root.add_child(cs)
	cs.reveal("c1", 0.0, 0.0, 0.0)
	var c := cs.crate("c1")
	var at := c.global_position
	var e := func() -> float: return c.strip_mat.emission_energy_multiplier
	cs.glint(at + Vector3(5, 0, 0), true, 0.6)
	check(is_equal_approx(e.call(), 2.0), "glint: torch on, 5 m, dark 0.6: energy 2")
	cs.glint(at + Vector3(7.9, 0, 0), true, 0.6)
	check(is_equal_approx(e.call(), 2.0), "glint: 7.9 m glints")
	cs.glint(at + Vector3(8.1, 0, 0), true, 0.6)
	check(e.call() == 0.0, "glint: 8.1 m doesn't")
	cs.glint(at + Vector3(5, 0, 0), true, 0.30)
	check(is_equal_approx(e.call(), 2.0), "glint: dark 0.30 is on")
	cs.glint(at + Vector3(5, 0, 0), true, 0.29)
	check(e.call() == 0.0, "glint: dark 0.29 is off")
	cs.glint(at + Vector3(9, 0, 0), true, 0.6)
	check(e.call() == 0.0, "glint: 9 m: 0")
	cs.glint(at + Vector3(5, 0, 0), false, 0.6)
	check(e.call() == 0.0, "glint: torch off: 0")
	cs.glint(at + Vector3(5, 0, 0), true, 0.1)
	check(e.call() == 0.0, "glint: dark 0.1: 0")
	cs.reveal("c2", 3.0, 0.0, 0.0)
	cs.glint(at, true, 0.6)
	check(cs.crate("c1").strip_mat != cs.crate("c2").strip_mat, "each cache has its own strip material")
	cs.glint(at + Vector3(5, 0, 0), true, 0.6)
	c.found = true
	cs.glint(at + Vector3(5, 0, 0), true, 0.6)
	check(e.call() == 0.0, "glint: a found cache stays dark")
	c.found = false
	c.visible = false
	cs.glint(at + Vector3(5, 0, 0), true, 0.6)
	check(e.call() == 0.0, "glint: a hidden cache stays dark")
	cs.queue_free()
