extends RefCounted
## Quarry (templates.ts): an open-fronted horseshoe of rock blocks, the
## label on the rock. Step k (k = 0..terraces − 1) is a block x −8..8,
## z (2 + 2k)..(4 + 2k), 2k + 1 high. Side walls at x −10..−8 and 8..10,
## z 0..(2 + 2 · terraces), 2 · terraces − 1 high. A cart 1.4 × 2.4 m along Z
## at (4, −3), with a pick and a shovel leaning on its −X side.
##
## Each block is its own mesh: the step slot at (−4, 3) stands on step 0,
## and one merged mesh would put its waist inside the horseshoe's box.

const CART := Vector3(1.4, 1.0, 2.4)
const CART_AT := Vector3(4, 0, -3)


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var terraces := int(p.get("terraces", 2))
	var rock := PieceKit.mat(PieceKit.label_colour("quarry", label))
	var b := PieceKit.body(root)
	b.name = "Rock"

	for k in terraces:
		var h := 2.0 * k + 1.0
		_block(root, b, Vector3(16, h, 2), Vector3(0, 0, 3 + 2 * k), rock)
	var wall := Vector3(2, 2.0 * terraces - 1.0, 2.0 + 2.0 * terraces)
	for x in [-9.0, 9.0]:
		_block(root, b, wall, Vector3(x, 0, wall.z * 0.5), rock)

	PieceKit.kenney(root, "town/cart", CART_AT, CART)
	PieceKit.box_shape(b, CART, CART_AT + Vector3(0, CART.y * 0.5, 0))
	# Leaning in towards the cart's −X side (x 3.3), tops resting at about 0.9 m.
	_lean(root, "survival/tool-pickaxe", Vector3(2.9, 0, -3.5), Vector3(0.7, 0.95, 0.15))
	_lean(root, "survival/tool-shovel", Vector3(2.9, 0, -2.3), Vector3(0.3, 1.2, 0.13))
	return root


## A rock block, its base at y 0 and centred on `at` in x and z.
static func _block(root: Node3D, b: StaticBody3D, size: Vector3, at: Vector3, rock: Material) -> void:
	PieceKit.kenney(root, "cliff_block_rock", at, size, 0.0, rock)
	PieceKit.box_shape(b, size, at + Vector3(0, size.y * 0.5, 0))


## A tool standing at `at`, tipped 0.35 rad towards +X. Walked through.
static func _lean(root: Node3D, model: String, at: Vector3, size: Vector3) -> void:
	var mi := PieceKit.kenney(root, model, Vector3.ZERO, size, PI / 2)
	mi.transform = Transform3D(Basis(Vector3.BACK, -0.35), at) * mi.transform
