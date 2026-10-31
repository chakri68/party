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
