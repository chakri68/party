class_name Vehicles
extends RefCounted
## Rally's five car classes (rally-spec.md). A preset is only what differs from
## the scene's car, so hatch is {} and drives exactly as it always has.
## "controller" overrides CarController exports by name; "surfaces" scales the
## SURFACES table per surface and key. "model" and "audio" are for the livery
## and the engine note. Keep IDS in step with shared/vehicles.ts (a test reads it).

const IDS := ["hatch", "4x4", "rwd", "truck", "tractor"]

const PRESETS := {
	"hatch": {"controller": {}, "surfaces": {}, "model": {}, "audio": {}},
	"4x4": {
		"controller": {"engine_accel": 11.0, "max_speed": 29.0, "max_yaw_rate": 1.9, "yaw_response": 7.0,
			"grip": 7.5, "power_oversteer": 0.5, "max_slip_deg": 30.0, "impact_keep": 0.65},
		"surfaces": {
			"offroad": {"drag": 0.5, "top": 1.5, "grip": 1.2},
			"sand": {"drag": 0.5, "top": 1.5},
			"snow": {"grip": 1.3},
			"ice": {"grip": 1.3},
		},
		"model": {}, "audio": {},
	},
	"rwd": {
		"controller": {"engine_accel": 14.5, "max_speed": 33.0, "max_yaw_rate": 2.1, "yaw_response": 10.0,
			"grip": 4.8, "power_oversteer": 1.6, "max_slip_deg": 46.0},
		"surfaces": {"tarmac": {"grip": 1.1}},
		"model": {}, "audio": {},
	},
	"truck": {
		"controller": {"engine_accel": 12.0, "max_speed": 38.0, "brake_decel": 19.0, "max_yaw_rate": 1.6,
			"yaw_response": 6.0, "grip": 5.5, "power_oversteer": 0.6, "max_slip_deg": 34.0,
			"drag": 0.10, "impact_keep": 0.7},
		"surfaces": {},
		"model": {}, "audio": {},
	},
	"tractor": {
		"controller": {"engine_accel": 9.0, "max_speed": 19.0, "grip": 7.0, "yaw_response": 8.0,
			"power_oversteer": 0.3, "max_slip_deg": 28.0, "impact_keep": 0.7},
		"surfaces": {
			"offroad": {"drag": 0.2, "top": 1.9},
			"sand": {"drag": 0.25, "top": 1.9},
		},
		"model": {}, "audio": {},
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
