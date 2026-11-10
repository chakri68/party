extends RefCounted
## Lighthouse (templates.ts): a round tower of radius R = 2.5 + height/10 at
## the base, its door at −Z. Ruined: an open, broken top, rubble to the west,
## and a fallen block 0.5 m high at (R + 2.5, 0). Working: a lamp under a
## roof, and a stack of boxes 1 m high at that same spot. The collider is
## the full base radius all the way up, so nothing sticks out past R.

const TAPER := 0.72 ## top radius / base radius


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var h := float(p.get("height", 18))
	var ruined := int(p.get("ruined", 0)) == 1
	var R := 2.5 + h * 0.1
	var colour := PieceKit.label_colour("lighthouse", label)
	var paint := PieceKit.mat(colour)
	var r_at := func(y: float) -> float: return R - R * (1.0 - TAPER) * y / h

	PieceKit.cylinder(root, R * TAPER, R, h, Vector3(0, h * 0.5, 0), paint)
	# White bands, unless it's the white one.
	if colour != PieceKit.COLOURS.white:
		var band := PieceKit.mat(PieceKit.COLOURS.white)
		for f in [0.35, 0.7]:
			var y: float = h * f
			PieceKit.cylinder(root, r_at.call(y + 0.7) + 0.04, r_at.call(y - 0.7) + 0.04, 1.4, Vector3(0, y, 0), band)
	PieceKit.box(root, Vector3(1.2, 2.2, 0.3), Vector3(0, 1.1, -R + 0.1), PieceKit.mat(PieceKit.METAL))

	var b := PieceKit.body(root)
	b.name = "Tower"
	PieceKit.cylinder_shape(b, R, h, Vector3(0, h * 0.5, 0))

	var spot := Vector3(R + 2.5, 0, 0)
	if ruined:
		_ruin(root, b, h, R * TAPER, R, spot)
	else:
		_lamp(root, h, R * TAPER)
		_door_lamp(root, R)
		_boxes(root, b, spot)
	return root


## Gallery, lamp, roof. The lamp is the unlit mesh named Lamp.
static func _lamp(root: Node3D, h: float, rt: float) -> void:
	var metal := PieceKit.mat(PieceKit.METAL)
	PieceKit.cylinder(root, rt + 0.5, rt + 0.5, 0.3, Vector3(0, h + 0.15, 0), metal)
	var lamp := PieceKit.cylinder(root, rt * 0.55, rt * 0.55, 1.8, Vector3(0, h + 1.2, 0), PieceKit.lamp_mat(Color("#ffe8a0")))
	lamp.name = "Lamp"
	PieceKit.lamp_light(root, 0, Vector3(0, h + 1.2, 0))
	PieceKit.cylinder(root, 0.0, rt * 0.75, 1.5, Vector3(0, h + 2.85, 0), metal)


## A bulb on a short bracket over the door, 0.25 m out from the wall.
static func _door_lamp(root: Node3D, R: float) -> void:
	var at := Vector3(0, 2.6, -(R + 0.25))
	PieceKit.box(root, Vector3(0.08, 0.08, 0.3), Vector3(0, 2.6, -R - 0.05), PieceKit.mat(PieceKit.METAL))
	PieceKit.cylinder(root, 0.12, 0.12, 0.24, at, PieceKit.lamp_mat(Color("#ffe8a0")))
	PieceKit.lamp_light(root, 1, at)


## A broken rim, rubble on the −X side, and the fallen block (top at 0.5).
static func _ruin(root: Node3D, b: StaticBody3D, h: float, rt: float, R: float, spot: Vector3) -> void:
	var stone := PieceKit.mat(PieceKit.COLOURS.grey)
	for i in 4:
		var a := TAU * i / 4.0 + 0.4
		var tall := 0.6 + 0.5 * (i % 2)
		PieceKit.box(root, Vector3(1.4, tall, 0.5), PieceKit.polar(a, rt - 0.25, h + tall * 0.5), stone, Basis(Vector3.UP, -a))
	for i in 3:
		PieceKit.kenney(root, "rock_smallA", Vector3(-R - 1.0 - 0.5 * i, 0, -1.2 + 1.3 * i), Vector3(1.0, 0.5, 1.0), i * 1.1, stone)
	var turn := Basis(Vector3.UP, 0.15)
	PieceKit.kenney(root, "rock_largeA", spot, Vector3(1.8, 0.5, 1.4), 0.15, stone)
	PieceKit.box_shape(b, Vector3(1.8, 0.5, 1.4), spot + Vector3(0, 0.25, 0), turn)


## Two crates stacked 1 m high, and one more beside them (0.5 m).
static func _boxes(root: Node3D, b: StaticBody3D, spot: Vector3) -> void:
	var wood := PieceKit.mat(PieceKit.WOOD)
	var top := Basis(Vector3.UP, 0.2)
	PieceKit.box(root, Vector3(1.4, 0.5, 1.4), spot + Vector3(0, 0.25, 0), wood)
	PieceKit.box(root, Vector3(1.1, 0.5, 1.1), spot + Vector3(0, 0.75, 0), wood, top)
	PieceKit.box(root, Vector3(1.0, 0.5, 1.0), spot + Vector3(0.1, 0.25, 1.4), wood)
	PieceKit.box_shape(b, Vector3(1.4, 0.5, 1.4), spot + Vector3(0, 0.25, 0))
	PieceKit.box_shape(b, Vector3(1.1, 0.5, 1.1), spot + Vector3(0, 0.75, 0), top)
	PieceKit.box_shape(b, Vector3(1.0, 0.5, 1.0), spot + Vector3(0.1, 0.25, 1.4))
