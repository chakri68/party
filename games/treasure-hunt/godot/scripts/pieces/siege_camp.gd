extends RefCounted
## Siege camp (templates.ts): engine 0, a trebuchet 4 × 6 m (x × z) and 8 m
## high, at (0, −6). Engine 1, a catapult 3 × 4 m at (−7, 3). Engine 2, a
## ballista 2.5 × 3 m at (7, 3). The first `broken` engines are the
## demolished models, under 1 m high. Banner poles 3 m high at (±3, 8),
## the label on the banners.
##
## The castle models run long along their X, so each is turned a quarter
## to run long along Z. Their colliders are boxes: the trebuchet's stops at
## 3 m, under its arm, and the rest are as high as the model.

const ENGINES := [
	["castle/siege-trebuchet", Vector3(0, 0, -6), Vector3(4, 8, 6)],
	["castle/siege-catapult", Vector3(-7, 0, 3), Vector3(3, 2.6, 4)],
	["castle/siege-ballista", Vector3(7, 0, 3), Vector3(2.5, 1.6, 3)],
]
const WRECK_H := 0.9
const FRAME_H := 3.0 ## the most any engine's collider stands
const POLE_H := 3.0
const BANNER := Vector3(0.06, 1.8, 0.7)


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var engines := int(p.get("engines", 2))
	var broken := int(p.get("broken", 0))
	var b := PieceKit.body(root)
	b.name = "Engines"

	for i in engines:
		var e: Array = ENGINES[i]
		var model: String = e[0]
		var at: Vector3 = e[1]
		var size: Vector3 = e[2]
		if i < broken:
			model += "-demolished"
			size.y = WRECK_H
		# A quarter turn: the model's X runs along world Z.
		PieceKit.kenney(root, model, at, Vector3(size.z, size.y, size.x), PI / 2)
		var hit := Vector3(size.x, minf(size.y, FRAME_H), size.z)
		PieceKit.box_shape(b, hit, at + Vector3(0, hit.y * 0.5, 0))

	var wood := PieceKit.mat(PieceKit.WOOD)
	var cloth := PieceKit.mat(PieceKit.label_colour("siege-camp", label))
	for x in [-3.0, 3.0]:
		var foot := Vector3(x, 0, 8)
		PieceKit.cylinder(root, 0.06, 0.08, POLE_H, foot + Vector3(0, POLE_H * 0.5, 0), wood)
		PieceKit.cylinder_shape(b, 0.08, POLE_H, foot + Vector3(0, POLE_H * 0.5, 0))
		# A flag on the +Z side of the pole, near its top, its face to ±X.
		var flag := foot + Vector3(0, POLE_H - 0.15 - BANNER.y, 0.08 + BANNER.z * 0.5)
		PieceKit.kenney(root, "castle/flag-banner-long", flag, BANNER, 0.0, cloth)
	return root
