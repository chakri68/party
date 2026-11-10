extends RefCounted
## Farm (templates.ts): a barn 6 × 4 m (x −3..3, z −7..−3), walls 3 m in the
## label colour, with a doorway 1.4 m wide and 2.4 m high in the middle of
## its +Z wall. Ruin 0: a gable roof peaking at 5 m. Ruin 1: only its −Z half
## and bare rafters. Ruin 2: walls only. Building 2 at (−9, 3) and building
## 3 at (9, 3): 4 × 4 m, walls 3 m, no door, roofed to 4.5 m unless ruin 2. A
## cart 1.4 × 2.4 m along Z at (0, 4). A broken fence along z = 10, x −6..6: its second segment is open 0.9 m
## wide in the middle, where the model dips to the ground.
##
## Each barn wall is its own mesh: one mesh round the inside slot would put
## that slot inside its box.

const WALL := 3.0
const T := 0.2 ## wall thickness, inside the footprint
const DOOR := Vector2(1.4, 2.4)
const SHED := 4.0
const CART := Vector3(1.4, 0.9, 2.4)
const FENCE := 3.0 ## one segment's length


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var buildings := int(p.get("buildings", 1))
	var ruin := int(p.get("ruin", 0))
	var paint := PieceKit.mat(PieceKit.label_colour("farm", label))
	var roof := PieceKit.mat(PieceKit.COLOURS.dark)
	var b := PieceKit.body(root)
	b.name = "Walls"

	# The barn: back, two sides, and the front around its doorway.
	var walls := [
		[Vector3(6, WALL, T), Vector3(0, WALL * 0.5, -7 + T * 0.5)],
		[Vector3(T, WALL, 4 - T * 2), Vector3(-3 + T * 0.5, WALL * 0.5, -5)],
		[Vector3(T, WALL, 4 - T * 2), Vector3(3 - T * 0.5, WALL * 0.5, -5)],
	]
	for w: Array in walls:
		PieceKit.box(root, w[0], w[1], paint)
		PieceKit.box_shape(b, w[0], w[1])
	var side := (6.0 - DOOR.x) * 0.5
	var front := [
		[Vector3(side, WALL, T), Vector3(-3 + side * 0.5, WALL * 0.5, -3 - T * 0.5)],
		[Vector3(side, WALL, T), Vector3(3 - side * 0.5, WALL * 0.5, -3 - T * 0.5)],
		[Vector3(DOOR.x, WALL - DOOR.y, T), Vector3(0, (WALL + DOOR.y) * 0.5, -3 - T * 0.5)],
	]
	var st := PieceKit.begin()
	for w: Array in front:
		PieceKit.block(st, w[0], Transform3D(Basis.IDENTITY, w[1]))
		PieceKit.box_shape(b, w[0], w[1])
	PieceKit.commit(root, st, paint)

	# Roof, ridge along X at z −5. A PrismMesh's slope is in its X–Y plane,
	# so it's turned a quarter to run the ridge along X.
	var quarter := Basis(Vector3.UP, PI / 2)
	if ruin == 0:
		_prism(root, Vector3(4.6, 2, 6.6), Vector3(0, WALL + 1, -5), 0.5, roof, quarter)
	elif ruin == 1:
		# The −Z half stays (its ridge face at z −5), the rest is rafters.
		_prism(root, Vector3(2.3, 2, 6.6), Vector3(0, WALL + 1, -6.15), 0.0, roof, quarter)
		var rafters := PieceKit.begin()
		for x in [-2.4, 0.0, 2.4]:
			PieceKit.strut(rafters, Vector3(x, WALL, -3.1), Vector3(x, WALL + 1.9, -5), 0.15)
		PieceKit.commit(root, rafters, PieceKit.mat(PieceKit.WOOD))

	# Buildings 2 and 3: plain wooden sheds, solid, no door.
	var sheds: Array[Vector3] = [Vector3(-9, 0, 3), Vector3(9, 0, 3)]
	for i in buildings - 1:
		_shed(root, b, sheds[i], ruin, roof, quarter)

	PieceKit.kenney(root, "town/cart", Vector3(0, 0, 4), CART)
	PieceKit.box_shape(b, CART, Vector3(0, CART.y * 0.5, 4))

	# The fence: whole, broken, a gap, whole, from x −6 to 6.
	var kinds := ["town/fence", "town/fence-broken", "", "town/fence"]
	for k in kinds.size():
		if kinds[k] == "":
			continue
		var at := Vector3(-6 + FENCE * (k + 0.5), 0, 10)
		PieceKit.kenney(root, kinds[k], at, Vector3(0.15, 1.0, FENCE), PI / 2)
		if kinds[k] == "town/fence-broken":
			# The model's middle dips to the ground: leave that 0.9 m open, with
			# a collider on each whole end.
			var end := FENCE * 0.35
			for sgn in [-1, 1]:
				PieceKit.box_shape(b, Vector3(end, 1.0, 0.2), at + Vector3(sgn * (FENCE * 0.15 + end * 0.5), 0.5, 0))
		else:
			PieceKit.box_shape(b, Vector3(FENCE, 1.0, 0.2), at + Vector3(0, 0.5, 0))
	return root


## Four Kenney wood walls round a solid box collider, roofed unless ruin 2.
static func _shed(root: Node3D, b: StaticBody3D, at: Vector3, ruin: int, roof: Material, quarter: Basis) -> void:
	var half := SHED * 0.5 - 0.1
	for s in [-1, 1]:
		PieceKit.kenney(root, "town/wall-wood", at + Vector3(half * s, 0, 0), Vector3(0.2, WALL, SHED))
		PieceKit.kenney(root, "town/wall-wood", at + Vector3(0, 0, half * s), Vector3(0.2, WALL, SHED), PI / 2)
	PieceKit.box_shape(b, Vector3(SHED, WALL, SHED), at + Vector3(0, WALL * 0.5, 0))
	if ruin < 2:
		_prism(root, Vector3(SHED + 0.4, 1.5, SHED + 0.4), at + Vector3(0, WALL + 0.75, 0), 0.5, roof, quarter)


## A PrismMesh centred at `pos`: `apex` 0.5 is a gable, 0 a lean-to.
static func _prism(root: Node3D, size: Vector3, pos: Vector3, apex: float, m: Material, basis: Basis) -> void:
	var pm := PrismMesh.new()
	pm.size = size
	pm.left_to_right = apex
	PieceKit.mesh(root, pm, Transform3D(basis, pos), m)
