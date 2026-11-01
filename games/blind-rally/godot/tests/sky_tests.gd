extends RefCounted
## The sky clock (SkyClock): the evaluator matches the TS lightAt (shared
## cases in sky_cases.json), the clock only moves when the host says it's
## running, and a reload mid-sunset lands on the right light with no ramp.

var t ## the runner (run_tests.gd)
var main: Node3D


func _init(runner) -> void:
	t = runner


func run() -> void:
	main = t.main
	test_cases()
	await test_clock()
	test_reload_mid_sunset()
	await test_main_wiring()
	test_static_plans()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _fresh() -> SkyClock:
	var s := SkyClock.new()
	main.add_child(s)
	return s


func test_cases() -> void:
	print("sky: shared cases")
	var raw := FileAccess.get_file_as_string("res://tests/sky_cases.json")
	var cases: Array = JSON.parse_string(raw).cases
	var s := SkyClock.new()
	var bad := 0
	for c in cases:
		s.set_plan(c.plan)
		if absf(float(s.light_at(float(c.ms)).k) - float(c.k)) > 1e-6:
			bad += 1
	check(cases.size() > 0 and bad == 0, "light_at matches %d shared cases (%d off)" % [cases.size(), bad])
	s.free()


func test_clock() -> void:
	print("sky: clock")
	var s := _fresh()
	for f in 30:
		await t.process_frame
	check(s.clock == 0.0, "a fresh sky holds at 0 with no clock event")
	s.set_clock(5000.0, true)
	check(absf(s.clock - 5.0) < 0.05, "set_clock(5000, true): about 5 s")
	var c0 := s.clock
	for f in 30:
		await t.process_frame
	check(s.clock > c0, "a running clock grows with frames")
	s.set_clock(7000.0, false)
	for f in 30:
		await t.process_frame
	check(s.clock == 7.0, "a stopped clock holds")
	s.queue_free()


func test_reload_mid_sunset() -> void:
	print("sky: reload mid-sunset")
	var s := _fresh()
	s.set_plan({"light": {"from": "day", "to": "night", "atMs": 28000, "overMs": 56000}})
	s.set_clock(56000.0, true)
	check(absf(s.darkness() - 0.35) < 1e-6, "dusk at once, no ramp (%s)" % s.darkness())
	s.set_clock(0.0, false)
	check(s.darkness() == 0.0, "day before the sunset")
	s.set_clock(84000.0, false)
	check(s.darkness() == 1.0, "night after it")
	s.free()


func test_main_wiring() -> void:
	print("sky: main wiring")
	main._on_race_event({"kind": "clock", "ms": 12000, "running": true})
	await t.process_frame
	check(main.weather.time == main.sky.clock and main.sky.clock >= 12.0, "weather.time is sky.clock after a clock event")
	main._on_race_event({"kind": "clock", "ms": 3000, "running": false})
	check(main.weather.time == 3.0, "and follows the next one")
	t._probe_session()


func test_static_plans() -> void:
	print("sky: static plans")
	var s := _fresh()
	s.set_plan({"light": {"from": "night", "to": "night", "atMs": 0, "overMs": 0}})
	check(s.darkness() == 1.0, "static night: darkness 1")
	s.set_plan({})
	check(s.darkness() == 0.0, "missing plan: darkness 0")
	s.set_plan({"light": {"from": "noon", "to": "night"}})
	check(s.darkness() == 0.0, "bad plan: static day")
	s.free()
