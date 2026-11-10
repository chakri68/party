extends RefCounted
## Fire lookout (templates.ts): four posts 0.25 m square at (±1.6, ±1.6),
## `stilts` tall. On them a cabin 4 × 4 × 2.5 m in the label colour, from
## y = stilts, under a roof 1 m high. A ladder on the +Z face, x −0.4..0.4,
## z 1.6..2.0, up to the deck. A log stack 1.6 × 1 × 0.8 m at (3.6, −1).
##
## Each post is its own mesh, and the braces run only above 2.2 m: the slot
## between the legs stays outside every mesh's box, and the walker's head
## clears the braces.

const POST := 0.25
const AT := 1.6 ## the posts' x and z
const CABIN := Vector3(4, 2.5, 4)
const DECK := 4.4
const LOGS := Vector3(1.6, 1, 0.8)
const BRACE_FROM := 2.2


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var s := float(p.get("stilts", 6))
	var wood := PieceKit.mat(PieceKit.WOOD)
	var b := PieceKit.body(root)
	b.name = "Frame"

	for x in [-AT, AT]:
		for z in [-AT, AT]:
			var at := Vector3(x, s * 0.5, z)
			PieceKit.box(root, Vector3(POST, s, POST), at, wood)
			PieceKit.box_shape(b, Vector3(POST, s, POST), at)
	# X braces on the −Z, −X and +X faces; the ladder has the +Z face.
	var faces := [
		[Vector3(-AT, 0, -AT), Vector3(AT, 0, -AT)],
		[Vector3(-AT, 0, -AT), Vector3(-AT, 0, AT)],
		[Vector3(AT, 0, -AT), Vector3(AT, 0, AT)],
	]
	for f: Array in faces:
		var st := PieceKit.begin()
		var lo := Vector3(0, BRACE_FROM, 0)
		var hi := Vector3(0, s - 0.2, 0)
		PieceKit.strut(st, f[0] + lo, f[1] + hi, 0.1)
		PieceKit.strut(st, f[1] + lo, f[0] + hi, 0.1)
		PieceKit.commit(root, st, wood)

	# Deck, cabin, a band of windows, roof.
	PieceKit.box(root, Vector3(DECK, 0.2, DECK), Vector3(0, s - 0.1, 0), wood)
	PieceKit.box(root, CABIN, Vector3(0, s + CABIN.y * 0.5, 0), PieceKit.mat(PieceKit.label_colour("lookout", label)))
	var glass := PieceKit.begin()
	var wy := s + 1.6
	for k in [-1, 1]:
		PieceKit.block(glass, Vector3(3.2, 0.8, 0.06), Transform3D(Basis.IDENTITY, Vector3(0, wy, k * (CABIN.z * 0.5 + 0.02))))
		PieceKit.block(glass, Vector3(0.06, 0.8, 3.2), Transform3D(Basis.IDENTITY, Vector3(k * (CABIN.x * 0.5 + 0.02), wy, 0)))
	PieceKit.commit(root, glass, PieceKit.mat(Color("#33414a")))
	PieceKit.pyramid(root, CABIN.x * 0.5 + 0.4, 1.0, Vector3(0, s + CABIN.y, 0), PieceKit.mat(PieceKit.COLOURS.dark))
	PieceKit.box_shape(b, Vector3(DECK, CABIN.y + 0.2, DECK), Vector3(0, s + (CABIN.y - 0.2) * 0.5, 0))

	# The ladder: two rails and a rung every 0.35 m, up to the deck.
	var ladder := PieceKit.begin()
	for x in [-0.35, 0.35]:
		PieceKit.block(ladder, Vector3(0.08, s, 0.08), Transform3D(Basis.IDENTITY, Vector3(x, s * 0.5, 1.8)))
	var y := 0.3
	while y < s - 0.2:
		PieceKit.block(ladder, Vector3(0.7, 0.05, 0.1), Transform3D(Basis.IDENTITY, Vector3(0, y, 1.8)))
		y += 0.35
	PieceKit.commit(root, ladder, wood)
	PieceKit.box_shape(b, Vector3(0.8, s, 0.4), Vector3(0, s * 0.5, 1.8))

	# The wood pile: along X.
	var pile := Vector3(3.6, 0, -1)
	PieceKit.kenney(root, "log_stack", pile, Vector3(LOGS.z, LOGS.y, LOGS.x), PI / 2)
	PieceKit.box_shape(b, LOGS, pile + Vector3(0, LOGS.y * 0.5, 0))
	return root
