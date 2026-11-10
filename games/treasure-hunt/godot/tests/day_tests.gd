extends RefCounted
## M4a's day clock and light: DayClock against shared/sky.ts (day_cases.json
## is written by the TS tests), the wall-time clock, Daylight on a bare
## sun/moon/env/sky, the skyClock bridge seam, and main's wiring.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("day")
	test_cases()
	test_clock()
	test_dark_changed()
	test_daylight()
	test_bridge()
	await test_main()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func test_cases() -> void:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://tests/day_cases.json"))
	var cases: Array = parsed.cases if parsed is Dictionary and parsed.get("cases") is Array else []
	check(cases.size() > 0, "day_cases.json has cases (%d)" % cases.size())
	var bad: Array[String] = []
	for c in cases:
		var s := DayClock.sun_at(float(c.min))
		var d := DayClock.dark_at(float(c.min))
		# az 0 and 360 are the same bearing.
		var daz := absf(fposmod(s.x - float(c.az) + 180.0, 360.0) - 180.0)
		if daz > 1e-3 or absf(s.y - float(c.el)) > 1e-3 or absf(d - float(c.dark)) > 1e-3:
			bad.append("min %s: got az %.4f el %.4f dark %.4f, want %s %s %s" % [c.min, s.x, s.y, d, c.az, c.el, c.dark])
	check(bad.is_empty(), "sun_at and dark_at match sky.ts on every case %s" % [bad])


func test_clock() -> void:
	var c := DayClock.new()
	check(c.minute() == 600.0 and not c.running, "a new clock: 10:00, stopped")
	c.fake_usec = 1_000_000
	c.set_clock(720, false)
	c.fake_usec += 2_000_000
	check(c.minute() == 720.0, "stopped: still 720 after 2 s (%.4f)" % c.minute())
	c.set_clock(720, true)
	c.fake_usec += 2_000_000
	check(absf(c.minute() - (720.0 + 2.0 / 60.0)) < 1e-6, "running: 720 + 2/60 after 2 s (%.4f)" % c.minute())
	# A hidden tab: no frames for a minute, and the clock is still right.
	c.fake_usec += 60_000_000
	check(absf(c.minute() - (720.0 + 62.0 / 60.0)) < 1e-6, "a minute with no frames: still on time (%.4f)" % c.minute())
	c.set_clock(800, false)
	c.fake_usec += 5_000_000
	check(c.minute() == 800.0, "set again, stopped: 800")
	c.free()


func test_dark_changed() -> void:
	var c := DayClock.new()
	var got: Array[float] = []
	c.dark_changed.connect(func(d: float) -> void: got.append(d))
	c.fake_usec = 0
	c.set_clock(600, false)
	check(got == [0.0], "the first set says the dark at once (%s)" % [got])
	c.refresh()
	check(got.size() == 1, "nothing moved: nothing said")
	# Dusk: 1080 is sunset. Step through it a minute at a time.
	c.set_clock(1060, true)
	for i in 60:
		c.fake_usec += 60_000_000
		c.refresh()
	var rising := true
	for i in range(1, got.size()):
		rising = rising and got[i] > got[i - 1]
	check(got.size() > 5 and rising and got[-1] == 1.0, "through sunset: it rises in steps and lands on 1 (%d steps, last %.3f)" % [got.size(), got[-1]])
	var steps_ok := true
	for i in range(1, got.size() - 1):
		steps_ok = steps_ok and got[i] - got[i - 1] > 0.01
	check(steps_ok, "each step moved more than 0.01")
	c.free()


func _rig() -> Dictionary:
	var sun := DirectionalLight3D.new()
	sun.shadow_enabled = true
	var moon := DirectionalLight3D.new()
	moon.light_energy = 0.0
	var env := Environment.new()
	env.ambient_light_energy = 0.8
	env.fog_light_color = Color(0.68, 0.78, 0.88)
	var sky := ProceduralSkyMaterial.new()
	sky.sky_top_color = Color(0.3, 0.5, 0.78)
	sky.sky_horizon_color = Color(0.68, 0.78, 0.88)
	var dl := Daylight.new()
	dl.setup(sun, moon, env, sky)
	return {"sun": sun, "moon": moon, "env": env, "sky": sky, "dl": dl}


func _free(r: Dictionary) -> void:
	r.sun.free()
	r.moon.free()
	r.dl.free()


func test_daylight() -> void:
	var r := _rig()
	var sun: DirectionalLight3D = r.sun
	var moon: DirectionalLight3D = r.moon
	var env: Environment = r.env
	var sky: ProceduralSkyMaterial = r.sky
	r.dl.apply(720)
	var fwd := -sun.basis.z
	var flat := Vector2(fwd.x, fwd.z).normalized()
	check(flat.distance_to(Vector2(0, -1)) < 1e-3 and fwd.y < 0.0, "noon: the light heads north and down, the sun is south (%s)" % [fwd])
	check(absf(fwd.y + sin(deg_to_rad(55.0))) < 1e-3, "noon: 55 degrees up")
	check(sun.light_energy == 1.0 and sun.shadow_enabled, "noon: sun energy 1, shadows on")
	check(moon.light_energy == 0.0 and absf(env.ambient_light_energy - 0.8) < 1e-6, "noon: no moon, ambient 0.8")
	check(sky.sky_top_color.is_equal_approx(Color(0.3, 0.5, 0.78)) and env.fog_light_color.is_equal_approx(Color(0.68, 0.78, 0.88)), "noon: today's sky and fog")
	r.dl.apply(600)
	check(sun.light_energy == 1.0 and sky.sky_horizon_color.is_equal_approx(Color(0.68, 0.78, 0.88)), "10:00: today's look")
	r.dl.apply(0)
	check(sun.light_energy == 0.0 and not sun.shadow_enabled, "midnight: sun energy 0, no shadows")
	check(absf(moon.light_energy - 0.15) < 1e-6 and not moon.shadow_enabled, "midnight: moon 0.15, no shadows")
	check(absf(env.ambient_light_energy - 0.25) < 1e-6, "midnight: ambient 0.25")
	check(sky.sky_top_color.is_equal_approx(Color("#0b1530")) and sky.sky_horizon_color.is_equal_approx(Color("#1a2440")) and env.fog_light_color.is_equal_approx(Color("#141c30")), "midnight: the night palette")
	var mf := -moon.basis.z
	var maz := fposmod(rad_to_deg(atan2(-mf.x, mf.z)), 360.0)
	check(absf(maz - 200.0) < 1e-2 and absf(asin(-mf.y) - deg_to_rad(35.0)) < 1e-3, "the moon sits at az 200, el 35 (az %.2f)" % maz)
	# Sunset, el 0: warm horizon, half dark.
	r.dl.apply(1080)
	var h := sky.sky_horizon_color
	check(h.r > h.b, "sunset: a warm horizon (%s)" % [h])
	check(absf(sun.light_energy - 0.5) < 1e-3, "sunset: sun energy 0.5 (%.3f)" % sun.light_energy)
	r.dl.apply(1090)
	check(not sun.shadow_enabled and sun.light_energy == 0.0, "just after sunset: the sun is below the horizon, so no energy and no shadows (%.3f)" % sun.light_energy)
	r.dl.apply(1070)
	check(sun.light_energy > 0.0 and sun.light_energy < 1.0, "before sunset: dusk sun still lights (%.3f)" % sun.light_energy)
	_free(r)


func test_bridge() -> void:
	var b := WebBridge.new()
	var got: Array = []
	b.sky_clock_set.connect(func(m: float, run: bool) -> void: got.append([m, run]))
	b.receive_sky_clock_json('{"min":1100,"running":true}')
	check(got == [[1100.0, true]], "skyClock {min 1100, running} emits (1100, true) (%s)" % [got])
	b.receive_sky_clock_json('{"min":"x","running":true}')
	b.receive_sky_clock_json('{"min":5}')
	b.receive_sky_clock_json('[]')
	check(got.size() == 1, "a malformed skyClock is dropped")
	b.free()


func test_main() -> void:
	var main: Node3D = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	await t.process_frame
	var clock: DayClock = main.day_clock
	var sun: DirectionalLight3D = main.get_node("Sun")
	var moon: DirectionalLight3D = main.get_node("Moon")
	check(clock != null and clock.minute() == 600.0 and not clock.running, "main: the clock sits at 10:00 before any skyClock")
	check(sun.light_energy == 1.0 and sun.shadow_enabled and moon.light_energy == 0.0 and not moon.shadow_enabled, "main: a day sun, a dark moon")
	main.bridge.receive_sky_clock_json('{"min":0,"running":false}')
	await t.process_frame
	check(clock.minute() == 0.0 and sun.light_energy == 0.0 and absf(moon.light_energy - 0.15) < 1e-6, "main: skyClock midnight puts the moon up on the next frame")
	main.queue_free()
	await t.process_frame
