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
##
## Each cell is two triangles, split a-e (corner (ix, iz) to (ix+1, iz+1))
## unless `flips` says b-c. A wall that runs across the grid on the other
## diagonal comes out as a saw of alternating triangles with one split, and
## as a straight edge with the other, so a stage with walls (Dust Devil) has
## the builder pick, per cell, the diagonal whose ends are nearer in height.

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
## One bit per cell, row-major ((w - 1) x (d - 1), x fastest): set = split
## b-c. Empty = every cell a-e, and the collider is a HeightMapShape3D. With
## flips the collider is the same triangles as a trimesh instead, since a
## heightmap shape only splits one way and the car must meet the ground it
## sees.
@export var flips := PackedByteArray()

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


## Cell (ix, iz) split b-c rather than a-e.
func flipped(ix: int, iz: int) -> bool:
	if flips.is_empty():
		return false
	var k := clampi(iz, 0, d - 2) * (w - 1) + clampi(ix, 0, w - 2)
	return (flips[k >> 3] >> (k & 7)) & 1 == 1


## Ground height at world (x, z). Same diagonal split as the mesh, so a
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
	if flipped(ix, iz):
		if u + v <= 1.0:
			return a + (b - a) * u + (c - a) * v
		return e + (c - e) * (1.0 - u) + (b - e) * (1.0 - v)
	if u >= v:
		return a + (b - a) * u + (e - b) * v
	return a + (e - c) * u + (c - a) * v


func normal_at(x: float, z: float) -> Vector3:
	var s := cell * 0.5
	return Vector3(height_at(x - s, z) - height_at(x + s, z), 2.0 * s, height_at(x, z - s) - height_at(x, z + s)).normalized()


func _build_collider() -> void:
	if not flips.is_empty():
		_build_trimesh()
		return
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


## The ground's own triangles as one trimesh: what the collider is when
## some cells split the other way.
func _build_trimesh() -> void:
	var faces := PackedVector3Array()
	faces.resize((w - 1) * (d - 1) * 6)
	var o := 0
	for iz in d - 1:
		for ix in w - 1:
			var a := Vector3(origin.x + ix * cell, h(ix, iz), origin.y + iz * cell)
			var b := Vector3(a.x + cell, h(ix + 1, iz), a.z)
			var c := Vector3(a.x, h(ix, iz + 1), a.z + cell)
			var e := Vector3(a.x + cell, h(ix + 1, iz + 1), a.z + cell)
			faces[o] = a
			faces[o + 1] = b
			if flipped(ix, iz):
				faces[o + 2] = c
				faces[o + 3] = b
			else:
				faces[o + 2] = e
				faces[o + 3] = a
			faces[o + 4] = e
			faces[o + 5] = c
			o += 6
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	shape.backface_collision = true
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	cs.shape = shape
	add_child(cs)


## Sets the flips: per cell, the diagonal whose two corners are nearer in
## height (the other one only where it's clearly better, so flat ground
## keeps the default). Builders call it after the heights are in.
func pick_flips() -> int:
	var cells := (w - 1) * (d - 1)
	flips = PackedByteArray()
	flips.resize((cells + 7) >> 3)
	var n := 0
	for iz in d - 1:
		for ix in w - 1:
			if absf(h(ix + 1, iz) - h(ix, iz + 1)) + 0.05 < absf(h(ix, iz) - h(ix + 1, iz + 1)):
				var k := iz * (w - 1) + ix
				flips[k >> 3] |= 1 << (k & 7)
				n += 1
	return n


func _build_mesh() -> void:
	var mat := ShaderMaterial.new()
	mat.shader = GROUND_SHADER
	mat.set_shader_parameter("detail", DetailNoise.texture())
	material = mat
	# Whatever the track tool hung under the ground to stand in for more of
	# it (the map's backdrop past the grid) wears the same material, so it
	# carries on with the same grain and biome colours.
	for c in get_children():
		if c is GeometryInstance3D:
			(c as GeometryInstance3D).material_override = mat
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
			# Counter-clockwise seen from above; split as height_at assumes.
			if flipped(x0 + c, z0 + r):
				idx.append_array([a, b, cc, b, e, cc])
			else:
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
