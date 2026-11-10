extends RefCounted
## Watchtower (templates.ts): a square tower 5 × 5 m, centred, floors · 4 m
## tall, a doorway on −Z, solid inside (one box collider). Its stone is the
## label colour. Unless broken, a battlement cap 1.5 m high on top. A rubble
## block 1.6 × 0.5 × 1.2 m at (4.2, 0); broken adds one at (−4.2, 1).

const SIDE := 5.0
const FLOOR := 4.0
const CAP := 1.5
const RUBBLE := Vector3(1.6, 0.5, 1.2)


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var floors := int(p.get("floors", 2))
	var broken := int(p.get("broken", 0)) == 1
	var h := floors * FLOOR
	# The castle models are wholly the tower's stone, so the label tints them.
	var stone := PieceKit.mat(PieceKit.label_colour("watchtower", label))
	for f in floors:
		var model := "castle/tower-square-base" if f == 0 else "castle/tower-square-mid"
		PieceKit.kenney(root, model, Vector3(0, f * FLOOR, 0), Vector3(SIDE, FLOOR, SIDE), 0.0, stone)
	if not broken:
		PieceKit.kenney(root, "castle/tower-square-top", Vector3(0, h, 0), Vector3(SIDE, CAP, SIDE), 0.0, stone)
	PieceKit.box(root, Vector3(1.4, 2.4, 0.1), Vector3(0, 1.2, -SIDE * 0.5 - 0.05), PieceKit.mat(PieceKit.WOOD))

	var b := PieceKit.body(root)
	b.name = "Tower"
	PieceKit.box_shape(b, Vector3(SIDE, h, SIDE), Vector3(0, h * 0.5, 0))

	var spots: Array[Vector3] = [Vector3(4.2, 0, 0)]
	if broken:
		spots.append(Vector3(-4.2, 0, 1))
	for at in spots:
		PieceKit.kenney(root, "castle/rocks-large", at, RUBBLE)
		PieceKit.box_shape(b, RUBBLE, at + Vector3(0, RUBBLE.y * 0.5, 0))
	if broken:
		# Loose stones off the broken top, too small to stand on.
		PieceKit.kenney(root, "castle/rocks-small", Vector3(-3.6, 0, -1.6), Vector3(0.9, 0.3, 0.8), 0.7)
	return root
