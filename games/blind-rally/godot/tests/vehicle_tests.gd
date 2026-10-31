extends RefCounted
## Rally's car classes (scripts/vehicles.gd). Run from run_tests.gd, with its
## helpers and its pass/fail count. Leaves the car on hatch, so later tests
## see today's car.

var t ## the runner (run_tests.gd)
var car: CarController


func _init(runner) -> void:
	t = runner


func run() -> void:
	car = t.car
	print("vehicles")
	test_ids_match_ts()
	test_speed_cap()
	test_hatch_is_today()
	test_switch_does_not_stack()
	test_unknown_falls_back()
	await test_tractor_offroad()
	test_hatch_dressed_as_today()
	await test_models()
	test_preset_keeps_livery()
	car.apply_preset("hatch")
	t._probe_session()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func test_ids_match_ts() -> void:
	var path := ProjectSettings.globalize_path("res://") + "/../shared/vehicles.ts"
	var f := FileAccess.open(path, FileAccess.READ)
	check(f != null, "shared/vehicles.ts is readable")
	if f == null:
		return
	var re := RegEx.create_from_string("VEHICLE_IDS\\s*=\\s*\\[([^\\]]*)\\]")
	var m := re.search(f.get_as_text())
	check(m != null, "VEHICLE_IDS line found")
	if m == null:
		return
	var ts_ids := []
	for part in m.get_string(1).split(","):
		var id := part.strip_edges().trim_prefix("\"").trim_suffix("\"")
		if id != "":
			ts_ids.append(id)
	check(ts_ids == Vehicles.IDS, "Vehicles.IDS matches the TS ids")
	check(Vehicles.PRESETS.keys() == Vehicles.IDS, "a preset for every id, in order")


func test_speed_cap() -> void:
	for id in Vehicles.IDS:
		car.apply_preset(id)
		var best := 0.0
		for s in CarController.SURFACES:
			best = maxf(best, float(car._surface_row(s)["top"]))
		var worst := car.max_speed * best * 1.15 # slope margin
		check(worst < 45.0, "%s stays under MAX_SPEED (%.1f m/s)" % [id, worst])
	car.apply_preset("hatch")


func test_hatch_is_today() -> void:
	car.apply_preset("truck")
	car.apply_preset("hatch")
	var same := true
	for p in car.get_property_list():
		if p.usage & PROPERTY_USAGE_SCRIPT_VARIABLE and p.usage & PROPERTY_USAGE_EDITOR:
			if car.get(p.name) != car._defaults[p.name]:
				same = false
				print("    differs: ", p.name)
	check(same, "hatch leaves every export at the scene's value")
	check(car.max_speed == 32.0 and car.engine_accel == 13.0 and car.grip == 6.0, "hatch is today's numbers")
	check(car._surface_row("offroad") == CarController.SURFACES["offroad"], "hatch leaves SURFACES alone")


func test_switch_does_not_stack() -> void:
	car.apply_preset("truck")
	check(car.max_speed == 38.0, "truck tops at 38")
	car.apply_preset("hatch")
	check(car.max_speed == 32.0, "back to hatch restores max_speed")
	car.apply_preset("4x4")
	car.apply_preset("tractor")
	check(car._surface_row("snow")["grip"] == CarController.SURFACES["snow"]["grip"], "tractor does not keep the 4x4's snow grip")
	car.apply_preset("hatch")


func test_unknown_falls_back() -> void:
	car.apply_preset("tractor")
	car.apply_preset("bus")
	check(car.vehicle == "hatch", "unknown id drives the hatch")
	check(car.max_speed == 32.0, "and has the hatch's numbers")
	check(Vehicles.valid("bus") == "hatch" and Vehicles.valid("rwd") == "rwd", "valid() keeps good ids, drops bad")


func test_tractor_offroad() -> void:
	var xf: Variant = t._clear_offroad_xf()
	check(xf != null, "found a clear grass strip")
	if xf == null:
		return
	var speeds := {}
	for id in ["hatch", "tractor"]:
		car.apply_preset(id)
		await t.place(xf)
		await t.drive(4.0, 0.0, 1.0)
		speeds[id] = car.forward_speed
	print("    4 s full throttle on grass: hatch %.1f m/s, tractor %.1f m/s" % [speeds["hatch"], speeds["tractor"]])
	check(speeds["tractor"] > speeds["hatch"], "tractor is faster than the hatch on grass")


## The hatch's model is car.tscn's layout, so dressing it changes nothing.
func test_hatch_dressed_as_today() -> void:
	car.apply_preset("truck")
	car.apply_preset("hatch")
	var v := car.get_node("Visual")
	var ok := true
	for w in [["WheelFL", Vector3(0.587, 0.414, 1.118)], ["WheelFR", Vector3(-0.587, 0.414, 1.118)],
			["WheelRL", Vector3(0.587, 0.414, -1.118)], ["WheelRR", Vector3(-0.587, 0.414, -1.118)]]:
		ok = ok and (v.get_node(w[0]) as Node3D).position.is_equal_approx(w[1])
	check(ok, "hatch wheels where car.tscn puts them")
	var body := v.get_node("Body") as MeshInstance3D
	check(body.get_meta("baked_mesh") == load("res://assets/meshes/car_body.res"), "hatch body is car_body.res")
	check((body.get_node("Roundel") as Node3D).position.is_equal_approx(Vector3(0, 1.53, -0.15))
		and (body.get_node("LightPod") as Node3D).position.is_equal_approx(Vector3(0, 1.56, 0.62)), "plate and pod in place")
	check((body.get_node("StripeL") as Node3D).visible and (body.get_node("StripeR") as Node3D).visible, "hatch keeps its stripes")
	var shape := car.get_node("Shape") as CollisionShape3D
	check((shape.shape as BoxShape3D).size == Vector3(1.8, 1.0, 3.8) and is_equal_approx(shape.position.y, 0.55), "hatch box 1.8 x 1.0 x 3.8")
	check(t.main.cam.bonnet_offset == Vector3(0.0, 1.3, -1.05), "hatch bonnet camera unchanged")


## Every class: its own body painted in the team colour, its own box, and it
## drives and recovers with that box.
func test_models() -> void:
	var team := Color("#56b4e9")
	var spawn: Transform3D = t.track.get_spawn().global_transform
	for id in Vehicles.IDS:
		var m: Dictionary = Vehicles.get_preset(id)["model"]
		car.apply_preset(id)
		CarPaint.apply(car, team, 2, "square")
		var body := car.get_node("Visual/Body") as MeshInstance3D
		check(body.get_meta("baked_mesh") == load(m["body"]), "%s wears %s" % [id, String(m["body"]).get_file()])
		var cols: PackedColorArray = body.mesh.surface_get_arrays(0)[Mesh.ARRAY_COLOR]
		var painted := 0
		for c in cols:
			if c.s > CarPaint.MIN_SAT * 0.5 and absf(c.h - team.h) < CarPaint.HUE_TOLERANCE:
				painted += 1
		check(painted > 100, "%s: %d vertices in the team colour" % [id, painted])
		var shape := car.get_node("Shape") as CollisionShape3D
		check((shape.shape as BoxShape3D).size == m["box"] and is_equal_approx(shape.position.y, m["box_y"]), "%s box is %s" % [id, m["box"]])
		var grounded := true
		for w in ["WheelFL", "WheelFR", "WheelRL", "WheelRR"]:
			var wn := car.get_node("Visual/" + w) as MeshInstance3D
			grounded = grounded and absf(wn.position.y + wn.mesh.get_aabb().position.y) < 0.02
		check(grounded, "%s wheels sit on the ground" % id)
		check((car.get_node("Fx") as CarFx).wheels == m["wheels"] and t.main.cam.bonnet_offset == m["bonnet"], "%s dust and bonnet camera follow the model" % id)
		var plate := (body.get_node("Roundel") as Node3D).position
		check(plate.y > body.mesh.get_aabb().end.y - 0.05, "%s plate on the roof" % id)
		await t.place(spawn)
		var y0 := car.global_position.y
		await t.drive(3.0, 0.0, 1.0)
		check(absf(car.global_position.y - y0) < 1.0, "%s drives 3 s and stays on the ground (dy %.2f)" % [id, car.global_position.y - y0])
		await t.place(spawn)
		var p0 := car.global_position
		await t.drive(2.0, 0.0, 1.0)
		check(car.global_position.distance_to(p0) > 10.0, "%s recovers to the spawn and drives off (%.1f m)" % [id, car.global_position.distance_to(p0)])
		var g := CarPaint.ghost_mesh(id, team, "square").get_aabb()
		var box: Vector3 = m["box"]
		check(absf(g.size.x - box.x) < box.x * 0.1 and absf(g.size.z - box.z) < box.z * 0.1,
			"%s ghost is the car's size (%.2f x %.2f)" % [id, g.size.x, g.size.z])
	await t.place(spawn)


## A class change after the livery is on keeps the team colour.
func test_preset_keeps_livery() -> void:
	CarPaint.apply(car, Color("#cc79a7"), 4, "diamond")
	car.apply_preset("truck")
	var body := car.get_node("Visual/Body") as MeshInstance3D
	check(body.mesh != body.get_meta("baked_mesh"), "truck repainted after the swap")
	check((body.get_node("Roundel") as MeshInstance3D).mesh == CarPaint.plate_mesh("diamond"), "and keeps its diamond plate")
