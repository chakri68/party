extends RefCounted
## CharacterModel: the eight Kenney Mini Characters, their animations, the
## shirt tint and the pure state rule. Run from run_tests.gd.

var t ## the runner (run_tests.gd)


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("character")
	test_state_for()
	await test_models()
	test_shirt_cell()
	test_colour()
	test_rebuild()
	await test_playback()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func make(id: String, color := Color.RED) -> CharacterModel:
	var m := CharacterModel.new()
	t.root.add_child(m)
	m.setup(id, color)
	return m


func player_of(m: Node) -> AnimationPlayer:
	return m.find_child("AnimationPlayer", true, false)


func height_of(m: Node3D) -> float:
	var lo := INF
	var hi := -INF
	for n in m.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		var box := mi.global_transform * mi.get_aabb()
		lo = minf(lo, box.position.y)
		hi = maxf(hi, box.end.y)
	return hi - lo


func test_state_for() -> void:
	var s := CharacterModel.state_for
	check(s.call(0.0, true, 0.0, &"") == &"idle", "still on the ground: idle")
	check(s.call(2.0, true, 0.0, &"") == &"walk", "2 m/s: walk")
	check(s.call(2.6, true, 0.0, &"") == &"sprint", "2.6 m/s: sprint")
	check(s.call(6.0, true, 0.0, &"") == &"sprint", "6 m/s: sprint")
	check(s.call(3.0, false, 2.0, &"") == &"jump", "in the air going up: jump")
	check(s.call(3.0, false, -2.0, &"") == &"fall", "in the air going down: fall")
	check(s.call(9.0, false, -2.0, &"driver") == &"drive", "driver: drive, whatever the speed or air")
	check(s.call(0.0, true, 0.0, &"passenger") == &"sit", "passenger: sit")


func test_models() -> void:
	check(CharacterModel.IDS.size() == 8, "eight ids")
	var all := true
	var anims := true
	var tall := true
	var loops := true
	for id in CharacterModel.IDS:
		var m := make(id)
		await t.process_frame
		all = all and m.id == id and m.get_child_count() == 1
		var ap := player_of(m)
		if ap == null:
			anims = false
		else:
			for a in ["idle", "walk", "sprint", "jump", "fall", "drive", "sit", "pick-up"]:
				anims = anims and ap.has_animation(a)
			for a in ["idle", "walk", "sprint", "drive", "sit"]:
				loops = loops and ap.get_animation(a).loop_mode == Animation.LOOP_LINEAR
			for a in ["jump", "fall", "pick-up"]:
				loops = loops and ap.get_animation(a).loop_mode == Animation.LOOP_NONE
		var h := height_of(m)
		tall = tall and absf(h - CharacterModel.HEIGHT) <= 0.05
		if absf(h - CharacterModel.HEIGHT) > 0.05:
			print("    ", id, " height ", h)
		m.queue_free()
	check(all, "every id loads, with one model")
	check(anims, "every model has idle, walk, sprint, jump, fall, drive, sit and pick-up")
	check(loops, "idle, walk, sprint, drive and sit loop; jump, fall and pick-up don't")
	check(tall, "every model stands 1.7 m, within 5 cm")


## The cell of a uv on the colormap: 16 columns, 4 rows (each 32 x 128 px).
func cell_of(uv: Vector2) -> Vector2i:
	return Vector2i(floori(uv.x * 16.0), floori(uv.y * 4.0))


func head_cell(m: Node) -> Vector2i:
	var head: MeshInstance3D = m.find_child("head-mesh", true, false)
	var uvs: PackedVector2Array = head.mesh.surface_get_arrays(0)[Mesh.ARRAY_TEX_UV]
	var count := {}
	for uv in uvs:
		var c := cell_of(uv)
		count[c] = count.get(c, 0) + 1
	var best := Vector2i.ZERO
	var most := 0
	for c in count:
		if count[c] > most:
			most = count[c]
			best = c
	return best


func test_shirt_cell() -> void:
	var ok := true
	var votes := true
	var single := true
	for id in CharacterModel.IDS:
		var m := make(id)
		var c := m.shirt_cell
		var body: MeshInstance3D = m.find_child("body-mesh", true, false)
		var sk: Skeleton3D = m.find_child("Skeleton3D", true, false)
		votes = votes and CharacterModel.torso_vertex_count(body.mesh, body.skin, sk) > 0
		single = single and body.mesh.get_surface_count() == 1
		ok = ok and c.x >= 0 and c.x <= 15 and c.y >= 0 and c.y <= 3
		if id == "female-a" or id == "male-a":
			check(c != head_cell(m), "%s: the shirt cell isn't the head's commonest cell" % id)
		m.queue_free()
	check(votes, "every model's shirt vote counts torso vertices (the torso bind is found)")
	# The upper torso, not the belt band at the waist (which has more
	# vertices but sits in the bottom quarter of the torso).
	var want := {"female-a": Vector2i(5, 1), "female-b": Vector2i(1, 3), "female-c": Vector2i(1, 1), "female-d": Vector2i(3, 3), "male-a": Vector2i(9, 2), "male-b": Vector2i(15, 2), "male-c": Vector2i(1, 1), "male-d": Vector2i(7, 3)}
	for id: String in want:
		var m := make(id)
		check(m.shirt_cell == want[id], "%s: the shirt is %s, not the belt (got %s)" % [id, want[id], m.shirt_cell])
		m.queue_free()
	check(single, "every body-mesh has exactly one surface")
	check(ok, "every shirt cell is inside the 16 x 4 grid")


func team_color_of(m: Node) -> Variant:
	var body: MeshInstance3D = m.find_child("body-mesh", true, false)
	var mat := body.get_surface_override_material(0) as ShaderMaterial
	return mat.get_shader_parameter("team_color") if mat else null


func test_colour() -> void:
	var m := make("female-a", Color.BLUE)
	var before := m.get_child(0)
	check(team_color_of(m) == Color.BLUE, "setup sets the shirt colour")
	m.set_color(Color.RED)
	check(team_color_of(m) == Color.RED, "set_color changes the team_color uniform")
	check(m.get_child(0) == before and m.get_child_count() == 1, "set_color doesn't rebuild")
	var head: MeshInstance3D = m.find_child("head-mesh", true, false)
	var head_mat := head.get_surface_override_material(0) as BaseMaterial3D
	check(head_mat != null and head_mat.albedo_texture == CharacterModel.COLORMAP, "the head is untinted, with the colormap set directly")
	var body: MeshInstance3D = m.find_child("body-mesh", true, false)
	var body_mat := body.get_surface_override_material(0) as ShaderMaterial
	check(body_mat.get_shader_parameter("albedo_tex") == CharacterModel.COLORMAP, "the body samples the colormap set directly (the web export drops the GLB's)")
	m.queue_free()


func test_rebuild() -> void:
	var m := make("female-a")
	m.setup("male-b", Color.GREEN)
	check(m.id == "male-b" and m.get_child_count() == 1, "a new id rebuilds into exactly one model")
	check(team_color_of(m) == Color.GREEN, "the rebuilt model has the new colour")
	m.setup("nope", Color.GREEN)
	check(m.id == "female-a" and m.get_child_count() == 1, "an unknown id falls back to female-a")
	m.queue_free()


func test_playback() -> void:
	var m := make("male-a")
	m.play(&"walk")
	for i in 5:
		await t.process_frame
	var ap := player_of(m)
	var p1 := ap.current_animation_position
	m.play(&"walk")
	for i in 5:
		await t.process_frame
	check(ap.current_animation == "walk", "play(walk) puts the player on walk")
	check(ap.current_animation_position > p1, "a repeated play(walk) doesn't restart it")
	m.play(&"jump")
	check(ap.current_animation == "jump", "play(jump) switches")
	m.set_animating(false)
	var p2 := ap.current_animation_position
	for i in 5:
		await t.process_frame
	check(is_equal_approx(ap.current_animation_position, p2), "set_animating(false) freezes it")
	m.set_animating(true)
	for i in 5:
		await t.process_frame
	check(ap.current_animation_position > p2, "set_animating(true) resumes it")
	m.queue_free()
