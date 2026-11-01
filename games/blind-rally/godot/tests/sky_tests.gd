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
	test_tints()
	await test_night_applied()
	test_late_register()
	test_shadows()
	test_env_sunset()


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


func test_tints() -> void:
	print("sky: tints")
	var s := SkyClock.new()
	check(s.tint() == SkyClock.TINTS["day"], "no plan: the day tint (white)")
	s.set_plan({"light": {"from": "night", "to": "night", "atMs": 0, "overMs": 0}})
	check(s.tint() == SkyClock.TINTS["night"], "static night: the night tint")
	s.set_plan({"light": {"from": "day", "to": "night", "atMs": 0, "overMs": 1000}})
	s.set_clock(500.0, false)
	check(s.tint().is_equal_approx(SkyClock.TINTS["dusk"]), "half way day to night: the dusk tint, like darkness")
	s.free()


## Night on, night off: what every material reads, and what the map keeps.
func _night() -> void:
	main.sky.set_plan({"light": {"from": "night", "to": "night", "atMs": 0, "overMs": 0}})
	main.sky.set_clock(0.0, false)


func _day() -> void:
	main.sky.set_plan({})
	main.sky.set_clock(0.0, false)


## [shaded, unshaded]: every material the sky should reach.
func _sky_mats() -> Array:
	var shaded: Array = main.weather.materials().duplicate()
	var flat: Array = []
	var ef: EyeForest = main.eye_forest
	if ef and ef.ring:
		flat.append(ef.ring.material_override)
	if ef:
		for pair in ef.tall:
			flat.append((pair[1] as MeshInstance3D).material_override)
	flat.append(main.weather._mist_mat)
	if main.weather._snow_mat:
		flat.append(main.weather._snow_mat)
	return [shaded, flat]


func _reads(mats: Array, dark: float, tint: Color) -> bool:
	for m in mats[0]:
		var d: Variant = m.get_shader_parameter("sky_dark")
		var c: Variant = m.get_shader_parameter("sky_tint")
		if not (d is float) or absf(d - dark) > 1e-4 or not (c is Color) or not c.is_equal_approx(tint):
			return false
	for m in mats[1]:
		var c: Variant = m.get_shader_parameter("sky_tint")
		if not (c is Color) or not c.is_equal_approx(tint):
			return false
	return true


func test_night_applied() -> void:
	print("sky: night in the shaders")
	if main.eye_forest == null:
		main.set_camera_mode(FollowCamera.Mode.CHASE)
		main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	var ef: EyeForest = main.eye_forest
	check(ef != null and ef.ring != null and ef.tall.size() > 0, "the eye forest has a treeline and a far landmark to check")
	var sun := main.track.get_node_or_null("Sun") as DirectionalLight3D
	var sun_c := sun.light_color
	var sun_e := sun.light_energy
	var mats := _sky_mats()
	check(mats[0].size() > 3, "materials registered with Weather (%d)" % mats[0].size())
	_night()
	check(_reads(mats, 1.0, SkyClock.TINTS["night"]), "night: every material reads sky_dark 1 and the night tint")
	# On a GPU the map is a copied image by now (no camera left to draw it again).
	var mcam: Camera3D = main.map.map_camera()
	check((MapController.CULL_MASK & 8) == 0 and (mcam == null or (mcam.cull_mask & 8) == 0), "map camera still skips layer 4")
	check(sun.light_color == sun_c and sun.light_energy == sun_e, "the Sun keeps its scene colour and energy")
	var back: Transform3D = main.car.global_transform
	main.car.reset_to(back.translated(Vector3(17.0, 0.0, 9.0)))
	# process_frame fires before the nodes' _process: two, so Weather's ran.
	await t.process_frame
	await t.process_frame
	check(_reads(mats, 1.0, SkyClock.TINTS["night"]), "and still after a frame")
	var mc: Variant = main.PALETTE.get_shader_parameter("mist_car")
	var at: Vector3 = main.car.get_global_transform_interpolated().origin
	check(mc is Vector3 and (mc as Vector3).distance_to(at) < 0.5, "the car's keyhole follows the car at night, any camera (%s vs %s)" % [mc, at])
	main.car.reset_to(back)
	_day()
	check(_reads(mats, 0.0, Color(1, 1, 1)), "day: sky_dark 0 and white, today's look")
	check(sun.light_color == sun_c and sun.light_energy == sun_e, "the Sun unchanged at day too")


func test_late_register() -> void:
	print("sky: late registration")
	var m := ShaderMaterial.new()
	m.shader = preload("res://shaders/palette.gdshader")
	var u := ShaderMaterial.new()
	u.shader = preload("res://shaders/treeline.gdshader")
	_night()
	main.weather.register(m)
	main.weather.register_tinted(u)
	check(_reads([[m], [u]], 1.0, SkyClock.TINTS["night"]), "a material registered at night gets the night values")
	_day()
	check(_reads([[m], [u]], 0.0, Color(1, 1, 1)), "and follows the sky back to day")
	main.weather.unregister(m)
	main.weather.unregister_tinted(u)


func test_shadows() -> void:
	print("sky: shadows, per plan")
	var sun := main.track.get_node_or_null("Sun") as DirectionalLight3D
	var was := sun.shadow_enabled
	main.set_shadows(true)
	_night()
	check(not sun.shadow_enabled, "a static night plan: no sun shadows")
	_day()
	check(sun.shadow_enabled, "day: back to what was wanted (on)")
	main.sky.set_plan({"light": {"from": "day", "to": "night", "atMs": 0, "overMs": 10000}})
	main.sky.set_clock(10000.0, false)
	check(main.sky.darkness() == 1.0 and sun.shadow_enabled, "day into night: shadows stay on, even at darkness 1")
	main.sky.set_clock(5000.0, false)
	check(sun.shadow_enabled, "and all through the ramp")
	_day()
	main.set_shadows(false) # a phone
	_night()
	check(not sun.shadow_enabled, "a phone at night: off")
	_day()
	check(not sun.shadow_enabled, "a phone's shadows stay off back at day")
	main.set_shadows(was)


## A sunset steps the eye-level sky and fog in ENV_STEP strides (each one
## re-bakes the sky's radiance), and lands exactly on the night colours.
func test_env_sunset() -> void:
	print("sky: eye-level sky through a sunset")
	_day()
	var base: Color = main._eye_base.fog
	var before: int = main.env_retints
	main.sky.set_plan({"light": {"from": "day", "to": "night", "atMs": 0, "overMs": 60000}})
	var ms := 0.0
	while ms <= 60000.0:
		main.sky.set_clock(ms, false)
		ms += 100.0
	var n: int = main.env_retints - before
	var bound := ceili(1.0 / main.ENV_STEP) + 1 # darkness spans 1.0, the widest of its channels
	check(n > 3 and n <= bound, "a minute of sunset re-tints the sky %d times (<= %d), not ~600" % [n, bound])
	var fog: Color = main._eye_env.fog_light_color
	check(fog.is_equal_approx(base * SkyClock.TINTS["night"]), "ends on base fog x the night tint exactly (%s)" % fog)
	_day()
	check(main._eye_env.fog_light_color.is_equal_approx(base), "and day puts the fog back")
