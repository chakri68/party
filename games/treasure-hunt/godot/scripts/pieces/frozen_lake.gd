extends RefCounted
## Frozen lake (templates.ts): ice of radius 12, the label's colour, at
## 0.03 m. It has no collider: the pad is the floor. Hole 1: a dark disc of
## radius 1.2 at (4, −3) and a fishing stand at (5.6, −3). A canvas shelter
## 3 × 2.5 × 2.5 m at (−11, 6), under one box collider.

const ICE_R := 12.0
const HOLE_R := 1.2
const HOLE_AT := Vector3(4, 0, -3)
const STAND := Vector3(0.8, 0.55, 0.5)
const STAND_AT := Vector3(5.6, 0, -3)
const SHELTER := Vector3(3, 2.5, 2.5)
const SHELTER_AT := Vector3(-11, 0, 6)

static var _ice := {}


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	PieceKit.mesh(root, _disc(ICE_R, 0.02, 48), Transform3D(Basis.IDENTITY, Vector3(0, 0.03, 0)), _ice_mat(PieceKit.label_colour("frozen-lake", label)))
	if int(p.get("hole", 0)) == 1:
		PieceKit.mesh(root, _disc(HOLE_R, 0.01, 20), Transform3D(Basis.IDENTITY, HOLE_AT + Vector3(0, 0.045, 0)), PieceKit.mat(Color("#1c2630")))
		PieceKit.kenney(root, "survival/campfire-fishing-stand", STAND_AT, STAND, PI / 2)

	var b := PieceKit.body(root)
	b.name = "Shelter"
	PieceKit.kenney(root, "survival/structure-canvas", SHELTER_AT, SHELTER)
	PieceKit.box_shape(b, SHELTER, SHELTER_AT + Vector3(0, SHELTER.y * 0.5, 0))
	return root


static func _disc(r: float, h: float, segments: int) -> CylinderMesh:
	var m := CylinderMesh.new()
	m.top_radius = r
	m.bottom_radius = r
	m.height = h
	m.radial_segments = segments
	m.rings = 1
	return m


## A little gloss: low roughness and a touch of specular, cheap in the
## Compatibility renderer. One per colour.
static func _ice_mat(c: Color) -> StandardMaterial3D:
	var key := c.to_html()
	if not _ice.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.roughness = 0.2
		m.metallic_specular = 0.7
		_ice[key] = m
	return _ice[key]
