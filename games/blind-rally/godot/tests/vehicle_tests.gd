extends RefCounted
## Rally's car classes (scripts/vehicles.gd). Run from run_tests.gd, with its
## helpers and its pass/fail count. Leaves the car on hatch, so later tests
## see today's car.

## Least share of a body's surface in the team colour. The tractor's bonnet
## alone (Kenney's only orange) was 12% and read grey from the chase camera;
## the two-tone 4x4, lowest of the rest, is 18%.
const PAINT_SHARE := 0.15
## test_speed_cap's slack over a class's flat top speed: slope_pull adds speed
## downhill, so a car can briefly run past max_speed × surface top.
const SLOPE_MARGIN := 1.15
## Autopilot stage time against the hatch's: the three fast classes within
## ±8%, the tractor up to 35% slower (it's meant to be slow, not hopeless).
const CLOSE := 0.08
const TRACTOR_SLOWER := 0.35

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
	test_audio_per_class()
	await test_close_times()
	# Drop the test livery, so later tests get the baked paint back.
	car.remove_meta("livery")
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
		var worst := car.max_speed * best * SLOPE_MARGIN
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
		var share := painted_share(body.mesh, team)
		check(share > PAINT_SHARE, "%s: %d%% of the body's surface in the team colour" % [id, roundi(share * 100.0)])
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


## Surface area in `color`, as a share of the mesh's (baked meshes are one
## unindexed surface).
static func painted_share(mesh: Mesh, color: Color) -> float:
	var a := mesh.surface_get_arrays(0)
	var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
	var cols: PackedColorArray = a[Mesh.ARRAY_COLOR]
	var total := 0.0
	var painted := 0.0
	for i in range(0, v.size(), 3):
		var area := (v[i + 1] - v[i]).cross(v[i + 2] - v[i]).length()
		total += area
		var c := cols[i]
		if c.s > CarPaint.MIN_SAT * 0.5 and absf(c.h - color.h) < CarPaint.HUE_TOLERANCE:
			painted += area
	return painted / maxf(total, 0.0001)


## A class change after the livery is on keeps the team colour.
func test_preset_keeps_livery() -> void:
	CarPaint.apply(car, Color("#cc79a7"), 4, "diamond")
	car.apply_preset("truck")
	var body := car.get_node("Visual/Body") as MeshInstance3D
	check(body.mesh != body.get_meta("baked_mesh"), "truck repainted after the swap")
	check((body.get_node("Roundel") as MeshInstance3D).mesh == CarPaint.plate_mesh("diamond"), "and keeps its diamond plate")


## Each class builds its own engine loop: `period` samples a cycle, 24 cycles.
## The hatch's is today's 400.
func test_audio_per_class() -> void:
	var audio: CarAudio = t.main.audio
	for id in Vehicles.IDS:
		car.apply_preset(id)
		audio.start()
		var a: Dictionary = Vehicles.get_preset(id)["audio"]
		var want := int(a.get("period", CarAudio.PERIOD)) * CarAudio.CYCLES
		var got := audio.engine_samples()
		check(got == want, "%s engine loop is %d samples (%d)" % [id, want, got])
	car.apply_preset("hatch")
	audio.start()
	check(audio.engine_samples() == 9600, "hatch engine loop is today's 9600 samples")


## The autopilot drives Pine Panic in every class. Fair picks finish close to
## the hatch; the tractor is allowed to be slow. Each run stops at twice the
## hatch's time, so a stuck car fails instead of hanging the suite.
func test_close_times() -> void:
	var times := {}
	var cap := 240.0
	for id in Vehicles.IDS:
		car.apply_preset(id)
		await t.place(t.track.get_spawn().global_transform)
		t.main.checkpoints_passed = 0
		t.main.finished = false
		t.main.recoveries = 0
		t.main.set_autopilot(true)
		var frames := 0
		while frames < cap * 60.0 and not t.main.finished:
			await t.physics_frame
			frames += 1
		t.main.set_autopilot(false)
		var secs := frames / 60.0
		check(t.main.finished, "%s finishes Pine Panic on autopilot (%.1f s, CP %d)" % [id, secs, t.main.checkpoints_passed])
		times[id] = secs
		if id == "hatch":
			cap = secs * 2.0
	var hatch: float = times["hatch"]
	for id in ["4x4", "rwd", "truck"]:
		var d: float = times[id] / hatch - 1.0
		check(absf(d) <= CLOSE, "%s within %d%% of the hatch (%+.1f%%)" % [id, roundi(CLOSE * 100.0), d * 100.0])
	var dt: float = times["tractor"] / hatch - 1.0
	check(dt <= TRACTOR_SLOWER, "tractor no more than %d%% slower than the hatch (%+.1f%%)" % [roundi(TRACTOR_SLOWER * 100.0), dt * 100.0])
	t.main.finished = false
	t.main.checkpoints_passed = 0
	car.apply_preset("hatch")
