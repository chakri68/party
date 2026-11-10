extends RefCounted
## Abandoned camp (templates.ts): tent i at polar(2πi/tents, 5 m), door
## facing the middle, its footprint within 1.25 m of that point. A fire pit
## 0.8 m across in the middle, if there is one. A log seat 0.5 m high and
## 0.4 m thick at x = −2.2, z −1..1. A lantern post stands at polar(135°, 2.6). One more log lies off to the side,
## clear of every slot and every tent.

## The Kenney tent's door is on its −Z side. This size keeps its corners
## 1.16 m from its middle.
const TENT := Vector3(1.84, 1.46, 1.40)
const SEAT := Vector3(0.4, 0.5, 2.0)
const PIT := 0.4 ## radius


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var tents := int(p.get("tents", 2))
	var canvas := PieceKit.mat(PieceKit.label_colour("camp", label))
	var b := PieceKit.body(root)
	for i in tents:
		var a := TAU * i / tents
		var at := PieceKit.polar(a, 5.0)
		var turn := PI - a # −Z, the door, towards the middle
		PieceKit.kenney(root, "tent_detailedOpen", at, TENT, turn, canvas)
		PieceKit.box_shape(b, TENT, at + Vector3(0, TENT.y * 0.5, 0), Basis(Vector3.UP, turn))

	var seat := Vector3(-2.2, 0, 0)
	PieceKit.kenney(root, "log", seat, SEAT)
	PieceKit.box_shape(b, SEAT, seat + Vector3(0, SEAT.y * 0.5, 0))

	if int(p.get("firepit", 0)) == 1:
		PieceKit.kenney(root, "campfire_stones", Vector3.ZERO, Vector3(PIT * 2, 0.12, PIT * 2))
		PieceKit.kenney(root, "campfire_logs", Vector3(0, 0.02, 0), Vector3(0.45, 0.12, 0.45))
		PieceKit.cylinder_shape(b, PIT, 0.12, Vector3(0, 0.06, 0))

	# A lantern on a thin post, 2.6 m out at 135°. The post has no collider: it
	# is 0.1 m thick and clear of every slot, so walking through it costs nothing.
	var post := PieceKit.polar(TAU * 3.0 / 8.0, 2.6)
	PieceKit.box(root, Vector3(0.1, 2.0, 0.1), post + Vector3(0, 1.0, 0), PieceKit.mat(PieceKit.WOOD))
	var bulb := post + Vector3(0, 2.2, 0)
	PieceKit.cylinder(root, 0.12, 0.12, 0.3, bulb, PieceKit.lamp_mat(Color("#ffc870")))
	PieceKit.lamp_light(root, 0, bulb)

	var spare := Vector3(3.0, 0, -2.2)
	PieceKit.kenney(root, "log_large", spare, Vector3(1.6, 0.55, 0.8), 0.3)
	PieceKit.box_shape(b, Vector3(1.6, 0.55, 0.8), spare + Vector3(0, 0.275, 0), Basis(Vector3.UP, 0.3))
	return root
