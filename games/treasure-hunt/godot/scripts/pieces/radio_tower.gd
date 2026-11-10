extends RefCounted
## Radio tower (templates.ts): a lattice of `height` m, its four legs at
## (±b, ±b) with b = 1 + 0.03 height, narrowing to ±TOP. The bracing runs
## in the four faces, so the ground between the legs stays open. A 3 × 3 m
## hut at (b + 3.5, 0), door on its −Z face. With wires: three anchors at
## polar(0°, 120°, 240°; 6.5 m), each wire rising inward to the tower.

const TOP := 0.35 ## half-width at the top
const SECTION := 4.0 ## metres between the bracing levels
const HUT := 3.0
const HUT_TALL := 2.4


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var h := float(p.get("height", 25))
	var bw := 1.0 + 0.03 * h
	var half := func(y: float) -> float: return bw + (TOP - bw) * y / h
	var corner := func(i: int, y: float) -> Vector3:
		var w: float = half.call(y)
		return Vector3(w if i == 0 or i == 3 else -w, y, w if i < 2 else -w)
	var b := PieceKit.body(root)
	b.name = "Tower"

	var st := PieceKit.begin()
	for i in 4:
		var foot: Vector3 = corner.call(i, 0.0)
		var tip: Vector3 = corner.call(i, h)
		PieceKit.strut(st, foot, tip, 0.18)
		PieceKit.box_shape(b, Vector3(0.25, foot.distance_to(tip), 0.25), (foot + tip) * 0.5, PieceKit.strut_xf(foot, tip).basis.orthonormalized())
	var levels := maxi(1, ceili(h / SECTION))
	for s in levels:
		var y0 := h * s / levels
		var y1 := h * (s + 1) / levels
		for i in 4:
			var j := (i + 1) % 4
			PieceKit.strut(st, corner.call(i, y1), corner.call(j, y1), 0.08)
			# One diagonal per face per section, zigzagging up.
			if s % 2 == 0:
				PieceKit.strut(st, corner.call(i, y0), corner.call(j, y1), 0.06)
			else:
				PieceKit.strut(st, corner.call(j, y0), corner.call(i, y1), 0.06)
	PieceKit.strut(st, Vector3(0, h - 1.0, 0), Vector3(0, h + 3.0, 0), 0.1) # the mast on top
	PieceKit.commit(root, st, PieceKit.mat(PieceKit.label_colour("radio-tower", label)))
	var lamp := PieceKit.box(root, Vector3(0.5, 0.5, 0.5), Vector3(0, h + 3.25, 0), PieceKit.lamp_mat(Color("#ff4030")))
	lamp.name = "Lamp"
	PieceKit.lamp_light(root, 0, Vector3(0, h + 3.25, 0))

	_hut(root, b, Vector3(bw + 3.5, 0, 0))
	# A bulb on a bracket at the roof edge over the door.
	var at := Vector3(bw + 3.5, 2.6, -1.75)
	PieceKit.box(root, Vector3(0.08, 0.08, 0.2), Vector3(at.x, 2.6, -1.6), PieceKit.mat(PieceKit.METAL))
	PieceKit.cylinder(root, 0.12, 0.12, 0.24, at, PieceKit.lamp_mat(Color("#ffe8a0")))
	PieceKit.lamp_light(root, 1, at)
	if int(p.get("wires", 0)) == 1:
		_wires(root, b, h, half)
	return root


static func _hut(root: Node3D, b: StaticBody3D, at: Vector3) -> void:
	var walls := Vector3(HUT, HUT_TALL, HUT)
	PieceKit.box(root, walls, at + Vector3(0, HUT_TALL * 0.5, 0), PieceKit.mat(PieceKit.CONCRETE))
	PieceKit.box(root, Vector3(HUT + 0.3, 0.2, HUT + 0.3), at + Vector3(0, HUT_TALL + 0.1, 0), PieceKit.mat(PieceKit.METAL))
	PieceKit.box(root, Vector3(0.9, 1.9, 0.08), at + Vector3(0, 0.95, -HUT * 0.5 - 0.04), PieceKit.mat(PieceKit.WOOD))
	PieceKit.box_shape(b, walls, at + Vector3(0, HUT_TALL * 0.5, 0))


## Anchors face the tower; each wire meets the tower at 0.6 of its height.
static func _wires(root: Node3D, b: StaticBody3D, h: float, half: Callable) -> void:
	var st := PieceKit.begin()
	var y := h * 0.6
	for k in 3:
		var a := TAU * k / 3.0
		var at := PieceKit.polar(a, 6.5)
		var turn := Basis(Vector3.UP, -a)
		PieceKit.box(root, Vector3(0.6, 0.3, 0.6), at + Vector3(0, 0.15, 0), PieceKit.mat(PieceKit.CONCRETE), turn)
		PieceKit.box_shape(b, Vector3(0.6, 0.3, 0.6), at + Vector3(0, 0.15, 0), turn)
		PieceKit.strut(st, at + Vector3(0, 0.3, 0), PieceKit.polar(a, half.call(y), y), 0.04)
	PieceKit.commit(root, st, PieceKit.mat(PieceKit.METAL))
