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
	test_pads()
	test_trail_ends()
	test_pad_walkable()
	test_pad_chunk_flat()
	test_trails()
	test_trail_colour()
	test_wreck_by_the_sea()
	test_height_cost()


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


# --- pads and trails (M2) -----------------------------------------------------

## The same layout with no pieces: the ground a pad blends back into.
func _plain(l: Dictionary) -> TerrainField:
	var bare := l.duplicate()
	bare.pieces = []
	return TerrainField.from_layout(bare)


## Inside some other piece's pad or blend ring, where its own rule wins.
func _near_other(l: Dictionary, x: float, z: float, skip: int) -> bool:
	var ps: Array = l.pieces
	for k in ps.size():
		if k != skip and Vector2(x - ps[k].x, z - ps[k].z).length() < float(ps[k].padR) + TerrainField.MAX_BLEND + 0.01:
			return true
	return false


## Fixtures 1–5 and the 40 extra maps.
func _all_layouts() -> Array:
	var out := []
	for n in range(1, t.FIXTURES + 1):
		out.append(t.layout(n))
	var extra: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/extra_layouts.json"))
	if extra is Dictionary:
		out.append_array(extra.layouts)
	return out


## The blend the ruling asks for: wide enough that the step alone peaks
## near 30°, measured against the ground without the pad.
func _want_blend(plain: TerrainField, p: Dictionary) -> float:
	var drop := 0.0
	for a in 16:
		var x: float = p.x + cos(TAU * a / 16.0) * float(p.padR)
		var z: float = p.z + sin(TAU * a / 16.0) * float(p.padR)
		drop = maxf(drop, absf(float(p.padY) - plain.height_at(x, z)))
	return clampf(1.5 * drop / tan(deg_to_rad(30.0)), 10.0, 50.0)


func test_pads() -> void:
	check(TerrainField.MIN_BLEND == 10.0 and TerrainField.MAX_BLEND == 50.0, "pad blends run 10–50 m")
	var ls := _all_layouts()
	check(ls.size() == t.FIXTURES + 40, "45 layouts to check (%d)" % ls.size())
	var pads := 0
	var centre := true
	var inside := true
	var edge := true
	var blended := true
	var widths := true
	var apart := true
	var wide := 0
	var widened := 0
	for n in ls.size():
		var l: Dictionary = ls[n]
		var f := TerrainField.from_layout(l)
		var plain := _plain(l)
		var ps: Array = l.pieces
		for k in ps.size():
			var p: Dictionary = ps[k]
			var r := float(p.padR)
			var blend := f.pad_blend(k)
			pads += 1
			if blend > 10.0:
				wide += 1
			if blend > _want_blend(plain, p) + 1e-6:
				widened += 1
			if blend < _want_blend(plain, p) - 1e-6 or blend > TerrainField.MAX_BLEND:
				widths = false
				print("    layout %d %s blend %.2f, want %.2f" % [n, p.id, blend, _want_blend(plain, p)])
			for q in range(k + 1, ps.size()):
				var gap := Vector2(p.x - ps[q].x, p.z - ps[q].z).length()
				if gap < r + blend + float(ps[q].padR) + f.pad_blend(q):
					apart = false
			if absf(f.height_at(p.x, p.z) - p.padY) > 0.01:
				centre = false
				print("    layout %d %s centre: %.3f vs padY %.1f" % [n, p.id, f.height_at(p.x, p.z), p.padY])
			for a in 16:
				var dir := Vector2(cos(TAU * a / 16.0), sin(TAU * a / 16.0))
				var c := Vector2(p.x, p.z) + dir * (r - 0.05)
				inside = inside and absf(f.height_at(c.x, c.y) - p.padY) <= 0.01
				var e := Vector2(p.x, p.z) + dir * (r + blend)
				if absf(f.height_at(e.x, e.y) - plain.height_at(e.x, e.y)) > 0.01:
					edge = false
					print("    layout %d %s edge %d: %.3f vs plain %.3f" % [n, p.id, a, f.height_at(e.x, e.y), plain.height_at(e.x, e.y)])
				# Through the ring it's the plain ground plus the pad's step at
				# the edge, eased out: half of it at a quarter of the way out.
				var step: float = float(p.padY) - plain.height_at(p.x + dir.x * r, p.z + dir.y * r)
				var m := Vector2(p.x, p.z) + dir * (r + blend * 0.25)
				var want := plain.height_at(m.x, m.y) + step * (1.0 - smoothstep(0.0, 1.0, 0.25))
				if absf(f.height_at(m.x, m.y) - want) > 0.01:
					blended = false
					print("    layout %d %s ring %d: %.3f vs %.3f" % [n, p.id, a, f.height_at(m.x, m.y), want])
	check(pads > 0 and centre, "height_at at each piece's centre is its padY (%d pieces)" % pads)
	check(inside, "height_at is padY all the way to padR")
	check(widths, "each pad's blend is at least clamp(1.5 drop / tan 30°, 10, 50), at most 50 (%d wider than 10 m, %d widened past that for the hill)" % [wide, widened])
	check(apart, "no two pads' blend rings overlap")
	check(edge, "at padR + blend the ground is the plain field again")
	check(blended, "in the ring the ground is the plain field plus the edge step, eased out")


## The along-track slope from a to b, degrees, at a.
func _along(f: TerrainField, a: Vector2, u: Vector2) -> float:
	var g := (f.height_at(a.x + u.x * 0.5, a.y + u.y * 0.5) - f.height_at(a.x - u.x * 0.5, a.y - u.y * 0.5))
	return rad_to_deg(atan(absf(g)))


## Every trail that ends at a pad: over its last 20 m, and straight on in to
## the pad edge, it's no steeper than the buggy climbs (35°), except where
## the plain ground there is steeper than 30° already.
func test_trail_ends() -> void:
	var ends := 0
	var bad := 0
	var worst := 0.0
	for l: Dictionary in _all_layouts():
		var f := TerrainField.from_layout(l)
		var plain := _plain(l)
		for tr: Dictionary in l.trails:
			var pts: Array = tr.pts
			for e in [[0, 1], [pts.size() - 1, -1]]:
				var end := Vector2(pts[e[0]][0], pts[e[0]][1])
				for p: Dictionary in l.pieces:
					var c := Vector2(p.x, p.z)
					if end.distance_to(c) > float(p.padR) + 4.0:
						continue
					ends += 1
					var path: Array[Vector2] = []
					# In from the end to the pad edge...
					var u := (c - end).normalized()
					var k := 0.0
					while k < end.distance_to(c) - float(p.padR) + 0.5:
						path.append(end + u * k)
						k += 0.5
					# ...and back along the trail 20 m.
					var j: int = e[0]
					var walked := 0.0
					while walked < 20.0 and j + e[1] >= 0 and j + e[1] < pts.size():
						var a := Vector2(pts[j][0], pts[j][1])
						var b := Vector2(pts[j + e[1]][0], pts[j + e[1]][1])
						var s := 0.0
						while s < a.distance_to(b) and walked + s < 20.0:
							path.append(a + (b - a).normalized() * s)
							s += 0.5
						walked += a.distance_to(b)
						j += e[1]
					var steep := 0.0
					for q in range(1, path.size()):
						var dir: Vector2 = (path[q] - path[q - 1]).normalized()
						if _along(plain, path[q], dir) <= 30.0:
							steep = maxf(steep, _along(f, path[q], dir))
					worst = maxf(worst, steep)
					if steep > 35.0:
						bad += 1
	print("  trail ends into pads: %d of %d over 35° (worst %.1f°)" % [bad, ends, worst])
	check(ends > 0 and bad == 0, "trail ends climb at most 35° into their pads where the land allows (%d of %d over)" % [bad, ends])


## Out from each pad's edge to the end of its blend, at least 18 of 72
## directions are walkable (≤ 40° all the way). Where the hills alone
## allow fewer than 21 that far out (a peak with cliffs round it), the pad
## may cost at most 3 of them.
func test_pad_walkable() -> void:
	var low := 72
	var low_at := ""
	var ok_all := true
	for l: Dictionary in _all_layouts():
		var f := TerrainField.from_layout(l)
		var plain: TerrainField = null
		var ps: Array = l.pieces
		for k in ps.size():
			var p: Dictionary = ps[k]
			var stop := float(p.padR) + f.pad_blend(k) + 0.5
			var ok := _walkable(f, p, stop)
			var need := 18
			if ok < 18:
				if plain == null:
					plain = _plain(l)
				var bare := _walkable(plain, p, stop)
				if bare < 21:
					need = bare - 3
				print("    seed %d %s %s: %d walkable, %d with no pad (blend %.1f)" % [l.seed, p.id, p.template, ok, bare, f.pad_blend(k)])
			ok_all = ok_all and ok >= need
			if ok < low:
				low = ok
				low_at = "seed %d %s %s" % [l.seed, p.id, p.template]
	print("  fewest walkable directions off a pad: %d of 72 (%s)" % [low, low_at])
	check(ok_all, "every pad has at least 18 of 72 walkable ways off it, or nearly what its hills allow (fewest %d, %s)" % [low, low_at])


func _walkable(f: TerrainField, p: Dictionary, stop: float) -> int:
	var tan40 := tan(deg_to_rad(40.0))
	var r := float(p.padR)
	var ok := 0
	for a in 72:
		var u := Vector2(cos(TAU * a / 72.0), sin(TAU * a / 72.0))
		var prev := f.height_at(p.x + u.x * (r - 0.5), p.z + u.y * (r - 0.5))
		var d := r
		var walk := true
		while d <= stop and walk:
			var h := f.height_at(p.x + u.x * d, p.z + u.y * d)
			walk = absf(h - prev) / 0.5 <= tan40
			prev = h
			d += 0.5
		if walk:
			ok += 1
	return ok


func test_pad_chunk_flat() -> void:
	var p: Dictionary = layout.pieces[0]
	var cx := floori(float(p.x) / TerrainField.CHUNK)
	var cz := floori(float(p.z) / TerrainField.CHUNK)
	var c := _chunk(cx, cz)
	var verts: PackedVector3Array = _arrays(c)[Mesh.ARRAY_VERTEX]
	var lo := INF
	var hi := -INF
	var n := 0
	for v in verts:
		var w := v + c.position
		if Vector2(w.x - p.x, w.z - p.z).length() < float(p.padR):
			lo = minf(lo, v.y)
			hi = maxf(hi, v.y)
			n += 1
	check(n > 10 and hi - lo < 0.05, "a chunk over %s has a flat floor on its pad (%d vertices, %.3f m spread)" % [p.id, n, hi - lo])
	c.free()


func test_trails() -> void:
	check(TerrainField.TRAIL_HALF_WIDTH == 2.0, "TRAIL_HALF_WIDTH mirrors trails.ts")
	var pts := 0
	var flat := true
	var mids := true
	for n in range(1, t.FIXTURES + 1):
		var l: Dictionary = t.layout(n)
		var f := TerrainField.from_layout(l)
		for tr: Dictionary in l.trails:
			var ps: Array = tr.pts
			for i in ps.size():
				var x: float = ps[i][0]
				var z: float = ps[i][1]
				if _near_other(l, x, z, -1):
					continue
				pts += 1
				if absf(f.height_at(x, z) - f.macro_height(x, z)) > 0.01:
					flat = false
					print("    layout %d trail point (%.1f, %.1f): %.3f vs macro %.3f" % [n, x, z, f.height_at(x, z), f.macro_height(x, z)])
				if i > 0:
					var mx: float = (x + ps[i - 1][0]) * 0.5
					var mz: float = (z + ps[i - 1][1]) * 0.5
					if not _near_other(l, mx, mz, -1):
						mids = mids and absf(f.height_at(mx, mz) - f.macro_height(mx, mz)) <= 0.01
	check(pts > 0 and flat, "on a trail point the detail is 0: height_at = macro_height (%d points)" % pts)
	check(mids, "and halfway between trail points too")
	# Far from every trail and pad, the detail is still there.
	var f1 := TerrainField.from_layout(layout)
	var diff := 0.0
	for k in 200:
		var x := -700.0 + k * 7.1
		var z := 333.0 - k * 3.3
		if f1.trail_distance(x, z) > 10.0 and not _near_other(layout, x, z, -1):
			diff = maxf(diff, absf(f1.height_at(x, z) - f1.macro_height(x, z)))
	check(diff > 0.3, "away from trails the detail stays (max %.2f m)" % diff)


func test_trail_colour() -> void:
	var dirt := Color("#8a6a48")
	var f := TerrainField.from_layout(layout)
	var on := true
	var off := true
	var n := 0
	for tr: Dictionary in layout.trails:
		for pt: Array in tr.pts:
			var x: float = pt[0]
			var z: float = pt[1]
			var c := f.color_at(x, z, f.height_at(x, z))
			on = on and c.is_equal_approx(dirt)
			n += 1
	check(n > 0 and on, "the ground on a trail is dirt brown (%d points)" % n)
	for k in 300:
		var x := -700.0 + k * 4.7
		var z := -500.0 + k * 3.1
		if f.trail_distance(x, z) > TerrainField.TRAIL_HALF_WIDTH + 1.0:
			off = off and not f.color_at(x, z, f.height_at(x, z)).is_equal_approx(dirt)
	check(off, "more than 1 m past the trail's edge, it isn't")
	var tp: Array = layout.trails[0].pts[1]
	var a := Vector2(tp[0], tp[1])
	var b := Vector2(layout.trails[0].pts[2][0], layout.trails[0].pts[2][1])
	var side := (b - a).normalized().orthogonal()
	var q := a + side * (TerrainField.TRAIL_HALF_WIDTH + 0.5)
	var mixed := f.color_at(q.x, q.y, f.height_at(q.x, q.y))
	check(not mixed.is_equal_approx(dirt), "half a metre past the edge it is blending out")


## Layout 4 has a wreck low by the sea. Its pad is land; the sand rule and
## the sea rule still hold around it.
func test_wreck_by_the_sea() -> void:
	var l: Dictionary = t.layout(4)
	var f := TerrainField.from_layout(l)
	var wreck: Dictionary = {}
	for p: Dictionary in l.pieces:
		if p.template == "shipwreck":
			wreck = p
	check(not wreck.is_empty(), "layout 4 has a shipwreck")
	if wreck.is_empty():
		return
	check(absf(f.height_at(wreck.x, wreck.z) - wreck.padY) < 0.01, "the wreck stands on its pad (%.1f m)" % wreck.padY)
	var sand := true
	var wet := 0
	for a in 32:
		for d in [0.0, 5.0, 10.0, 15.0, 20.0, 30.0, 45.0, 60.0]:
			var x: float = wreck.x + cos(TAU * a / 32.0) * d
			var z: float = wreck.z + sin(TAU * a / 32.0) * d
			var h := f.height_at(x, z)
			if h < TerrainField.SAND_BELOW and f.trail_distance(x, z) > TerrainField.TRAIL_HALF_WIDTH + 1.0:
				sand = sand and f.color_at(x, z, h) == TerrainField.SAND
			if h < TerrainField.SEA_LEVEL - 1.0:
				wet += 1
	check(sand, "low ground around the wreck is still sand")
	check(wet > 0, "deep water is still near the wreck, so the sea rule has a shore (%d samples)" % wet)


## Every lookup goes through height_at: per call, over a spread of points.
func test_height_cost() -> void:
	var f := TerrainField.from_layout(layout)
	var n := 100000
	var t0 := Time.get_ticks_usec()
	var acc := 0.0
	for k in n:
		acc += f.height_at(-740.0 + float(k % 500) * 2.96, -740.0 + float(k / 500) * 7.4)
	var us := float(Time.get_ticks_usec() - t0) / n
	print("  height_at: %.3f us per call (%d calls)" % [us, n])
	check(is_finite(acc) and us < 20.0, "height_at stays cheap (%.3f us a call)" % us)
