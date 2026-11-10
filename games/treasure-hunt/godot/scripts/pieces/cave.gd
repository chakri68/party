extends RefCounted
## Cave (templates.ts): a rock mound x −7..7, z −2..10, 6 m high, the label
## on the rock. A tunnel 2.5 m wide and 2.5 m high runs in from z = −2 along
## +Z for 3 · chambers m. The mound is four boxes round that hollow: left and
## right walls, a roof slab over the tunnel and a back wall behind it. A
## rock 1 × 0.5 × 1 m at (−5.5, −4).
##
## Each box is its own mesh, so the deep slot isn't inside any mesh's box.
## The floor of the tunnel is dark, and the roof keeps the sun off it.

const HALF := 1.25 ## half the tunnel's width
const HIGH := 2.5 ## the tunnel's height
const TALL := 6.0
const FRONT := -2.0
const BACK := 10.0
const SIDE := 7.0
const ROCK := Vector3(1, 0.5, 1)
const ROCK_AT := Vector3(-5.5, 0, -4)


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var end := FRONT + 3.0 * int(p.get("chambers", 1))
	var rock := PieceKit.mat(PieceKit.label_colour("cave", label))
	var b := PieceKit.body(root)
	b.name = "Rock"

	var wall := SIDE - HALF
	var deep := BACK - FRONT
	_box(root, b, Vector3(wall, TALL, deep), Vector3(-HALF - wall * 0.5, 0, (FRONT + BACK) * 0.5), rock) # left
	_box(root, b, Vector3(wall, TALL, deep), Vector3(HALF + wall * 0.5, 0, (FRONT + BACK) * 0.5), rock) # right
	_box(root, b, Vector3(HALF * 2, TALL - HIGH, end - FRONT), Vector3(0, HIGH, (FRONT + end) * 0.5), rock) # roof
	_box(root, b, Vector3(HALF * 2, TALL, BACK - end), Vector3(0, 0, (end + BACK) * 0.5), rock) # back

	# The tunnel's floor, 1 cm up: no collider, the pad is the floor.
	PieceKit.box(root, Vector3(HALF * 2, 0.01, end - FRONT), Vector3(0, 0.005, (FRONT + end) * 0.5), PieceKit.mat(PieceKit.COLOURS.black))

	_box(root, b, ROCK, ROCK_AT, rock, "cliff_blockHalf_rock")
	return root


## A rock box, its base at at.y and centred on `at` in x and z.
static func _box(root: Node3D, b: StaticBody3D, size: Vector3, at: Vector3, rock: Material, model := "cliff_block_rock") -> void:
	PieceKit.kenney(root, model, at, size, 0.0, rock)
	PieceKit.box_shape(b, size, at + Vector3(0, size.y * 0.5, 0))
