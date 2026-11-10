class_name TerrainChunk
extends StaticBody3D
## One 64 m square of near ground: a 33 × 33 mesh and a heightmap collider,
## both from TerrainField.height_at. Corner at (cx·64, 0, cz·64).

const N := TerrainField.CHUNK_VERTS


static func build(field: TerrainField, cx: int, cz: int, mat: Material) -> TerrainChunk:
	var c := TerrainChunk.new()
	c.name = "Chunk_%d_%d" % [cx, cz]
	c.collision_layer = 1
	c.collision_mask = 0
	var x0 := cx * TerrainField.CHUNK
	var z0 := cz * TerrainField.CHUNK
	c.position = Vector3(x0, 0, z0)
	var cell := TerrainField.CELL

	# Heights with a one-cell border (35 × 35), so normals need no extra
	# lookups and come out the same sum normal_at does. Float64: the
	# neighbour chunk must see bit-identical values.
	const B := N + 2
	var hs := PackedFloat64Array()
	hs.resize(B * B)
	for j in B:
		var z := z0 + (j - 1) * cell
		for i in B:
			hs[j * B + i] = field.height_at(x0 + (i - 1) * cell, z)

	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var data := PackedFloat32Array()
	verts.resize(N * N)
	norms.resize(N * N)
	cols.resize(N * N)
	data.resize(N * N)
	for j in N:
		for i in N:
			var o := (j + 1) * B + i + 1
			var h := hs[o]
			var k := j * N + i
			verts[k] = Vector3(i * cell, h, j * cell)
			norms[k] = TerrainField.normal_from(hs[o - 1], hs[o + 1], hs[o - B], hs[o + B])
			cols[k] = field.color_at(x0 + i * cell, z0 + j * cell, h)
			data[k] = h / cell

	var idx := PackedInt32Array()
	idx.resize((N - 1) * (N - 1) * 6)
	var w := 0
	for r in N - 1:
		for q in N - 1:
			var a := r * N + q
			var b := a + 1
			var cc := a + N
			var e := cc + 1
			# Split a–e, as Blind Rally's unflipped cells. The collider may split the
			# other way; at 2 m cells and ±3 m of detail that is centimetres.
			idx[w] = a; idx[w + 1] = b; idx[w + 2] = e
			idx[w + 3] = a; idx[w + 4] = e; idx[w + 5] = cc
			w += 6

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.mesh = mesh
	c.add_child(mi)

	# HeightMapShape3D spaces samples 1 m apart, centred on the shape. Scale
	# it uniformly by the cell (Jolt is fine with uniform scale) and divide
	# the heights to match: Blind Rally's trick.
	var hm := HeightMapShape3D.new()
	hm.map_width = N
	hm.map_depth = N
	hm.map_data = data
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	cs.shape = hm
	cs.scale = Vector3(cell, cell, cell)
	cs.position = Vector3(TerrainField.CHUNK * 0.5, 0, TerrainField.CHUNK * 0.5)
	c.add_child(cs)
	return c
