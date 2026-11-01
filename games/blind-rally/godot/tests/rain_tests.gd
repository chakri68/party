extends RefCounted
## Rain and wet roads: SkyClock's rain_at / wetness_at match the shared cases,
## wet_grip is the constraints table, a reload mid-storm grips right in the
## same frame, and a wet road lets the tail out. Run from run_tests.gd.

var t ## the runner (run_tests.gd)
var main: Node3D
var car: CarController


func _init(runner) -> void:
	t = runner


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func run() -> void:
	main = t.main
	car = t.car
	print("rain")
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/sky_cases.json")).cases
	test_cases(cases)
	test_malformed()
	test_wet_grip()
	test_dry_is_today()
	test_reload_mid_storm(cases)
	test_rain_stops(cases)
	await test_grip_effect()


func _plan_where(cases: Array, from: float, to: float) -> Dictionary:
	for c in cases:
		if c.plan.has("rain") and c.plan.rain.from == from and c.plan.rain.to == to and c.plan.rain.overMs > 0:
			return c.plan
	return {}


func test_cases(cases: Array) -> void:
	var s := SkyClock.new()
	var n := 0
	var bad := 0
	for c in cases:
		if not c.has("rain"):
			continue
		n += 1
		s.set_plan(c.plan)
		if absf(s.rain_at(float(c.ms)) - float(c.rain)) > 1e-4 or absf(s.wetness_at(float(c.ms)) - float(c.wet)) > 1e-4:
			bad += 1
	check(n > 0 and bad == 0, "rain_at and wetness_at match %d shared cases (%d off)" % [n, bad])
	s.free()


func test_malformed() -> void:
	var s := SkyClock.new()
	s.set_plan({"light": {"from": "day", "to": "day", "atMs": 0, "overMs": 0}})
	check(s.rain_at(5000.0) == 0.0 and s.wetness_at(5000.0) == 0.0, "no plan.rain means dry")
	s.set_plan({"rain": {"from": "x", "to": 1}})
	check(s.rain_at(5000.0) == 0.0 and s.wetness_at(5000.0) == 0.0, "a malformed plan.rain means dry")
	s.free()


func _near(a: Dictionary, grip: float, loose: float) -> bool:
	return absf(a.grip - grip) < 1e-6 and absf(a.loose - loose) < 1e-6


func test_wet_grip() -> void:
	var w := CarController.wet_grip
	check(_near(w.call("road", 1.0, false), 0.80, 1.15), "road at wet 1: grip 0.80, loose 1.15")
	check(_near(w.call("road", 0.5, false), 0.90, 1.075), "road at wet 0.5: 0.90, 1.075")
	check(_near(w.call("ice", 1.0, false), 1.0, 1.0), "ice ignores the wet")
	check(_near(w.call("road", 1.0, true), 0.90, 1.05), "snowy: road takes the snow row")
	check(_near(w.call("ice", 1.0, true), 1.0, 1.0), "snowy ice stays 1")
	check(_near(w.call("tarmac", 1.0, false), 0.95, 1.10), "tarmac at wet 1: 0.95, 1.10")
	var dry := true
	for surf in CarController.SURFACES:
		dry = dry and w.call(surf, 0.0, false) == {"grip": 1.0, "loose": 1.0} and w.call(surf, 0.0, true) == {"grip": 1.0, "loose": 1.0}
	check(dry, "every surface at wet 0 is exactly {1, 1}")


func test_dry_is_today() -> void:
	var same := true
	for surf in CarController.SURFACES:
		var row := car._surface_row(surf)
		var wg := CarController.wet_grip(surf, 0.0, false)
		same = same and row.grip * wg.grip == row.grip and row.loose * wg.loose == row.loose
	check(same, "Dry is today: surface rows times wet_grip at 0 are the same rows")
	check(car.wet == 0.0, "the car starts dry")


func test_reload_mid_storm(cases: Array) -> void:
	var plan := _plan_where(cases, 0.0, 1.0)
	var sky: SkyClock = main.sky
	sky.set_plan(plan)
	sky.set_clock(70000.0, true)
	check(absf(car.wet - 0.6) < 0.01, "reload mid-storm: car.wet is %.3f in the same frame (0.6)" % car.wet)
	sky.set_clock(0.0, false)
	check(car.wet == 0.0, "back at the start of the storm: dry")


func test_rain_stops(cases: Array) -> void:
	var plan := _plan_where(cases, 1.0, 0.0)
	var sky: SkyClock = main.sky
	sky.set_plan(plan)
	sky.set_clock(60000.0, false)
	check(absf(car.wet - 0.667) < 0.01 and sky.rain() == 0.0, "rain stopped, road still wet: wet %.3f, rain %.2f" % [car.wet, sky.rain()])
	sky.set_plan({})
	sky.set_clock(0.0, false)
	check(car.wet == 0.0, "an empty plan dries the car")


func test_grip_effect() -> void:
	var lat := {}
	for w in [0.0, 1.0]:
		await t.place(main.track.get_spawn().global_transform)
		car.wet = w
		await t.drive(2.0, 0.6, 1.0)
		lat[w] = absf(car.lateral_speed)
		print("    wet %.0f: lateral %.2f m/s, surface %s" % [w, lat[w], car.surface])
	car.wet = 0.0
	car.neutralize()
	check(lat[1.0] > lat[0.0], "wet road: more lateral slip after 2 s (%.2f vs %.2f)" % [lat[1.0], lat[0.0]])
