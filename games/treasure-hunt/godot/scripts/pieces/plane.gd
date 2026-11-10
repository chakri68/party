extends RefCounted
## Crashed plane (templates.ts): the body along Z from −6 to 6, nose at −Z,
## wings at z −2..0 and x −7..7. The debris trail runs out along `heading`,
## which is clockwise from −Z like polar(), not Godot's counter-clockwise
## yaw. Every bit sits beyond 9 m plus its own size and at least 1 m clear
## of every slot. With 20 or more, the biggest piece sits at
## polar(heading, 13.5), its footprint under 0.8 m in radius.

const SLOT_CLEAR := 1.0
const BIG := Vector3(1.0, 0.7, 0.8) ## half-diagonal 0.64 m
const BIG_AT := 13.5


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var debris := int(p.get("debris", 15))
	var heading := float(p.get("heading", 0))
	var paint := PieceKit.mat(PieceKit.label_colour("plane", label))
	var dark := PieceKit.mat(PieceKit.METAL)
	var along_z := Basis(Vector3.RIGHT, PI / 2) # a cylinder's +Y to +Z, the tail

	PieceKit.cylinder(root, 0.45, 1.0, 10.0, Vector3(0, 1.0, 1.0), paint, along_z) # z −4..6
	PieceKit.cylinder(root, 1.0, 0.3, 2.0, Vector3(0, 1.0, -5.0), paint, along_z) # the nose, z −6..−4
	PieceKit.box(root, Vector3(2.4, 0.2, 0.08), Vector3(0, 1.0, -5.94), dark, Basis(Vector3.BACK, 0.5))
	PieceKit.box(root, Vector3(1.2, 0.5, 1.2), Vector3(0, 1.85, -3.4), dark) # the cockpit
	PieceKit.box(root, Vector3(14.0, 0.25, 2.0), Vector3(0, 0.7, -1.0), paint)
	PieceKit.box(root, Vector3(0.15, 2.0, 1.5), Vector3(0, 2.2, 5.2), paint)
	PieceKit.box(root, Vector3(4.5, 0.12, 1.2), Vector3(0, 1.4, 5.3), paint)

	var b := PieceKit.body(root)
	PieceKit.box_shape(b, Vector3(2.0, 2.0, 12.0), Vector3(0, 1.0, 0))
	PieceKit.box_shape(b, Vector3(14.0, 0.25, 2.0), Vector3(0, 0.7, -1.0))
	PieceKit.box_shape(b, Vector3(0.15, 2.0, 1.5), Vector3(0, 2.2, 5.2))

	var slots: Array[Vector3] = [Vector3(0, 0, -7.5), Vector3(0, 0, 7.5), Vector3(-8.2, 0, -1)]
	var small := debris
	if debris >= 20:
		slots.append(PieceKit.polar(heading, 12.0))
		var at := PieceKit.polar(heading, BIG_AT)
		var turn := Basis(Vector3.UP, -heading)
		PieceKit.box(root, BIG, at + Vector3(0, BIG.y * 0.5, 0), paint, turn)
		PieceKit.box_shape(b, BIG, at + Vector3(0, BIG.y * 0.5, 0), turn)
		small -= 1
	_trail(root, small, heading, slots, paint, dark)
	return root


## Small bits, 1 m apart along the trail, scattered either side, merged
## into two meshes and walked through (no colliders). One that lands too
## near a slot moves further sideways, or is left out.
static func _trail(root: Node3D, n: int, heading: float, slots: Array[Vector3], paint: Material, dark: Material) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash([n, heading])
	var out := PieceKit.polar(heading, 1.0)
	var side := Vector3(-out.z, 0, out.x)
	var st: Array[SurfaceTool] = [PieceKit.begin(), PieceKit.begin()]
	var used := [0, 0]
	for j in n:
		var s := rng.randf_range(0.15, 0.4) # half the longest side
		var size := Vector3(2 * s, rng.randf_range(0.15, 0.5), 1.6 * s)
		var reach := s * 1.4 # the footprint's radius, tipped a little
		var along := 9.0 + reach + j
		var lateral := rng.randf_range(-1.0, 1.0) * (0.5 + 0.06 * j)
		var push := 1.0 if lateral >= 0 else -1.0
		var at := Vector3.INF
		for tries in 5:
			var c := out * along + side * (lateral + push * tries)
			if _clear(c, reach, slots):
				at = c
				break
		var spin := Basis(Vector3.UP, rng.randf() * TAU) * Basis(Vector3.RIGHT, rng.randf_range(-0.2, 0.2))
		if at != Vector3.INF:
			PieceKit.block(st[j % 2], size, Transform3D(spin, at + Vector3(0, size.y * 0.4, 0)))
			used[j % 2] += 1
	if used[0]:
		PieceKit.commit(root, st[0], paint).name = "Debris"
	if used[1]:
		PieceKit.commit(root, st[1], dark).name = "Scrap"


static func _clear(c: Vector3, reach: float, slots: Array[Vector3]) -> bool:
	for s in slots:
		if Vector2(c.x - s.x, c.z - s.z).length() < reach + SLOT_CLEAR:
			return false
	return true
