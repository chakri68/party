extends RefCounted
## Windmill (templates.ts): a tower 5 × 5 m, centred, `height` tall, its door
## on −Z, and a roof cap tinted by the label from height to height + 1.5.
## The sails turn on a hub at (0, height − 1, −2.8): 4 blades, each
## 0.45 · height long, so the lowest tip is ≥ 3.95 m up. They're a child
## node, Sails, with no collider, turning about its own Z when `turning` is
## 1. A stack of crates 1 m high and 1.2 m square at (3.8, 0). Lamps: one
## over the door (Lamp0), one on the front of the hub (Lamp1).

const SIDE := 5.0
const CRATE := Vector3(1.2, 0.5, 1.2)
## The Kenney rotor's blade tip, over its AABB's half height: measured off
## its vertices, so the blades come out 0.45 · height long, not the box.
const TIP := 1.198
const SPEED := 0.6 ## rad/s


## The sails. Turning ones spin in _process, still ones never process.
## Set in _ready: Godot turns processing on for any node with _process
## just before that.
class Sails extends Node3D:
	var turning := false

	func _ready() -> void:
		set_process(turning)

	func _process(delta: float) -> void:
		rotation.z = wrapf(rotation.z + SPEED * delta, -PI, PI)


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var h := float(p.get("height", 11))
	var turning := int(p.get("turning", 0)) == 1
	var stone := PieceKit.mat(PieceKit.CONCRETE)
	var wood := PieceKit.mat(PieceKit.WOOD)
	var metal := PieceKit.mat(PieceKit.METAL)
	var bulb := PieceKit.lamp_mat(Color("#ffe8a0"))

	PieceKit.box(root, Vector3(SIDE, h, SIDE), Vector3(0, h * 0.5, 0), stone)
	PieceKit.box(root, Vector3(1.2, 2.2, 0.1), Vector3(0, 1.1, -SIDE * 0.5 - 0.05), wood)
	# The cap only just overhangs, so the sails at z −2.8 pass in front of it.
	PieceKit.pyramid(root, SIDE * 0.5 + 0.1, 1.5, Vector3(0, h, 0), PieceKit.mat(PieceKit.label_colour("windmill", label)))
	var b := PieceKit.body(root)
	b.name = "Tower"
	PieceKit.box_shape(b, Vector3(SIDE, h, SIDE), Vector3(0, h * 0.5, 0))

	# Lamp0: a bulb on a short bracket over the door.
	var door_lamp := Vector3(0, 2.6, -2.75)
	PieceKit.box(root, Vector3(0.08, 0.08, 0.3), Vector3(0, 2.6, -2.6), metal)
	PieceKit.cylinder(root, 0.12, 0.12, 0.24, door_lamp, bulb)
	PieceKit.lamp_light(root, 0, door_lamp)

	# The axle out of the wall, the sails on it, Lamp1 on its front.
	var hub := Vector3(0, h - 1.0, -2.8)
	PieceKit.cylinder(root, 0.25, 0.25, 0.6, Vector3(0, hub.y, -2.75), metal, Basis(Vector3.RIGHT, PI / 2))
	var sails := Sails.new()
	sails.name = "Sails"
	sails.position = hub
	sails.turning = turning
	root.add_child(sails)
	var R := 0.45 * h / TIP
	PieceKit.kenney(sails, "town/windmill", Vector3(0, -R, 0), Vector3(0.3, R * 2, R * 2), PI / 2)
	var hub_lamp := Vector3(0, hub.y, -3.2)
	PieceKit.cylinder(root, 0.15, 0.15, 0.12, hub_lamp, bulb, Basis(Vector3.RIGHT, PI / 2))
	PieceKit.lamp_light(root, 1, hub_lamp)

	# Two crates, one on the other: 1 m, and a barrel beside them.
	var spot := Vector3(3.8, 0, 0)
	PieceKit.kenney(root, "survival/box-large", spot, CRATE)
	PieceKit.kenney(root, "survival/box-large", spot + Vector3(0, CRATE.y, 0), CRATE, PI / 2)
	PieceKit.box_shape(b, Vector3(CRATE.x, CRATE.y * 2, CRATE.z), spot + Vector3(0, CRATE.y, 0))
	var barrel := Vector3(3.5, 0, 1.6)
	PieceKit.kenney(root, "survival/barrel", barrel, Vector3(0.6, 0.85, 0.6))
	PieceKit.cylinder_shape(b, 0.3, 0.85, barrel + Vector3(0, 0.425, 0))
	return root
