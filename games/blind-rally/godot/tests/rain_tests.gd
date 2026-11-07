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
	test_quiet_once_landed(cases)
	await test_grip_effect()
	test_puddles_placed()
	await test_wet_look()
	await test_puddle_drag()
	await test_splash_adds_no_material()


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


## The straightest 90 m of the centreline: start transform.
func _straight_xf() -> Transform3D:
	var c: PackedVector3Array = main.track.centerline
	var win := 45 # points, 2 m apart
	var best := 5
	var best_bend := INF
	for i in range(5, c.size() - win - 5, 5):
		var a := (c[i + 1] - c[i - 1]).normalized()
		var bend := 0.0
		for j in range(i, i + win, 5):
			bend = maxf(bend, 1.0 - a.dot((c[j + 1] - c[j - 1]).normalized()))
		if bend < best_bend:
			best_bend = bend
			best = i
	return Transform3D(Basis.looking_at(c[best + 1] - c[best - 1], Vector3.UP), c[best] + Vector3(0, 0.6, 0))


func test_grip_effect() -> void:
	var lat := {}
	for w in [0.0, 1.0]:
		await t.place(_straight_xf())
		await t.idle(0.1)
		check(car.surface == "road", "wet %.0f: the car starts on road (%s)" % [w, car.surface])
		car.wet = w
		var peak := 0.0 # largest sideways speed while still on road
		var road_frames := 0
		for f in 120:
			if f % 2 == 0:
				car.set_control(0.5, 1.0, 0.0)
			await t.physics_frame
			if car.surface == "road":
				road_frames += 1
				peak = maxf(peak, absf(car.lateral_speed))
		lat[w] = peak
		print("    wet %.0f: peak lateral %.2f m/s over %d frames on road" % [w, peak, road_frames])
		check(road_frames > 30, "wet %.0f: %d frames on road" % [w, road_frames])
	car.wet = 0.0
	car.neutralize()
	check(lat[1.0] > lat[0.0], "wet road: more lateral slip within 2 s (%.2f vs %.2f)" % [lat[1.0], lat[0.0]])


func test_quiet_once_landed(cases: Array) -> void:
	var s := SkyClock.new()
	main.add_child(s)
	s.set_plan(_plan_where(cases, 0.0, 1.0)) # rain lands at 70000, wet at 90000
	s.set_clock(75000.0, false)
	var log: Array = []
	var last := [s.rain(), s.wetness()]
	s.rain_changed.connect(func(r: float, w: float) -> void:
		log.append(maxf(absf(r - last[0]), absf(w - last[1])))
		last[0] = r
		last[1] = w)
	for f in 10:
		s.set_clock(75000.0 + 20.0 * (f + 1), false) # ~0.0003 wet per step
	check(s.rain() == 1.0 and s.wetness() < 1.0, "rain landed, road still wetting (wet %.3f)" % s.wetness())
	var ok := true
	for m in log:
		ok = ok and m >= 0.002
	check(ok and log.size() <= 2, "rain_changed stays quiet once rain landed: %d emits in 10 small steps" % log.size())
	s.queue_free()


const SOAKED := {"rain": {"from": 1, "to": 1, "atMs": 0, "overMs": 0}}


## Puddles: seeded, on the road, capped, and none where it snows.
func test_puddles_placed() -> void:
	print("puddles")
	var track: Track = main.track
	var a := Puddles.place(track, 4242, false)
	check(a == Puddles.place(track, 4242, false), "same stage, same seed: the same %d puddles" % a.size())
	check(a != Puddles.place(track, 99, false), "another seed: other puddles")
	var lo := floori(track.length_m / 120.0) - 4
	check(a.size() >= lo and a.size() <= Puddles.PUDDLE_MAX, "Pine Panic (%.0f m): %d puddles, in [%d, %d]" % [track.length_m, a.size(), lo, Puddles.PUDDLE_MAX])
	var space := track.get_world_3d().direct_space_state
	var on_road := true
	var sized := true
	for p in a:
		var at := Vector3(p.x, track.height_at(p.x, p.y), p.y)
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(at + Vector3.UP * 20.0, at + Vector3.DOWN * 20.0, 8))
		on_road = on_road and not hit.is_empty() and String(hit.collider.get_meta("surface", "")) in ["road", "tarmac"]
		sized = sized and p.z >= 1.6 and p.z <= 2.8
	check(on_road, "every puddle's centre is on road or tarmac (re-probed)")
	check(sized, "every radius is 1.6 to 2.8 m")
	check(Puddles.place(track, 4242, true).is_empty(), "where it snows: no puddles")
	check(main.puddles == car.puddles and not car.puddles.is_empty(), "main hands the stage's %d puddles to the car" % car.puddles.size())


## Every registered material the weather pushes to, by kind: ground, road.
func _ground_and_road() -> Array[ShaderMaterial]:
	return main.track.world_materials()


## The wet look: sky_wet follows the wetness on the ground and road; dry
## leaves it 0; a static sky pushes nothing per frame.
func test_wet_look() -> void:
	print("wet look")
	var sky: SkyClock = main.sky
	var w: Weather = main.weather
	sky.set_plan(SOAKED)
	sky.set_clock(0.0, false)
	var mats := _ground_and_road()
	var soaked := not mats.is_empty()
	for m in mats:
		soaked = soaked and is_equal_approx(float(m.get_shader_parameter("sky_wet")), 1.0)
	check(soaked, "Rain: sky_wet is 1 on the %d ground and road materials" % mats.size())
	var pushes := w.rain_pushes
	for i in 30:
		await t.process_frame
	check(w.rain_pushes == pushes, "a static wet sky pushes nothing per frame (%d pushes in 30 frames)" % (w.rain_pushes - pushes))
	sky.set_plan({})
	sky.set_clock(0.0, false)
	var dry := true
	for m in w.materials():
		dry = dry and float(m.get_shader_parameter("sky_wet")) == 0.0
	check(dry, "Dry: sky_wet is 0 on every weather material")
	pushes = w.rain_pushes
	for i in 30:
		await t.process_frame
	check(w.rain_pushes == pushes, "and a dry sky pushes nothing per frame either")
	var n := car.puddles.size()
	var every := true
	for m in w.materials():
		every = every and int(m.get_shader_parameter("puddle_count")) == n
	check(n > 0 and every, "every weather material has the %d puddles" % n)
	var stray := []
	for g in main.find_children("*", "GeometryInstance3D", true, false):
		for m in _materials(g as GeometryInstance3D):
			var c: Variant = (m as ShaderMaterial).get_shader_parameter("puddle_count") if m is ShaderMaterial else null
			if c != null and int(c) > 0 and not w.materials().has(m):
				stray.append(m)
	check(stray.is_empty(), "and only those: no other material got puddles (%d)" % stray.size())
	check((MapController.CULL_MASK & Weather.LAYER) == 0, "the map camera still skips the weather layer")
	var gated := true
	for path in ["res://shaders/road.gdshader", "res://shaders/ground.gdshader"]:
		var code: String = load(path).code
		var gate := code.find("weather_seen(CAMERA_VISIBLE_LAYERS)) {")
		gated = gated and gate >= 0 and code.find("sky_wet") > gate and (not code.contains("puddle_at") or code.find("puddle_at") > gate)
	check(gated, "the wet terms sit inside the weather gate (ground, road)")


## The car at xf, already doing `speed` along its heading.
func _approach(xf: Transform3D, speed: float) -> void:
	await t.place(xf)
	car.velocity = -xf.basis.z * speed
	car.forward_speed = speed


## Seconds to cover `dist` m along the heading from xf at full throttle,
## starting at `speed`, with car.wet = wet. Sub-frame, and the surface must
## stay road the whole way.
func _pass(xf: Transform3D, wet: float, speed: float, dist: float) -> Dictionary:
	await _approach(xf, speed)
	car.wet = wet
	var fwd := -xf.basis.z
	var prev := 0.0
	var road := true
	var v_at := -1.0
	for f in 600:
		car.set_control(0.0, 1.0, 0.0)
		await t.physics_frame
		road = road and car.surface == "road"
		var now := (car.global_position - xf.origin).dot(fwd)
		if v_at < 0.0 and now >= dist * 0.5:
			v_at = car.forward_speed
		if now >= dist:
			car.wet = 0.0
			car.neutralize()
			return {"t": (f + (dist - prev) / maxf(now - prev, 1e-6)) / 60.0, "road": road, "v": v_at}
		prev = now
	car.wet = 0.0
	car.neutralize()
	return {"t": INF, "road": road, "v": v_at}


## Puddle drag: one puddle on a straight, at 20 m/s. Wet 1 costs 0.15 to
## 0.25 s against dry; wet 0.2 costs nothing.
func test_puddle_drag() -> void:
	print("puddle drag")
	var xf := _straight_xf()
	var ahead := xf.origin - xf.basis.z * 30.0
	var saved := car.puddles
	car.puddles = PackedVector3Array([Vector3(ahead.x, ahead.z, 2.2)])
	var dry := await _pass(xf, 0.0, 20.0, 70.0)
	var soaked := await _pass(xf, 1.0, 20.0, 70.0)
	var damp := await _pass(xf, 0.2, 20.0, 70.0)
	car.puddles = PackedVector3Array()
	var damp_none := await _pass(xf, 0.2, 20.0, 70.0)
	var soaked_none := await _pass(xf, 1.0, 20.0, 70.0)
	car.puddles = saved
	print("    70 m from 20 m/s: dry %.3f s, wet 1 %.3f s (no puddle %.3f), wet 0.2 %.3f s" % [dry.t, soaked.t, soaked_none.t, damp.t])
	check(dry.road and soaked.road and damp.road and damp_none.road and soaked_none.road, "every pass stays on the road")
	check(soaked.v < soaked_none.v and soaked.v < dry.v, "wet 1: the puddle costs speed (%.2f vs %.2f m/s without it)" % [soaked.v, soaked_none.v])
	var cost: float = soaked.t - dry.t
	check(cost >= 0.15 and cost <= 0.25, "wet 1: the pass costs %.3f s against dry (0.15 to 0.25)" % cost)
	check(damp.t == damp_none.t and damp.v == damp_none.v, "wet 0.2: the puddle costs nothing (%.4f vs %.4f s)" % [damp.t, damp_none.t])


## A splash is the dust's own puffs: driving through a puddle in the wet
## draws no material the warm-up hadn't.
func test_splash_adds_no_material() -> void:
	print("splash")
	var before := _all_materials()
	var fx: CarFx = main.fx
	var xf := _straight_xf()
	var ahead := xf.origin - xf.basis.z * 20.0
	var saved := car.puddles
	car.puddles = PackedVector3Array([Vector3(ahead.x, ahead.z, 2.2)])
	var splashes := fx.splashes
	await _approach(xf, 20.0)
	car.wet = 1.0
	for f in 90:
		car.set_control(0.0, 1.0, 0.0)
		await t.physics_frame
	check(fx.splashes == splashes + 1, "one splash going through (%d)" % (fx.splashes - splashes))
	car.wet = 0.2
	await _approach(xf, 20.0)
	for f in 90:
		car.set_control(0.0, 1.0, 0.0)
		await t.physics_frame
	check(fx.splashes == splashes + 1, "none at wet 0.2")
	car.wet = 0.0
	car.neutralize()
	car.puddles = saved
	var added := []
	for m in _all_materials():
		if not before.has(m):
			added.append(m)
	check(added.is_empty(), "splashing adds no material after GO (%d new)" % added.size())
	check(fx.warm_sources().has(fx.get_node("Dust")), "and the dust puffs it's drawn with are a warm-up source")


func _all_materials() -> Dictionary:
	var out := {}
	for n in main.find_children("*", "GeometryInstance3D", true, false):
		for m in _materials(n as GeometryInstance3D):
			out[m] = true
	return out


func _materials(gi: GeometryInstance3D) -> Array:
	if gi.material_override:
		return [gi.material_override]
	var out := []
	var mesh: Mesh = null
	if gi is MeshInstance3D:
		mesh = (gi as MeshInstance3D).mesh
	elif gi is MultiMeshInstance3D and (gi as MultiMeshInstance3D).multimesh:
		mesh = (gi as MultiMeshInstance3D).multimesh.mesh
	if mesh:
		for i in mesh.get_surface_count():
			var m: Material = mesh.surface_get_material(i)
			if gi is MeshInstance3D and i < (gi as MeshInstance3D).get_surface_override_material_count() and (gi as MeshInstance3D).get_surface_override_material(i):
				m = (gi as MeshInstance3D).get_surface_override_material(i)
			if m:
				out.append(m)
	return out
