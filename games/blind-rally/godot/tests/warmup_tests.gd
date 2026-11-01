extends RefCounted
## Nothing gets built or compiled for the first time at GO: the engine sound
## is synthesised when the session lands, rivals' ghost meshes are built on
## the grid from initSession `rivals`, and every material that only appears
## mid-race is drawn once behind the loader (Warmup). Run from run_tests.gd
## early, before anything has pressed a key (a key press starts the audio).

var t ## the runner (run_tests.gd)
var main: Node3D
var car: CarController

const RIVALS := [
	{"teamId": 2, "color": "#56b4e9", "vehicle": "truck"},
	{"teamId": 3, "color": "#009e73", "vehicle": "tractor"},
	{"teamId": 4, "color": "#cc79a7", "vehicle": "nonsense"},
]


func _init(runner) -> void:
	t = runner


func run() -> void:
	main = t.main
	car = t.car
	test_audio_built_at_load()
	await test_rival_meshes_on_the_grid()
	await test_warmup_comes_and_goes()
	t._probe_session()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func test_audio_built_at_load() -> void:
	print("warm-up: audio")
	var audio: CarAudio = main.audio
	check(not audio.started, "no gesture yet: audio not started")
	check(audio.engine_samples() == CarAudio.PERIOD * CarAudio.CYCLES, "but the hatch's engine loop is already built (%d samples)" % audio.engine_samples())
	main._on_session({"vehicle": "truck"}, "")
	var want := int(Vehicles.get_preset("truck")["audio"].get("period", CarAudio.PERIOD)) * CarAudio.CYCLES
	check(not audio.started and audio.engine_samples() == want, "a session with a truck builds the truck's loop, still silent (%d)" % audio.engine_samples())
	var playing := false
	for p in audio.get_children():
		playing = playing or (p as AudioStreamPlayer).playing
	check(not playing, "nothing plays before the gesture")
	main._on_session({}, "")


func test_rival_meshes_on_the_grid() -> void:
	print("warm-up: rivals' ghosts")
	var g: GhostCars = main.ghosts
	main._on_session({"teamColor": "#e69f00", "teamNumber": 1, "ghosts": true, "rivals": RIVALS + [{"teamId": 1, "color": "#e69f00", "vehicle": "rwd"}, "junk", {"teamId": 5}]}, "")
	check(g.count() == 0, "no relay yet, so no ghost drawn")
	var all := true
	for r in RIVALS:
		all = all and CarPaint.ghost_cached(Vehicles.valid(r.vehicle), Color.from_string(r.color, Color.WHITE), CarPaint.shape_for(r.color))
	check(all, "each rival's ghost mesh is already in CarPaint's cache")
	check(not CarPaint.ghost_cached("rwd", Color("e69f00"), "circle"), "our own car isn't built as a ghost")
	# The first relay finds the mesh it would have built.
	var o := car.global_position + Vector3(0, 0, -30)
	g.receive(2, {"t": "ghost", "teamId": 2, "color": "#56b4e9", "tick": 1, "position": [o.x, o.y, o.z], "heading": 0.0, "speed": 0.0, "vehicle": "truck"})
	var body := g.ghost_node(2).get_node("Body") as MeshInstance3D
	check(body.mesh == CarPaint.ghost_mesh("truck", Color("56b4e9"), "square"), "and the first relay uses that same mesh")
	g.clear()
	main._on_session({"ghosts": false, "rivals": [{"teamId": 6, "color": "#d55e00", "vehicle": "4x4"}]}, "")
	check(not CarPaint.ghost_cached("4x4", Color("d55e00"), "star"), "solo stage: nothing built")


func test_warmup_comes_and_goes() -> void:
	print("warm-up: materials")
	# On the grid, as in the room: the car is held, so anything that moves it is ours.
	main._on_race_event({"kind": "freeze"})
	await t.place(main.track.get_spawn().global_transform)
	await t.idle(0.3)
	var trip := car.distance_travelled
	var cps: int = main.checkpoints_passed
	var at := car.global_position
	var renders: int = main.map.render_count
	main._on_session({"teamColor": "#e69f00", "teamNumber": 1, "ghosts": true, "rivals": RIVALS}, "")
	var w := main.get_node_or_null("Warmup") as Warmup
	check(w != null, "a session puts a warm-up node in")
	if w == null:
		return
	var mats := {}
	for n in w.find_children("*", "GeometryInstance3D", true, false):
		for m in _materials(n as GeometryInstance3D):
			mats[m] = true
	var ghost := false
	for m in mats:
		ghost = ghost or (m is ShaderMaterial and (m as ShaderMaterial).shader == GhostCars.SHADER)
	check(ghost, "it draws the ghost shader")
	var fx: CarFx = main.fx
	var fx_ok := true
	for mm in fx.warm_sources():
		fx_ok = fx_ok and mats.has((mm as MultiMeshInstance3D).multimesh.mesh.surface_get_material(0))
	check(fx_ok and fx.warm_sources().size() == 3, "and dust, tyre marks and speed streaks")
	var multi := 0
	for n in w.find_children("*", "MultiMeshInstance3D", true, false):
		multi += 1
	check(multi >= 3, "as MultiMeshes, the way they're drawn in the race (%d)" % multi)
	var covered := func(root: Node) -> bool:
		for n in root.find_children("*", "GeometryInstance3D", true, false):
			for m in _materials(n as GeometryInstance3D):
				if not mats.has(m):
					return false
		return true
	check(covered.call(main.eggs), "and every easter egg's materials, seen yet or not")
	check(covered.call(main.track), "and the stage's own (the fire tower's beacon, the campfire, signs)")
	check(w.get_child_count() < 80, "one copy per kind of draw, not per node (%d)" % w.get_child_count())
	var cam := main.get_viewport().get_camera_3d()
	var in_view := true
	for n in w.find_children("*", "GeometryInstance3D", true, false):
		var p := (n as Node3D).global_position
		in_view = in_view and not cam.is_position_behind(p)
	check(in_view, "every piece in front of the camera")
	await t.process_frame # labels shape on their first frame
	check(_largest(w) < 0.005, "and every copy's longest side under 5 mm, the stage's road and terrain too (%.4f m)" % _largest(w))
	for i in 4:
		await t.process_frame
	check(main.get_node_or_null("Warmup") == null and not is_instance_valid(w), "gone a few frames later")
	check(car.distance_travelled == trip and main.checkpoints_passed == cps and car.global_position.distance_to(at) < 0.01, "trip, checkpoints and the car untouched (trip %+.3f m, moved %.3f m)" % [car.distance_travelled - trip, car.global_position.distance_to(at)])
	check(main.map.render_count == renders, "and the map wasn't redrawn")
	check(main.ghosts.count() == 0, "no ghost left behind")
	# Eye level: fog is another variant, and the eye forest has its own.
	main.set_camera_mode(FollowCamera.Mode.CHASE)
	w = main.get_node_or_null("Warmup") as Warmup
	var eye_mats := {}
	if w:
		for n2 in w.find_children("*", "GeometryInstance3D", true, false):
			for m in _materials(n2 as GeometryInstance3D):
				eye_mats[m] = true
	var eye_ok := w != null and main.eye_forest != null
	if eye_ok:
		for n2 in main.eye_forest.find_children("*", "GeometryInstance3D", true, false):
			for m in _materials(n2 as GeometryInstance3D):
				eye_ok = eye_ok and eye_mats.has(m)
	check(eye_ok, "into chase: warmed again, the eye-level forest and far landmarks too")
	check(w != null and _largest(w) < 0.005, "still under 5 mm from the chase camera (%.4f m)" % (_largest(w) if w else -1.0))
	# One warm-up per session, even when the session also moves the camera.
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	var before: int = main.warm_count
	main._on_session({"camera": "chase"}, "")
	check(main.warm_count == before + 1, "a session that switches to chase warms up once (%d)" % (main.warm_count - before))
	before = main.warm_count
	main._on_session({"camera": "topdown"}, "")
	check(main.warm_count == before + 1, "and so does one switching back (%d)" % (main.warm_count - before))
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	for i in 4:
		await t.process_frame
	main._on_race_event({"kind": "go"})


## The materials a draw uses: its override, or its mesh's (or its surface
## overrides).
func _materials(gi: GeometryInstance3D) -> Array:
	var out := []
	if gi.material_override:
		return [gi.material_override]
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


## The longest side of the biggest copy, in world metres.
func _largest(w: Node) -> float:
	var out := 0.0
	for n in w.find_children("*", "GeometryInstance3D", true, false):
		var gi := n as GeometryInstance3D
		out = maxf(out, (gi.global_transform * gi.get_aabb()).get_longest_axis_size())
	return out
