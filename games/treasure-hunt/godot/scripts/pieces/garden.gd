extends RefCounted
## Garden (templates.ts): a square hedge ring, its centre line at x, z = ±8,
## 0.8 m thick and `hedge` tall, with 2 m gates in the middle of its −Z and
## +Z sides. A fountain at the centre, its stone in the label colour: radius
## 2, rim 0.6 m, a column to 1.6 m. Lantern posts, 0.1 m thick and with no
## collider (as at the camp), at (±1.8, −9.6) beside the −Z gate.
##
## Each hedge run is its own mesh, so the ring's box doesn't swallow the
## slots inside it.

const RING := 8.0
const THICK := 0.8
const GATE := 2.0
const BASIN := 2.0
const RIM := 0.6
const COLUMN := 1.6
## The bulb hangs just under its light at 2.2 m, so the lanterns stay
## within `top` (2 m) of the template.
const BULB_Y := 2.0


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var hedge := float(p.get("hedge", 1.6))
	var b := PieceKit.body(root)
	b.name = "Hedges"

	# East and west runs whole, corners and all; north and south split by the gates.
	var long := RING * 2 + THICK
	for x in [-RING, RING]:
		_hedge(root, b, Vector3(x, 0, 0), long, hedge, 0.0)
	var half := RING + THICK * 0.5 - THICK - GATE * 0.5 ## from the gate to the east/west run
	var mid := GATE * 0.5 + half * 0.5
	for z in [-RING, RING]:
		for x in [-mid, mid]:
			_hedge(root, b, Vector3(x, 0, z), half, hedge, PI / 2)

	var stone := PieceKit.mat(PieceKit.label_colour("garden", label))
	PieceKit.cylinder(root, BASIN, BASIN, RIM, Vector3(0, RIM * 0.5, 0), stone)
	PieceKit.cylinder(root, BASIN - 0.25, BASIN - 0.25, 0.04, Vector3(0, RIM + 0.01, 0), PieceKit.mat(Color("#4a7fa8")))
	PieceKit.cylinder(root, 0.25, 0.3, COLUMN - RIM, Vector3(0, (COLUMN + RIM) * 0.5, 0), stone)
	PieceKit.cylinder(root, 0.6, 0.3, 0.2, Vector3(0, 1.3, 0), stone)
	PieceKit.cylinder_shape(b, BASIN, RIM, Vector3(0, RIM * 0.5, 0))
	PieceKit.cylinder_shape(b, 0.3, COLUMN, Vector3(0, COLUMN * 0.5, 0))

	var post := PieceKit.mat(PieceKit.WOOD)
	var bulb := PieceKit.lamp_mat(Color("#ffc870"))
	for i in 2:
		var at := Vector3(-1.8 if i == 0 else 1.8, 0, -9.6)
		PieceKit.box(root, Vector3(0.1, BULB_Y - 0.14, 0.1), at + Vector3(0, (BULB_Y - 0.14) * 0.5, 0), post)
		PieceKit.cylinder(root, 0.12, 0.12, 0.28, at + Vector3(0, BULB_Y, 0), bulb)
		PieceKit.lamp_light(root, i, at + Vector3(0, 2.2, 0))
	return root


## One run of hedge, `length` long along Z before `yaw`.
static func _hedge(root: Node3D, b: StaticBody3D, at: Vector3, length: float, h: float, yaw: float) -> void:
	var size := Vector3(THICK, h, length)
	PieceKit.kenney(root, "town/hedge", at, size, yaw)
	PieceKit.box_shape(b, size, at + Vector3(0, h * 0.5, 0), Basis(Vector3.UP, yaw))
