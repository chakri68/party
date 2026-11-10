extends RefCounted
## Hot spring (templates.ts): a pool of radius 3 at the centre, its water the
## label's colour at 0.05 m, in a ring of rocks from radius 3 to 3.6, 0.4 m
## high. Pools 2: a second pool of radius 2 (rocks 2–2.6) at (6.8, 2.5). A
## boulder 1 m high on the big ring at (0, 3.3) is the piece's top. Steam
## rises over each pool: 0, 12 or 24 puffs. A flat rock 1.2 × 0.5 × 1.2 m
## at (−4.8, 2).
##
## The ring's colliders are boxes, one per segment. Segment 0 faces −Z,
## so the big pool's edge slot at (0, −4.2) looks at a flat face, not a
## corner; on the small pool, segment 4 of 8 faces its slot at +Z.

const RING_H := 0.4
const RING_W := 0.6
const FLAT := Vector3(1.2, 0.5, 1.2)
const FLAT_AT := Vector3(-4.8, 0, 2)
const BOULDER := Vector3(1.2, 1.0, 1.0)
const BOULDER_AT := Vector3(0, 0, 3.3)
const SMALL_AT := Vector3(6.8, 0, 2.5)
const PUFFS := [0, 12, 24]

static var _steam_mat: StandardMaterial3D


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var pools := int(p.get("pools", 1))
	var puffs: int = PUFFS[clampi(int(p.get("steam", 0)), 0, 2)]
	var water := PieceKit.mat(PieceKit.label_colour("hot-spring", label))
	var stone := PieceKit.mat(PieceKit.COLOURS.grey)
	var b := PieceKit.body(root)
	b.name = "Rocks"

	_pool(root, b, Vector3.ZERO, 3.0, 10, water, stone, puffs, 0)
	if pools == 2:
		_pool(root, b, SMALL_AT, 2.0, 8, water, stone, puffs, 1)

	PieceKit.kenney(root, "cliff_blockHalf_rock", FLAT_AT, FLAT, 0.4, stone)
	PieceKit.box_shape(b, FLAT, FLAT_AT + Vector3(0, FLAT.y * 0.5, 0), Basis(Vector3.UP, 0.4))
	PieceKit.kenney(root, "rock_largeA", BOULDER_AT, BOULDER, 0.0, stone)
	PieceKit.box_shape(b, BOULDER, BOULDER_AT + Vector3(0, BOULDER.y * 0.5, 0))
	return root


## Water of radius `r` at `at`, a ring of `n` rock blocks from r to r + 0.6,
## and steam over it.
static func _pool(root: Node3D, b: StaticBody3D, at: Vector3, r: float, n: int, water: Material, stone: Material, puffs: int, index: int) -> void:
	var disc := CylinderMesh.new()
	disc.top_radius = r
	disc.bottom_radius = r
	disc.height = 0.02
	disc.radial_segments = 24
	disc.rings = 1
	PieceKit.mesh(root, disc, Transform3D(Basis.IDENTITY, at + Vector3(0, 0.05, 0)), water)

	var mid := r + RING_W * 0.5
	# Long enough that the outer corners meet: 2 (r + w) tan(π / n).
	var long := 2.0 * (r + RING_W) * tan(PI / n)
	var st := PieceKit.begin()
	for k in n:
		var a := TAU * k / n
		var c := at + PieceKit.polar(a, mid, RING_H * 0.5)
		var turn := Basis(Vector3.UP, -a)
		PieceKit.block(st, Vector3(long, RING_H, RING_W), Transform3D(turn, c))
		PieceKit.box_shape(b, Vector3(long, RING_H, RING_W), c, turn)
	PieceKit.commit(root, st, stone)

	if puffs > 0:
		root.add_child(_steam(at, r, puffs, index))


## Small pale quads drifting up from the water. CPUParticles3D runs in the
## Compatibility renderer and on the web. Its box stays over the water, so
## no slot is inside it.
static func _steam(at: Vector3, r: float, puffs: int, index: int) -> CPUParticles3D:
	var s := CPUParticles3D.new()
	s.name = "Steam%d" % index
	s.position = at + Vector3(0, 0.1, 0)
	s.amount = puffs
	s.lifetime = 3.0
	s.local_coords = true
	s.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	s.emission_box_extents = Vector3(r * 0.6, 0.05, r * 0.6)
	s.direction = Vector3.UP
	s.spread = 15.0
	s.gravity = Vector3(0, 0.15, 0)
	s.initial_velocity_min = 0.3
	s.initial_velocity_max = 0.6
	s.scale_amount_min = 0.6
	s.scale_amount_max = 1.2
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0.35))
	fade.set_color(1, Color(1, 1, 1, 0))
	s.color_ramp = fade
	var quad := QuadMesh.new()
	quad.size = Vector2(0.8, 0.8)
	quad.material = _material()
	s.mesh = quad
	s.visibility_aabb = AABB(Vector3(-r, 0, -r), Vector3(r * 2, 3, r * 2))
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return s


static func _material() -> StandardMaterial3D:
	if _steam_mat == null:
		_steam_mat = StandardMaterial3D.new()
		_steam_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_steam_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_steam_mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		_steam_mat.vertex_color_use_as_albedo = true
		_steam_mat.albedo_color = Color(0.95, 0.95, 0.95)
	return _steam_mat
