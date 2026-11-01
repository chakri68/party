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
	test_session_clock()
	test_static_plans()
	test_tints()
	await test_night_applied()
	test_late_register()
	test_shadows()
	test_env_sunset()
	test_haze()
	await test_headlights()
	await test_ghost_heads()
	test_glow_boost()


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


## A Godot that boots mid-race (a reload) gets its clock in initSession: the
## host's first clock event fires before the stage is loaded, with nothing
## listening yet, and the host never says it again.
func test_session_clock() -> void:
	print("sky: session clock")
	var sunset := {"light": {"from": "day", "to": "night", "atMs": 28000, "overMs": 56000}}
	var tr: Track = main.track
	main.track = null # the stage is still loading: the session waits
	main._on_session({"sky": sunset, "clock": {"ms": 56000, "running": true}}, "")
	check(main._pending_session.size() == 1, "a session before the track is queued")
	main.track = tr
	main._replay_sessions()
	check(absf(main.sky.clock - 56.0) < 0.05 and main.sky.running, "the queued session lands on its clock (%s s)" % main.sky.clock)
	check(absf(main.sky.darkness() - 0.35) < 0.01, "mid-sunset: dusk at once (%s)" % main.sky.darkness())
	main._on_session({"sky": sunset, "clock": "junk"}, "")
	check(main.sky.clock == 0.0 and not main.sky.running, "a malformed clock: 0, stopped")
	main._on_session({"sky": sunset, "clock": {"ms": "x", "running": true}}, "")
	check(main.sky.clock == 0.0 and not main.sky.running, "a clock with no number: 0, stopped")
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
	var hz := SkyClock.haze(dark, tint) # the unshaded ones take the haze
	for m in mats[1]:
		var c: Variant = m.get_shader_parameter("sky_tint")
		if not (c is Color) or not c.is_equal_approx(hz):
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
	main.weather._tinted.erase(u) # test cleanup; nothing in the game unregisters one


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
	check(fog.is_equal_approx(base * SkyClock.haze(1.0, SkyClock.TINTS["night"])), "ends on base fog x the night haze exactly (%s)" % fog)
	_day()
	check(main._eye_env.fog_light_color.is_equal_approx(base), "and day puts the fog back")


## The horizon mustn't glow over a dark stage: at night the eye-level sky
## and fog, and the mist glow in every world shader, dim with the dark
## (SkyClock.haze), not just tint. Day keeps today's look.
func test_haze() -> void:
	print("sky: the haze dims at night")
	var night: Color = SkyClock.TINTS["night"]
	check(SkyClock.haze(0.0, Color(1, 1, 1)) == Color(1, 1, 1), "day: haze is white, today's sky")
	var hz := SkyClock.haze(1.0, night)
	var k := SkyClock.HAZE_FLOOR
	check(hz.is_equal_approx(Color(night.r * k, night.g * k, night.b * k)), "night: haze is the tint x HAZE_FLOOR (%s)" % hz)
	check(SkyClock.HAZE_FLOOR > 0.12 and SkyClock.HAZE_FLOOR <= 0.4, "HAZE_FLOOR above the ground's NIGHT_FLOOR, well under day (%s)" % SkyClock.HAZE_FLOOR)
	_night()
	var top: Color = (main._eye_env.sky.sky_material as ProceduralSkyMaterial).sky_top_color
	check(top.is_equal_approx(main._eye_base.sky_top * hz), "night: the eye-level sky top is base x haze (%s)" % top)
	check(main._eye_env.fog_light_color.is_equal_approx(main._eye_base.fog * hz), "night: the fog is base x haze")
	_day()
	top = (main._eye_env.sky.sky_material as ProceduralSkyMaterial).sky_top_color
	check(top.is_equal_approx(main._eye_base.sky_top), "day: the sky top is back to base")
	# Shaders: the mist glow over a dark stage takes sky_haze(), never the bare tint.
	var inc := FileAccess.get_file_as_string("res://shaders/weather.gdshaderinc")
	check(inc.contains("const float HAZE_FLOOR = %s;" % str(SkyClock.HAZE_FLOOR)), "weather.gdshaderinc's HAZE_FLOOR matches SkyClock's")
	for f in ResourceLoader.list_directory("res://shaders/"):
		if not f.ends_with(".gdshader"):
			continue
		var src := FileAccess.get_file_as_string("res://shaders/" + f)
		if src.contains("weather.gdshaderinc") and src.contains("mist_tint"):
			check(not src.contains("mist_tint * sky_tint") and src.contains("sky_haze()"), "%s: the mist glow takes sky_haze()" % f)
	# The Sun keeps its scene light, so a glossy surface's glint would stay at
	# day strength over a dark stage: the sea and icy road scale SPECULAR by
	# the light at the pixel (headlights included).
	for f in ["sea.gdshader", "road.gdshader"]:
		var src := FileAccess.get_file_as_string("res://shaders/" + f)
		check(src.contains("shine = max(lit.r, max(lit.g, lit.b));") and src.contains(") * shine;"), "%s: the glint dims with the light" % f)


## Runs `cb` from _process after every other node's (Weather's, Ghosts'),
## so a test reads what was pushed and what it was pushed from in one frame.
class Late extends Node:
	var cb: Callable
	func _process(_dt: float) -> void:
		cb.call()


## One frame's look, taken after Weather and Ghosts ran: a physics tick,
## then a render frame.
func _after_frame(cb: Callable) -> void:
	var late := Late.new()
	late.process_priority = 1000
	late.cb = cb
	main.add_child(late)
	await t.physics_frame
	await t.process_frame
	await t.process_frame
	late.queue_free()


## Our headlights follow the car's drawn (interpolated) transform at night,
## and stop costing anything once day's value is in.
func test_headlights() -> void:
	print("sky: headlights")
	var back: Transform3D = main.car.global_transform
	main.car.reset_to(Transform3D(Basis(Vector3.UP, 0.7), back.origin + Vector3(6.0, 0.0, -4.0)))
	_night()
	var seen := {}
	await _after_frame(func() -> void:
		var xf: Transform3D = main.car.get_global_transform_interpolated()
		seen["at"] = xf.origin
		seen["fwd"] = Vector2(-xf.basis.z.x, -xf.basis.z.z).normalized()
		seen["pos"] = main.PALETTE.get_shader_parameter("head_pos")
		seen["dir"] = main.PALETTE.get_shader_parameter("head_dir")
		seen["on"] = main.PALETTE.get_shader_parameter("head_on"))
	check(seen.pos is Vector3 and (seen.pos as Vector3).distance_to(seen.at) < 1e-3, "night: head_pos is the car's interpolated origin (%s vs %s)" % [seen.pos, seen.at])
	check(seen.dir is Vector2 and (seen.dir as Vector2).distance_to(seen.fwd) < 1e-3, "and head_dir its -Z in xz (%s vs %s)" % [seen.dir, seen.fwd])
	check(seen.on is float and absf(seen.on - 1.0) < 1e-6, "head_on is the darkness: 1 at night (%s)" % seen.on)
	var mats: Array = main.weather.materials()
	var all := true
	for m in mats:
		all = all and (m.get_shader_parameter("head_pos") as Variant) is Vector3 and absf(float(m.get_shader_parameter("head_on")) - 1.0) < 1e-6
	check(all, "on every registered material (%d)" % mats.size())
	_day()
	check(float(main.PALETTE.get_shader_parameter("head_on")) == 0.0, "day: head_on 0")
	var mark := Vector3(1234.0, 5.0, 6789.0)
	main.PALETTE.set_shader_parameter("head_pos", mark)
	main.car.reset_to(back)
	await _after_frame(func() -> void: pass)
	check(main.PALETTE.get_shader_parameter("head_pos") == mark, "and nothing pushes head_pos by day")


## Rivals' headlights: one entry per ghost, from where it's drawn.
func test_ghost_heads() -> void:
	print("sky: ghost headlights")
	var g: GhostCars = main.ghosts
	g.clear()
	g.enabled = true
	_night()
	var o: Vector3 = main.car.global_position
	for i in 3:
		g.receive(21 + i, {"teamId": 21 + i, "color": "#56b4e9", "tick": 1, "position": [o.x + 10.0 * i, o.y, o.z - 30.0], "heading": 0.4 * i, "speed": 0.0})
	var seen := {}
	await _after_frame(func() -> void:
		seen["n"] = main.PALETTE.get_shader_parameter("ghost_head_count")
		seen["heads"] = main.PALETTE.get_shader_parameter("ghost_heads")
		var nodes := []
		for i in 3:
			var nd := g.ghost_node(21 + i)
			if nd:
				nodes.append(nd.global_transform)
		seen["nodes"] = nodes)
	check(seen.n == 3, "3 rivals: ghost_head_count 3 (%s)" % seen.n)
	var heads: Variant = seen.heads
	var matched := 0
	if heads is PackedVector4Array and seen.n is int:
		for xf in seen.nodes:
			var fwd := Vector2(-xf.basis.z.x, -xf.basis.z.z)
			for k in mini(seen.n, heads.size()):
				var h: Vector4 = heads[k]
				if Vector2(h.x, h.y).distance_to(Vector2(xf.origin.x, xf.origin.z)) < 1e-3 \
						and Vector2(-sin(h.z), -cos(h.z)).distance_to(fwd) < 1e-3 and h.w > 0.0:
					matched += 1
					break
	check(matched == 3, "each entry sits on its ghost, facing its way (%d of 3)" % matched)
	for i in 9:
		g.receive(31 + i, {"teamId": 31 + i, "color": "#009e73", "tick": 1, "position": [o.x, o.y, o.z + 20.0 + i], "heading": 0.0, "speed": 0.0})
	await _after_frame(func() -> void: seen["n"] = main.PALETTE.get_shader_parameter("ghost_head_count"))
	check(seen.n == GhostCars.MAX_GHOSTS, "more rivals than seats: capped at %d (%s)" % [GhostCars.MAX_GHOSTS, seen.n])
	g.clear()
	await _after_frame(func() -> void: seen["n"] = main.PALETTE.get_shader_parameter("ghost_head_count"))
	check(seen.n == 0, "ghosts gone: count back to 0 (%s)" % seen.n)
	_day()


## The landmarks' glows (beacon, campfire, eggs' lights) get brighter in
## the dark: night_boost is the darkness, 0 by day (today's look).
func test_glow_boost() -> void:
	print("sky: landmark glow")
	var glows := []
	for root in [main.track, main.eggs]:
		for n in (root as Node).find_children("*", "GeometryInstance3D", true, false):
			var m := (n as GeometryInstance3D).material_override as ShaderMaterial
			if m and m.shader and m.shader.resource_path == "res://shaders/glow.gdshader" and not glows.has(m):
				glows.append(m)
	check(glows.size() > 0, "the stage has glows to light (%d)" % glows.size())
	var boosted := func(v: float) -> bool:
		for m in glows:
			var b: Variant = m.get_shader_parameter("night_boost")
			if not (b is float) or absf(b - v) > 1e-6:
				return false
		return true
	_night()
	check(boosted.call(1.0), "night: every glow's night_boost is 1")
	_day()
	check(boosted.call(0.0), "day: 0")
	main.sky.set_plan({"light": {"from": "dusk", "to": "dusk", "atMs": 0, "overMs": 0}})
	check(boosted.call(0.35), "dusk: the darkness, 0.35")
	_day()
	# A night session builds its eggs after the plan lands: theirs get it too.
	main._on_session({"sky": {"light": {"from": "night", "to": "night", "atMs": 0, "overMs": 0}}, "eggs": {"all": true}}, "")
	var live: Array = main.weather.glows()
	var fresh := true
	for n in main.eggs.find_children("*", "GeometryInstance3D", true, false):
		var m := (n as GeometryInstance3D).material_override as ShaderMaterial
		if m and m.shader == glows[0].shader and not main._going(n, main.eggs):
			fresh = fresh and live.has(m) and float(m.get_shader_parameter("night_boost")) == 1.0
	check(fresh and boosted.call(1.0), "a night session: the stage's and the new eggs' glows at 1 (%d tracked)" % live.size())
	t._probe_session()
	check(boosted.call(0.0), "and back to 0 with the next day session")
