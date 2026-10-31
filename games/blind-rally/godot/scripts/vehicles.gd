class_name Vehicles
extends RefCounted
## Rally's five car classes (rally-spec.md). A preset is only what differs from
## the scene's car, so hatch's controller and surfaces are {} and it drives
## exactly as it always has.
## "controller" overrides CarController exports by name; "surfaces" scales the
## SURFACES table per surface and key. "model" is the car you see (dress()),
## "audio" the engine note. Keep IDS in step with shared/vehicles.ts (a test
## reads it).
##
## model: body, wheel (and wheel_rear, if the back pair differ) are baked
## meshes (tools/bake_assets.gd). wheels: FL, FR, RL, RR where the tyres meet
## the road, in car space (-z forward), as CarFx.wheels has them; the hubs sit
## a wheel's radius above. box/box_y: the collision box and its centre height,
## its floor 5 cm up like the hatch's. roundel and pod: the roof plate and the
## light pod in the body's space (+z forward). bonnet: the bonnet camera,
## car space. hatch is car.tscn as it stands.

const IDS := ["hatch", "4x4", "rwd", "truck", "tractor"]
const MESHES := "res://assets/meshes/"
const WHEEL_NODES := ["WheelFL", "WheelFR", "WheelRL", "WheelRR"]

const PRESETS := {
	"hatch": {"controller": {}, "surfaces": {}, "audio": {},
		"model": {"body": MESHES + "car_body.res", "wheel": MESHES + "car_wheel.res",
			"wheels": [Vector3(-0.587, 0, -1.118), Vector3(0.587, 0, -1.118), Vector3(-0.587, 0, 1.118), Vector3(0.587, 0, 1.118)],
			"box": Vector3(1.8, 1.0, 3.8), "box_y": 0.55,
			"roundel": Transform3D(Basis(), Vector3(0, 1.53, -0.15)), "pod": Transform3D(Basis(), Vector3(0, 1.56, 0.62)),
			"stripes": true, "bonnet": Vector3(0.0, 1.3, -1.05)},
	},
	"4x4": {
		"controller": {"engine_accel": 11.0, "max_speed": 29.0, "max_yaw_rate": 1.9, "yaw_response": 7.0,
			"grip": 7.5, "power_oversteer": 0.5, "max_slip_deg": 30.0, "impact_keep": 0.65},
		"surfaces": {
			"offroad": {"drag": 0.5, "top": 1.5, "grip": 1.2},
			"sand": {"drag": 0.5, "top": 1.5},
			"snow": {"grip": 1.3},
			"ice": {"grip": 1.3},
		},
		"audio": {},
		"model": {"body": MESHES + "car_body_4x4.res", "wheel": MESHES + "car_wheel_4x4.res",
			"wheels": [Vector3(-0.677, 0, -1.21), Vector3(0.677, 0, -1.21), Vector3(-0.677, 0, 0.892), Vector3(0.677, 0, 0.892)],
			"box": Vector3(2.4, 1.3, 4.3), "box_y": 0.7,
			"roundel": Transform3D(Basis(), Vector3(0, 2.08, -0.55)), "pod": Transform3D(Basis(), Vector3(0, 2.11, 0.65)),
			"stripes": false, "bonnet": Vector3(0.0, 1.65, -1.3)},
	},
	"rwd": {
		"controller": {"engine_accel": 14.5, "max_speed": 33.0, "max_yaw_rate": 2.1, "yaw_response": 10.0,
			"grip": 4.8, "power_oversteer": 1.6, "max_slip_deg": 46.0},
		"surfaces": {"tarmac": {"grip": 1.1}},
		"audio": {},
		"model": {"body": MESHES + "car_body_rwd.res", "wheel": MESHES + "car_wheel_rwd.res",
			"wheels": [Vector3(-0.763, 0, -1.185), Vector3(0.763, 0, -1.185), Vector3(-0.763, 0, 1.185), Vector3(0.763, 0, 1.185)],
			"box": Vector3(2.34, 1.15, 4.4), "box_y": 0.625,
			"roundel": Transform3D(Basis(), Vector3(0, 1.99, -0.36)), "pod": Transform3D(Basis(), Vector3(0, 2.02, 0.52)),
			"stripes": false, "bonnet": Vector3(0.0, 1.64, -1.1)},
	},
	"truck": {
		"controller": {"engine_accel": 12.0, "max_speed": 38.0, "brake_decel": 19.0, "max_yaw_rate": 1.6,
			"yaw_response": 6.0, "grip": 5.5, "power_oversteer": 0.6, "max_slip_deg": 34.0,
			"drag": 0.10, "impact_keep": 0.7},
		"surfaces": {},
		"audio": {},
		# Plate on the cab roof, pod on its front edge; the bed is lower.
		"model": {"body": MESHES + "car_body_truck.res", "wheel": MESHES + "car_wheel_truck.res",
			"wheels": [Vector3(-0.895, 0, -1.81), Vector3(0.895, 0, -1.81), Vector3(-0.895, 0, 1.6), Vector3(0.895, 0, 1.6)],
			"box": Vector3(3.16, 1.65, 6.0), "box_y": 0.875,
			"roundel": Transform3D(Basis(), Vector3(0, 2.75, 0.26)), "pod": Transform3D(Basis(), Vector3(0, 2.78, 0.85)),
			"stripes": false, "bonnet": Vector3(0.0, 1.97, -1.76)},
	},
	"tractor": {
		"controller": {"engine_accel": 9.0, "max_speed": 19.0, "grip": 7.0, "yaw_response": 8.0,
			"power_oversteer": 0.3, "max_slip_deg": 28.0, "impact_keep": 0.7},
		"surfaces": {
			"offroad": {"drag": 0.2, "top": 1.9},
			"sand": {"drag": 0.25, "top": 1.9},
		},
		"audio": {},
		# The box runs nose to rear tyre: those stick out past the body.
		"model": {"body": MESHES + "car_body_tractor.res", "wheel": MESHES + "car_wheel_tractor.res",
			"wheel_rear": MESHES + "car_wheel_tractor_rear.res",
			"wheels": [Vector3(-0.679, 0, -1.195), Vector3(0.679, 0, -1.195), Vector3(-0.761, 0, 0.941), Vector3(0.761, 0, 0.941)],
			"box": Vector3(2.2, 1.5, 3.6), "box_y": 0.8,
			"roundel": Transform3D(Basis(), Vector3(0, 2.63, -0.5)), "pod": Transform3D(Basis(), Vector3(0, 2.66, 0.25)),
			"stripes": false, "bonnet": Vector3(0.0, 1.78, -0.6)},
	},
}


## Unknown ids drive the hatch, so a page and a Godot that disagree mid-deploy
## still get a car.
static func get_preset(id: String) -> Dictionary:
	if PRESETS.has(id):
		return PRESETS[id]
	push_warning("unknown vehicle '%s', using hatch" % id)
	return PRESETS["hatch"]


static func valid(id: String) -> String:
	return id if PRESETS.has(id) else "hatch"


## Puts a class's model on a car.tscn instance: body and wheel meshes, wheel,
## plate and pod positions, the collision box, the stripes, the dust's wheel
## contacts and the bonnet camera. A livery already on (CarPaint.apply) goes
## back on the new body.
static func dress(car: CarController, id: String) -> void:
	var m: Dictionary = get_preset(id)["model"]
	var body := car.get_node("Visual/Body") as MeshInstance3D
	var baked: ArrayMesh = load(m["body"])
	body.set_meta("baked_mesh", baked)
	body.mesh = baked
	for i in 4:
		var w := car.get_node("Visual/" + WHEEL_NODES[i]) as MeshInstance3D
		w.mesh = wheel_mesh(m, i)
		w.position = hub(m, i)
	(body.get_node("Roundel") as Node3D).transform = m["roundel"]
	(body.get_node("LightPod") as Node3D).transform = m["pod"]
	for s in ["StripeL", "StripeR"]:
		(body.get_node(s) as Node3D).visible = m["stripes"]
	# A fresh shape: car.tscn's box is a shared sub-resource.
	var shape := car.get_node("Shape") as CollisionShape3D
	var box := BoxShape3D.new()
	box.size = m["box"]
	shape.shape = box
	shape.position.y = m["box_y"]
	var fx := car.get_node_or_null("Fx") as CarFx
	if fx:
		fx.wheels = (m["wheels"] as Array).duplicate()
	if car.is_inside_tree():
		for cam in car.get_tree().get_nodes_in_group(FollowCamera.GROUP):
			if (cam as FollowCamera).target == car:
				cam.bonnet_offset = m["bonnet"]
	if car.has_meta("livery"):
		var l: Array = car.get_meta("livery")
		CarPaint.apply(car, l[0], l[1], l[2])


static func wheel_mesh(m: Dictionary, i: int) -> Mesh:
	return load(m.get("wheel_rear", m["wheel"]) if i >= 2 else m["wheel"])


## Wheel i's hub in the Visual node's space (turned half round, +z forward):
## over its road contact by the wheel's radius.
static func hub(m: Dictionary, i: int) -> Vector3:
	var w: Vector3 = m["wheels"][i]
	return Vector3(-w.x, wheel_mesh(m, i).get_aabb().size.y * 0.5, -w.z)
