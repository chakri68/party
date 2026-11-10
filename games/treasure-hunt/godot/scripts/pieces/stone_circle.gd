extends RefCounted
## Stone circle (templates.ts): stone k of n stands at polar(2πk/n, Rc), with
## Rc = 2 + 0.6 n. Stone 0 is the tallest. Standing stones are 0.8 m deep
## along the radius, so the slot 1.2 m behind stone 0 stays clear. The last
## `fallen` stones lie flat instead, pointing out, 0.5 m high, their middle
## at Rc + 1.5, where a slot stands on top of the last one.

const WIDE := 1.2
const DEEP := 0.8
const TALLEST := 3.4
const FALLEN := Vector3(1.0, 0.5, 2.4)


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var n := int(p.get("stones", 8))
	var fallen := int(p.get("fallen", 0))
	var rc := 2.0 + 0.6 * n
	var stone := PieceKit.mat(PieceKit.label_colour("stone-circle", label))
	var b := PieceKit.body(root)
	for k in n:
		var a := TAU * k / n
		var turn := -a # local −Z points out from the centre
		if k >= n - fallen:
			var at := PieceKit.polar(a, rc + 1.5)
			PieceKit.kenney(root, "rock_largeA", at, FALLEN, turn, stone)
			PieceKit.box_shape(b, FALLEN, at + Vector3(0, FALLEN.y * 0.5, 0), Basis(Vector3.UP, turn))
		else:
			# Steady, not random: 2.0 to 2.6 m, and stone 0 above them all.
			var tall := TALLEST if k == 0 else 2.0 + 0.6 * fposmod(k * 0.618, 1.0)
			var size := Vector3(WIDE, tall, DEEP)
			var at := PieceKit.polar(a, rc)
			PieceKit.kenney(root, "rock_tallA" if k % 2 == 0 else "rock_tallB", at, size, turn, stone)
			PieceKit.box_shape(b, size, at + Vector3(0, tall * 0.5, 0), Basis(Vector3.UP, turn))
	return root
