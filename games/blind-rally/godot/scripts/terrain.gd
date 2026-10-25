class_name Terrain
extends StaticBody3D
## The ground: one height grid that the collider, the visible mesh and every
## placement query read, so the car, the road and the trees can't disagree
## about where the floor is. The track tool bakes the grid (heights in
## centimetres, plus a tint per vertex); _ready() expands it into a
## HeightMapShape3D and a handful of mesh tiles (tiles so the camera can cull
## them; one mesh would push every ground triangle through the GPU each frame).
##
## Grid: (w x d) vertices, `cell` metres apart, vertex (0, 0) at `origin`
## (world XZ), rows run +Z. height_at() interpolates the same triangles the
## mesh draws.

const TILE := 32 ## cells per mesh tile side
const GROUND_SHADER := preload("res://shaders/ground.gdshader")

@export var origin := Vector2.ZERO
@export var cell := 4.0
@export var w := 2
@export var d := 2
## int16 per vertex, centimetres, row-major (x fastest).
@export var heights_cm := PackedByteArray()
## RGBA8 per vertex: rgb = ground tint (sRGB), a = forest-floor amount (0 = verge
## grass or a yard, 1 = deep under the canopy). The shader adds the detail.
@export var tints := PackedByteArray()

var heights := PackedFloat32Array()
var tiles := 0
var material: ShaderMaterial ## shared by every tile; Weather registers it


func _ready() -> void:
	decode()
	_build_collider()
	_build_mesh()


## Unpacks heights_cm. Separate from _ready so the track tool can sample a
## Terrain that never enters the tree.
func decode() -> void:
	heights.resize(w * d)
	for i in w * d:
		heights[i] = heights_cm.decode_s16(i * 2) * 0.01


func h(ix: int, iz: int) -> float:
	return heights[clampi(iz, 0, d - 1) * w + clampi(ix, 0, w - 1)]


## Ground height at world (x, z). Same diagonal split as the mesh (a-d), so a
## point on a triangle gets that triangle's plane, not a bilinear blend.
func height_at(x: float, z: float) -> float:
	var fx := clampf((x - origin.x) / cell, 0.0, w - 1.001)
	var fz := clampf((z - origin.y) / cell, 0.0, d - 1.001)
	var ix := int(fx)
	var iz := int(fz)
	var u := fx - ix
	var v := fz - iz
	var a := h(ix, iz)
	var b := h(ix + 1, iz)
	var c := h(ix, iz + 1)
	var e := h(ix + 1, iz + 1)
	if u >= v:
		return a + (b - a) * u + (e - b) * v
	return a + (e - c) * u + (c - a) * v


func normal_at(x: float, z: float) -> Vector3:
	var s := cell * 0.5
	return Vector3(height_at(x - s, z) - height_at(x + s, z), 2.0 * s, height_at(x, z - s) - height_at(x, z + s)).normalized()


func _build_collider() -> void:
	# HeightMapShape3D spaces samples 1 m apart, centred on the shape. Scale it
	# uniformly by `cell` (Jolt is happy with uniform scale) and divide the
	# heights to match.
	var hm := HeightMapShape3D.new()
	hm.map_width = w
	hm.map_depth = d
	var data := PackedFloat32Array()
	data.resize(w * d)
	for i in w * d:
		data[i] = heights[i] / cell
	hm.map_data = data
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	cs.shape = hm
	cs.scale = Vector3(cell, cell, cell)
	cs.position = Vector3(origin.x + (w - 1) * cell * 0.5, 0, origin.y + (d - 1) * cell * 0.5)
	add_child(cs)


func _build_mesh() -> void:
	var mat := ShaderMaterial.new()
	mat.shader = GROUND_SHADER
	mat.set_shader_parameter("detail", DetailNoise.texture())
	material = mat
	for tz in range(0, d - 1, TILE):
		for tx in range(0, w - 1, TILE):
			var mesh := _tile(tx, tz, mini(tx + TILE, w - 1), mini(tz + TILE, d - 1))
			mesh.surface_set_material(0, mat)
			var mi := MeshInstance3D.new()
			mi.name = "Tile_%d_%d" % [tx / TILE, tz / TILE]
			mi.mesh = mesh
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mi)
			tiles += 1


func _tile(x0: int, z0: int, x1: int, z1: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var cols_n := x1 - x0 + 1
	for iz in range(z0, z1 + 1):
		for ix in range(x0, x1 + 1):
			verts.append(Vector3(origin.x + ix * cell, h(ix, iz), origin.y + iz * cell))
			norms.append(Vector3(h(ix - 1, iz) - h(ix + 1, iz), 2.0 * cell, h(ix, iz - 1) - h(ix, iz + 1)).normalized())
			var o := (iz * w + ix) * 4
			cols.append(Color8(tints[o], tints[o + 1], tints[o + 2], tints[o + 3]))
	for r in z1 - z0:
		for c in x1 - x0:
			var a := r * cols_n + c
			var b := a + 1
			var cc := a + cols_n
			var e := cc + 1
			# Counter-clockwise seen from above; split a-e, as height_at assumes.
			idx.append_array([a, b, e, a, e, cc])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m
