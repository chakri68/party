extends RefCounted
## The field, one chunk, the far mesh and the walls (scripts/world/*). Run
## from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
var layout: Dictionary
var field: TerrainField


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("terrain")
	layout = t.layout(1)
	field = TerrainField.from_layout(layout)
	test_field_basics()
	test_macro_vertices()
	test_macro_cell_centre()
	test_macro_off_centre()
	test_macro_clamps()
	test_detail_flat_beaches()
	test_chunk_collider_heights()
	await test_chunk_raycast()
	test_chunk_seams()
	test_chunk_mesh()
	test_far_below()
	test_mountain_sides()
	await test_walls()
	test_water()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _h(i: int, j: int) -> float:
	var m: Dictionary = layout.macro
	return float(m.heights[j * int(m.size) + i])


func _vx(i: int) -> float:
	return TerrainField.MACRO_ORIGIN + i * TerrainField.MACRO_CELL


func test_field_basics() -> void:
	check(field.seed == int(layout.seed), "field keeps the seed")
	check(field.ring == layout.ring, "field keeps the ring")
	var s: Dictionary = layout.spawn
	check(is_equal_approx(field.spawn.x, s.x) and is_equal_approx(field.spawn.z, s.z), "spawn x, z from the layout")
	check(absf(field.spawn.y - field.height_at(s.x, s.z)) < 1e-6, "spawn y is height_at")
	check(is_equal_approx(field.spawn_yaw, s.yaw), "spawn yaw from the layout")
	check(TerrainField.PLAY_HALF == 750 and TerrainField.WORLD_HALF == 950 and TerrainField.WALL_HALF == 770, "world constants mirror world.ts")
	check(TerrainField.MACRO_CELL == 32 and TerrainField.MACRO_ORIGIN == -960 and TerrainField.MACRO_SIZE == 61, "macro constants mirror world.ts")
	check(TerrainField.BIOMES == ["meadow", "forest", "rocky", "wetland", "snowcap"], "biome order mirrors world.ts")


func test_macro_vertices() -> void:
	var ok := true
	for p in [[0, 0], [60, 0], [0, 60], [60, 60], [30, 30], [7, 41], [52, 13], [59, 59]]:
		var got := field.macro_height(_vx(p[0]), _vx(p[1]))
		if absf(got - _h(p[0], p[1]) / 10.0) > 1e-9:
			ok = false
			print("    vertex %s: %f vs %f" % [p, got, _h(p[0], p[1]) / 10.0])
	check(ok, "macro_height at grid vertices = heights[i] / 10")


func test_macro_cell_centre() -> void:
	var ok := true
	for p in [[10, 10], [29, 33], [45, 3], [0, 59]]:
		var i: int = p[0]
		var j: int = p[1]
		var want := (_h(i, j) + _h(i + 1, j) + _h(i, j + 1) + _h(i + 1, j + 1)) / 4.0 / 10.0
		var got := field.macro_height(_vx(i) + 16.0, _vx(j) + 16.0)
		ok = ok and absf(got - want) < 1e-9
	check(ok, "macro_height at a cell centre = mean of its corners / 10")


func test_macro_off_centre() -> void:
	# Bilinear, not a triangle split: (0.25, 0.75) into the cell by hand.
	var ok := true
	for p in [[12, 20], [40, 41], [3, 57]]:
		var i: int = p[0]
		var j: int = p[1]
		var tx := 0.25
		var tz := 0.75
		var a := _h(i, j) * (1 - tx) + _h(i + 1, j) * tx
		var b := _h(i, j + 1) * (1 - tx) + _h(i + 1, j + 1) * tx
		var want := (a * (1 - tz) + b * tz) / 10.0
		var got := field.macro_height(_vx(i) + 8.0, _vx(j) + 24.0)
		ok = ok and absf(got - want) < 1e-9
	check(ok, "macro_height off-centre (0.25, 0.75) is bilinear")


func test_macro_clamps() -> void:
	check(absf(field.macro_height(-5000, -5000) - _h(0, 0) / 10.0) < 1e-9, "macro_height clamps past the low corner")
	check(absf(field.macro_height(5000, 5000) - _h(60, 60) / 10.0) < 1e-9, "macro_height clamps past the high corner")
	check(absf(field.macro_height(5000, _vx(20)) - _h(60, 20) / 10.0) < 1e-9, "macro_height clamps past an edge")


func test_detail_flat_beaches() -> void:
	# Below 1 m of macro height the detail is gone: beaches stay flat.
	var found := 0
	var ok := true
	for j in 61:
		for i in 61:
			var x := _vx(i) + 5.0
			var z := _vx(j) + 3.0
			var m := field.macro_height(x, z)
			if m < 1.0:
				found += 1
				ok = ok and field.height_at(x, z) == m
	check(found > 0 and ok, "no detail where macro height < 1 m (%d points)" % found)
	var diff := 0.0
	for k in 50:
		var x := -300.0 + k * 13.7
		diff = maxf(diff, absf(field.height_at(x, 40.0) - field.macro_height(x, 40.0)))
	check(diff > 0.3 and diff <= TerrainField.DETAIL_AMP + 1e-6, "detail adds up to DETAIL_AMP on land (max %.2f m)" % diff)


func _chunk(cx: int, cz: int) -> TerrainChunk:
	return TerrainChunk.build(field, cx, cz, t.ground_material())


func _shape(c: TerrainChunk) -> CollisionShape3D:
	for n in c.get_children():
		if n is CollisionShape3D:
			return n
	return null


func test_chunk_collider_heights() -> void:
	var cx := 2
	var cz := -3
	var c := _chunk(cx, cz)
	check(c.position == Vector3(cx * 64, 0, cz * 64), "chunk sits at its corner")
	var cs := _shape(c)
	var hm := cs.shape as HeightMapShape3D if cs else null
	check(hm != null and hm.map_width == 33 and hm.map_depth == 33, "collider is a 33 x 33 HeightMapShape3D")
	if hm == null:
		c.free()
		return
	check(cs.scale == Vector3(2, 2, 2), "collider is scaled 2 uniformly")
	var ok := true
	for p in [[0, 0], [32, 0], [0, 32], [32, 32], [17, 9]]:
		var x: float = cx * 64.0 + p[0] * 2.0
		var z: float = cz * 64.0 + p[1] * 2.0
		var got: float = hm.map_data[p[1] * 33 + p[0]] * cs.scale.y
		if absf(got - field.height_at(x, z)) > 0.01:
			ok = false
			print("    (%d, %d): %f vs %f" % [p[0], p[1], got, field.height_at(x, z)])
	check(ok, "collider heights = height_at at 5 vertices (1 cm)")
	c.free()


func test_chunk_raycast() -> void:
	# The scaled-heightmap trick, end to end: a ray from above lands on height_at.
	var c := _chunk(0, 5)
	t.root.add_child(c)
	await t.physics_frame
	await t.physics_frame
	var space := c.get_world_3d().direct_space_state
	var ok := true
	for p in [[4.0, 4.0], [34.0, 50.0], [62.0, 10.0]]:
		var x: float = p[0]
		var z: float = 5 * 64.0 + p[1]
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x, 1000, z), Vector3(x, -1000, z)))
		var want := field.height_at(x, z)
		# Between vertices the collider is a triangle: compare at vertices only.
		if hit.is_empty() or absf(hit.position.y - want) > 0.01:
			ok = false
			print("    ray (%f, %f): %s vs %f" % [x, z, hit.get("position"), want])
	check(ok, "a ray down hits the collider at height_at")
	c.queue_free()


func test_chunk_seams() -> void:
	var a := _chunk(-1, 0)
	var b := _chunk(0, 0)
	var d := _chunk(-1, 1)
	var ha := (_shape(a).shape as HeightMapShape3D).map_data
	var hb := (_shape(b).shape as HeightMapShape3D).map_data
	var hd := (_shape(d).shape as HeightMapShape3D).map_data
	var ok := true
	for k in 33:
		ok = ok and ha[k * 33 + 32] == hb[k * 33] # a's east edge, b's west edge
		ok = ok and ha[32 * 33 + k] == hd[k] # a's south edge, d's north edge
	check(ok, "neighbouring chunks share edge heights exactly")
	var ma := _arrays(a)
	var mb := _arrays(b)
	var nok := true
	var vok := true
	for k in 33:
		var ia := k * 33 + 32
		var ib := k * 33
		nok = nok and ma[Mesh.ARRAY_NORMAL][ia] == mb[Mesh.ARRAY_NORMAL][ib]
		vok = vok and (ma[Mesh.ARRAY_VERTEX][ia] + a.position) == (mb[Mesh.ARRAY_VERTEX][ib] + b.position)
	check(vok, "neighbouring meshes share edge vertices exactly")
	check(nok, "neighbouring meshes share edge normals exactly")
	a.free()
	b.free()
	d.free()


func _arrays(c: TerrainChunk) -> Array:
	for n in c.get_children():
		if n is MeshInstance3D:
			return (n.mesh as ArrayMesh).surface_get_arrays(0)
	return []


func test_chunk_mesh() -> void:
	var c := _chunk(3, 3)
	var arr := _arrays(c)
	check(arr.size() == Mesh.ARRAY_MAX and arr[Mesh.ARRAY_VERTEX].size() == 33 * 33, "mesh has 33 x 33 vertices")
	if arr.is_empty():
		c.free()
		return
	check(arr[Mesh.ARRAY_INDEX].size() == 32 * 32 * 6, "mesh has two triangles per cell")
	check(arr[Mesh.ARRAY_COLOR].size() == 33 * 33, "mesh has vertex colours")
	var n: Vector3 = arr[Mesh.ARRAY_NORMAL][17 * 33 + 5]
	# Godot stores normals octahedral-compressed, so not bit-exact here.
	check(n.dot(field.normal_at(3 * 64 + 10.0, 3 * 64 + 34.0)) > 0.9999, "mesh normals come from normal_at")
	var v: Vector3 = arr[Mesh.ARRAY_VERTEX][0]
	var v1: Vector3 = arr[Mesh.ARRAY_VERTEX][1]
	var v33: Vector3 = arr[Mesh.ARRAY_VERTEX][33]
	# Face normal of the first triangle (a, b, e) as wound: up means front faces up.
	var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var p0: Vector3 = arr[Mesh.ARRAY_VERTEX][idx[0]]
	var p1: Vector3 = arr[Mesh.ARRAY_VERTEX][idx[1]]
	var p2: Vector3 = arr[Mesh.ARRAY_VERTEX][idx[2]]
	check((p2 - p0).cross(p1 - p0).y > 0, "triangles wind as Blind Rally's do (front face up)")
	check(v1.x - v.x == 2.0 and v33.z - v.z == 2.0, "vertices are 2 m apart, x fastest")
	c.free()


func test_far_below() -> void:
	var far := FarTerrain.new()
	far.build(field, t.ground_material())
	var mesh := far.mesh as ArrayMesh
	check(mesh != null, "far mesh is built")
	if mesh == null:
		far.free()
		return
	var arr := mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	check(verts.size() == 61 * 61, "far mesh is the 61 x 61 macro grid")
	check(far.get_child_count() == 0, "far mesh has no collider")
	# Sample the mesh's own triangles at random points: the far surface must
	# stay under height_at everywhere, not only at its vertices.
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var worst := -INF
	var bad := 0
	for k in 200:
		var x := rng.randf_range(-959.0, 959.0)
		var z := rng.randf_range(-959.0, 959.0)
		var fy := _far_y(verts, idx, x, z)
		var gap := fy - field.height_at(x, z)
		worst = maxf(worst, gap)
		if gap >= 0.0:
			bad += 1
	check(bad == 0, "far mesh is below height_at at 200 random points (closest %.2f m)" % worst)
	far.free()


## The far mesh's height at (x, z): find the cell and test both its triangles.
func _far_y(verts: PackedVector3Array, idx: PackedInt32Array, x: float, z: float) -> float:
	var i := clampi(int(floor((x + 960.0) / 32.0)), 0, 59)
	var j := clampi(int(floor((z + 960.0) / 32.0)), 0, 59)
	var base := (j * 60 + i) * 6
	for tri in 2:
		var a := verts[idx[base + tri * 3]]
		var b := verts[idx[base + tri * 3 + 1]]
		var c := verts[idx[base + tri * 3 + 2]]
		var w := _bary(Vector2(a.x, a.z), Vector2(b.x, b.z), Vector2(c.x, c.z), Vector2(x, z))
		if w.x >= -1e-6 and w.y >= -1e-6 and w.z >= -1e-6:
			return a.y * w.x + b.y * w.y + c.y * w.z
	return INF


func _bary(a: Vector2, b: Vector2, c: Vector2, p: Vector2) -> Vector3:
	var v0 := b - a
	var v1 := c - a
	var v2 := p - a
	var den := v0.x * v1.y - v1.x * v0.y
	var v := (v2.x * v1.y - v1.x * v2.y) / den
	var w := (v0.x * v2.y - v2.x * v0.y) / den
	return Vector3(1.0 - v - w, v, w)


## Each mountain side climbs: 96 m into the ring is at least 75 m above the
## playable edge. Corners are left out: the generator only promises this
## away from them.
func test_mountain_sides() -> void:
	var sides := 0
	var ok := true
	for n in range(1, t.FIXTURES + 1):
		var l: Dictionary = t.layout(n)
		var f := TerrainField.from_layout(l)
		for s in 4:
			if l.ring[s] != "mountain":
				continue
			sides += 1
			var tt := -600.0
			while tt <= 600.0:
				var edge := f.height_at(_on_side(s, tt, 0.0).x, _on_side(s, tt, 0.0).y)
				var p := _on_side(s, tt, -96.0)
				var out := f.height_at(p.x, p.y)
				if out < edge + 75.0:
					ok = false
					print("    layout %d side %d at %.0f: %.1f vs edge %.1f" % [n, s, tt, out, edge])
				tt += 50.0
	check(sides > 0 and ok, "mountain sides rise 75 m within 96 m of the edge (%d sides)" % sides)


## A point on side `s` at `tt` along it, `d` metres inside (onSide in generate.ts).
func _on_side(s: int, tt: float, d: float) -> Vector2:
	var e := TerrainField.PLAY_HALF - d
	match s:
		0: return Vector2(tt, -e)
		1: return Vector2(e, tt)
		2: return Vector2(tt, e)
		_: return Vector2(-e, tt)


func test_walls() -> void:
	var b := Bounds.new()
	t.root.add_child(b)
	var walls: Array[CollisionShape3D] = []
	var meshes := 0
	for n in b.get_children():
		if n is CollisionShape3D and n.shape is BoxShape3D:
			walls.append(n)
		if n is VisualInstance3D:
			meshes += 1
	check(meshes == 0, "walls have no mesh")
	check(walls.size() == 4, "four walls")
	check(b.collision_layer == 1, "walls are on physics layer 1")
	var faces := []
	for w in walls:
		var size := (w.shape as BoxShape3D).size
		var p := w.position
		if size.x < size.z: # an east/west wall
			faces.append(p.x - signf(p.x) * size.x / 2.0)
			check(size.x == 10.0 and size.y == 400.0 and size.z >= 2 * TerrainField.WALL_HALF, "east/west wall is 10 m thick, 400 m tall and spans the side")
		else:
			faces.append(p.z - signf(p.z) * size.z / 2.0)
			check(size.z == 10.0 and size.y == 400.0 and size.x >= 2 * TerrainField.WALL_HALF, "north/south wall is 10 m thick, 400 m tall and spans the side")
	faces.sort()
	check(faces == [-770.0, -770.0, 770.0, 770.0], "inner wall faces are at ±770")
	# And they stop things: a ray along the ground from the centre hits one at 770.
	await t.physics_frame
	await t.physics_frame
	var space := b.get_world_3d().direct_space_state
	var y := field.height_at(700, 0) + 2.0
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(700, y, 0), Vector3(900, y, 0)))
	check(not hit.is_empty() and is_equal_approx(hit.position.x, 770.0), "a ray east hits the wall at x = 770")
	b.queue_free()


func test_water() -> void:
	var w := Water.new()
	w.build()
	check(w.position.y == 0.0 and w.mesh is PlaneMesh and (w.mesh as PlaneMesh).size == Vector2(2400, 2400), "water is a 2400 m plane at y = 0")
	check(w.get_child_count() == 0, "water has no collider")
	var m := w.material_override as StandardMaterial3D
	check(m != null and m.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED and m.albedo_color.b > m.albedo_color.r, "water is blue and see-through")
	w.free()
