class_name PieceKit
extends RefCounted
## Builds the set pieces of templates.ts (spec §5): greybox primitives, a few
## Kenney nature-kit meshes, and simple colliders on layer 1. Each template's
## script follows the geometry noted beside it in templates.ts, because that's
## what its cache slots assume. Get it wrong and a cache spawns inside a wall.
##
## Local frame, before yaw: −Z is the front, +X the right, y = 0 the pad.

const BUILDERS := {
	"lighthouse": preload("res://scripts/pieces/lighthouse.gd"),
	"shipwreck": preload("res://scripts/pieces/shipwreck.gd"),
	"stone-circle": preload("res://scripts/pieces/stone_circle.gd"),
	"radio-tower": preload("res://scripts/pieces/radio_tower.gd"),
	"camp": preload("res://scripts/pieces/camp.gd"),
	"plane": preload("res://scripts/pieces/plane.gd"),
}

## TEMPLATES[t].labels, mirrored. piece_tests checks it against pieces.json.
const LABELS := {
	"lighthouse": ["red", "white", "blue"],
	"shipwreck": ["blue", "green", "black"],
	"stone-circle": ["grey", "dark", "sandy"],
	"radio-tower": ["red", "white", "yellow"],
	"camp": ["orange", "green", "blue"],
	"plane": ["white", "yellow", "red"],
}

const COLOURS := {
	"red": Color("#c8463c"), "white": Color("#e8e4dc"), "blue": Color("#3c6ec8"),
	"green": Color("#4c8c4a"), "black": Color("#2a2a2a"), "yellow": Color("#e0b83a"),
	"orange": Color("#e07a2e"), "grey": Color("#8a8a86"), "dark": Color("#55534f"),
	"sandy": Color("#c2a878"),
}

## Trim that isn't a label.
const WOOD := Color("#7a5a3a")
const METAL := Color("#3c3c3a")
const CONCRETE := Color("#a8a49c")

const KENNEY := "res://assets/kenney_nature-kit/%s.glb"

static var _mats := {}
static var _lamp_keys: Array[String] = []
static var _lamps_on := false
static var _meshes := {}
static var _unit := BoxMesh.new()


## The piece from the layout, at (x, padY, z), turned by yaw.
static func build(piece: Dictionary) -> Node3D:
	var tid := String(piece.get("template", ""))
	var b: GDScript = BUILDERS.get(tid)
	if b == null:
		push_error("PieceKit: no template '%s'" % tid)
		return null
	var node: Node3D = b.build(piece.get("params", {}), int(piece.get("variant", 0)))
	node.name = String(piece.get("id", tid))
	node.position = Vector3(float(piece.get("x", 0)), float(piece.get("padY", 0)), float(piece.get("z", 0)))
	node.rotation.y = float(piece.get("yaw", 0))
	return node


static func label_colour(tid: String, label: int) -> Color:
	var words: Array = LABELS[tid]
	return COLOURS[words[clampi(label, 0, words.size() - 1)]]


## One material per colour, shared by every piece.
static func mat(c: Color) -> StandardMaterial3D:
	var key := c.to_html()
	if not _mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.roughness = 0.9
		_mats[key] = m
	return _mats[key]


## A lamp's glowing material: unlit and emissive when on, a plain shaded
## colour when off. Starts in whichever state set_lamps_on last put them.
static func lamp_mat(c: Color) -> StandardMaterial3D:
	var key := "lamp" + c.to_html()
	if not _mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.emission = c
		_lamp_keys.append(key)
		_set_lamp(m, _lamps_on)
		_mats[key] = m
	return _mats[key]


## Every lamp material at once: glowing (on) or plain (off). The clock calls
## this at dusk and dawn.
static func set_lamps_on(on: bool) -> void:
	_lamps_on = on
	for key in _lamp_keys:
		_set_lamp(_mats[key], on)


static func _set_lamp(m: StandardMaterial3D, on: bool) -> void:
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED if on else BaseMaterial3D.SHADING_MODE_PER_PIXEL
	m.emission_enabled = on


## The light of lamp `index`, named Lamp<index>, at `pos`. Hidden until the
## clock turns it on. The glowing mesh beside it is built by the piece.
static func lamp_light(parent: Node3D, index: int, pos: Vector3) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.name = "Lamp%d" % index
	l.omni_range = 9.0
	l.light_color = Color("#ffd890")
	l.position = pos
	l.visible = false
	parent.add_child(l)
	return l


static func mesh(parent: Node3D, m: Mesh, xf: Transform3D, material: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = m
	mi.transform = xf
	mi.material_override = material
	parent.add_child(mi)
	return mi


## A box centred at `pos`.
static func box(parent: Node3D, size: Vector3, pos: Vector3, material: Material, basis := Basis.IDENTITY) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = size
	return mesh(parent, bm, Transform3D(basis, pos), material)


## A cylinder (or cone) centred at `pos`, along the basis's Y.
static func cylinder(parent: Node3D, top: float, bottom: float, h: float, pos: Vector3, material: Material, basis := Basis.IDENTITY) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = top
	cm.bottom_radius = bottom
	cm.height = h
	cm.radial_segments = 16
	cm.rings = 1
	return mesh(parent, cm, Transform3D(basis, pos), material)


## A Kenney mesh stretched to fill `size`, standing at `pos` (its base at
## pos.y, centred on pos in x and z), turned by `yaw`. Null material keeps
## the model's own colours.
static func kenney(parent: Node3D, file: String, pos: Vector3, size: Vector3, yaw := 0.0, material: Material = null) -> MeshInstance3D:
	var m := _kenney_mesh(file)
	var a := m.get_aabb()
	var s := size / a.size
	var centre := Vector3(a.position.x + a.size.x * 0.5, a.position.y, a.position.z + a.size.z * 0.5) * s
	var basis := Basis(Vector3.UP, yaw)
	return mesh(parent, m, Transform3D(basis.scaled_local(s), pos - basis * centre), material)


static func _kenney_mesh(file: String) -> Mesh:
	if not _meshes.has(file):
		var scene: Node = (load(KENNEY % file) as PackedScene).instantiate()
		var mi := scene.find_children("*", "MeshInstance3D", true, false)
		_meshes[file] = (mi[0] as MeshInstance3D).mesh if mi.size() > 0 else (scene as MeshInstance3D).mesh
		scene.free()
	return _meshes[file]


## A static body on layer 1 (the world), hearing nothing.
static func body(parent: Node3D) -> StaticBody3D:
	var b := StaticBody3D.new()
	b.name = "Body"
	b.collision_layer = 1
	b.collision_mask = 0
	parent.add_child(b)
	return b


static func box_shape(b: StaticBody3D, size: Vector3, pos: Vector3, basis := Basis.IDENTITY) -> void:
	var s := BoxShape3D.new()
	s.size = size
	_shape(b, s, Transform3D(basis, pos))


static func cylinder_shape(b: StaticBody3D, r: float, h: float, pos: Vector3) -> void:
	var s := CylinderShape3D.new()
	s.radius = r
	s.height = h
	_shape(b, s, Transform3D(Basis.IDENTITY, pos))


## A convex hull of `points`, with its origin at their average so the
## shape's position is inside it.
static func convex_shape(b: StaticBody3D, points: PackedVector3Array) -> void:
	var mid := Vector3.ZERO
	for v in points:
		mid += v / points.size()
	var local := PackedVector3Array()
	for v in points:
		local.append(v - mid)
	var s := ConvexPolygonShape3D.new()
	s.points = local
	_shape(b, s, Transform3D(Basis.IDENTITY, mid))


static func _shape(b: StaticBody3D, s: Shape3D, xf: Transform3D) -> void:
	var cs := CollisionShape3D.new()
	cs.shape = s
	cs.transform = xf
	b.add_child(cs)


# --- merged meshes: many boxes, one node ---------------------------------------

static func begin() -> SurfaceTool:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	return st


## A box of `size` placed by `xf`, into `st`.
static func block(st: SurfaceTool, size: Vector3, xf: Transform3D) -> void:
	st.append_from(_unit, 0, Transform3D(xf.basis.scaled_local(size), xf.origin))


## A square beam `w` thick from `a` to `b`.
static func strut(st: SurfaceTool, a: Vector3, b: Vector3, w: float) -> void:
	block(st, Vector3(w, 1, w), strut_xf(a, b))


## Y along a→b and scaled to its length; X and Z unit.
static func strut_xf(a: Vector3, b: Vector3) -> Transform3D:
	var d := b - a
	var y := d.normalized()
	var ref := Vector3.FORWARD if absf(y.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT
	var x := y.cross(ref).normalized()
	var z := x.cross(y)
	return Transform3D(Basis(x, y * d.length(), z), (a + b) * 0.5)


static func commit(parent: Node3D, st: SurfaceTool, material: Material) -> MeshInstance3D:
	return mesh(parent, st.commit(), Transform3D.IDENTITY, material)


## Where polar(a, d) from templates.ts lands: angle clockwise from −Z.
static func polar(a: float, d: float, y := 0.0) -> Vector3:
	return Vector3(sin(a) * d, y, -cos(a) * d)
