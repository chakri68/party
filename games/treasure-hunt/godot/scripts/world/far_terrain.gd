class_name FarTerrain
extends MeshInstance3D
## The whole world at macro resolution (32 m), so the horizon never ends in
## empty space. Sits under the near chunks: each vertex is height_at minus
## twice the detail amplitude, and each cell is split along the diagonal
## that keeps both triangles under the bilinear macro surface. No collider.

const N := TerrainField.MACRO_SIZE


func build(field: TerrainField, mat: Material) -> void:
	name = "FarTerrain"
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var cell := float(TerrainField.MACRO_CELL)
	var o0 := float(TerrainField.MACRO_ORIGIN)
	var drop := 2.0 * TerrainField.DETAIL_AMP
	var hs := PackedFloat64Array()
	hs.resize(N * N)
	for j in N:
		for i in N:
			hs[j * N + i] = field.height_at(o0 + i * cell, o0 + j * cell) - drop

	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	verts.resize(N * N)
	norms.resize(N * N)
	cols.resize(N * N)
	for j in N:
		for i in N:
			var k := j * N + i
			var x := o0 + i * cell
			var z := o0 + j * cell
			verts[k] = Vector3(x, hs[k], z)
			var l := hs[j * N + maxi(i - 1, 0)]
			var r := hs[j * N + mini(i + 1, N - 1)]
			var b := hs[maxi(j - 1, 0) * N + i]
			var f := hs[mini(j + 1, N - 1) * N + i]
			norms[k] = Vector3(l - r, 2.0 * cell, b - f).normalized()
			cols[k] = field.color_at(x, z, hs[k] + drop)

	# Bilinear f minus the a–e triangles is −twist·(≥0): that split stays
	# under f when twist ≤ 0, the b–cc split when twist ≥ 0.
	var idx := PackedInt32Array()
	idx.resize((N - 1) * (N - 1) * 6)
	var w := 0
	for r in N - 1:
		for q in N - 1:
			var a := r * N + q
			var b := a + 1
			var cc := a + N
			var e := cc + 1
			if field.macro_twist(q, r) <= 0.0:
				idx[w] = a; idx[w + 1] = b; idx[w + 2] = e
				idx[w + 3] = a; idx[w + 4] = e; idx[w + 5] = cc
			else:
				idx[w] = a; idx[w + 1] = b; idx[w + 2] = cc
				idx[w + 3] = b; idx[w + 4] = e; idx[w + 5] = cc
			w += 6

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	m.surface_set_material(0, mat)
	mesh = m
