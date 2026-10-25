extends Node3D
## Navigator spike: wires one track, one car, the follow camera, the static
## map and the web bridge. Race rules here are hints only; the server owns
## checkpoint order and timing (spec §5, §8).
##
## Keys (local testing): WASD/arrows drive, G GPS marker, R reset to last CP,
## M expand map, C camera rotates with car, -/= zoom.

@onready var track: Track = $Track
@onready var car: CarController = $Car
@onready var cam: FollowCamera = $Camera
@onready var map: MapController = $UI/Map
@onready var hud: Label = $UI/Hud
@onready var bridge: WebBridge = $WebBridge

var checkpoints_passed := 0
var finished := false
var _map_expanded := false
var _map_small := Rect2()


func _ready() -> void:
	car.reset_to(track.get_spawn().global_transform)
	cam.snap()
	bridge.car = car
	bridge.session_started.connect(_on_session)
	bridge.race_event.connect(_on_race_event)
	track.checkpoint_entered.connect(_on_checkpoint)
	track.finish_entered.connect(_on_finish)
	car.impact.connect(func(strength: float, _who: Object) -> void:
		bridge.emit_physics_event({"kind": "impact", "strength": snappedf(strength, 0.1)}))
	map.car = car
	_map_small = Rect2(map.offset_left, map.offset_top, map.offset_right, map.offset_bottom)
	map.render_static_map(track)


func _physics_process(_dt: float) -> void:
	# Fell out of the world somehow: put it back where it would reset to.
	if car.global_position.y < -5.0:
		recover()


func _process(_dt: float) -> void:
	hud.text = "%d fps\n%3.0f km/h  %s\ntrip %4.0f m\nCP %d/%d%s\nheading %s\nGPS %s   bridge %s" % [
		Engine.get_frames_per_second(), absf(car.forward_speed) * 3.6, car.surface,
		car.distance_travelled, checkpoints_passed, track.get_checkpoints().size(),
		"  FINISHED" if finished else "", _compass(car.global_rotation.y),
		"on" if map.gps_enabled else "off", "up" if bridge.connected else "-",
	]


func _unhandled_key_input(e: InputEvent) -> void:
	var k := e as InputEventKey
	if not k.pressed or k.echo:
		return
	match k.physical_keycode:
		KEY_G: map.gps_enabled = not map.gps_enabled
		KEY_R: recover()
		KEY_M: _toggle_map()
		KEY_C: cam.rotate_with_car = not cam.rotate_with_car
		KEY_MINUS: cam.zoom(1.15)
		KEY_EQUAL: cam.zoom(1.0 / 1.15)


func recover() -> void:
	car.reset_to(track.recovery_for(checkpoints_passed).global_transform)
	cam.snap()


func _on_checkpoint(index: int, body: Node3D) -> void:
	if body != car or index != checkpoints_passed + 1:
		return # out-of-order gates count for nothing, same as the server
	checkpoints_passed = index
	bridge.checkpoint_hint = index
	bridge.emit_physics_event({"kind": "cp", "checkpointId": index})


func _on_finish(body: Node3D) -> void:
	if body != car or checkpoints_passed < track.get_checkpoints().size() or finished:
		return
	finished = true
	bridge.emit_physics_event({"kind": "finish"})


func _on_session(cfg: Dictionary, _seat: String) -> void:
	var assists: Dictionary = cfg.get("assists", {})
	map.gps_enabled = bool(assists.get("liveMarker", false))
	car.keyboard_enabled = bool(cfg.get("keyboard", false))


func _on_race_event(ev: Dictionary) -> void:
	match String(ev.get("kind", "")):
		"reset": recover()
		"freeze": car.frozen = true
		"go": car.frozen = false
		"neutral": car.neutralize()
		"assists": map.gps_enabled = bool(ev.get("liveMarker", map.gps_enabled))


func _toggle_map() -> void:
	_map_expanded = not _map_expanded
	if _map_expanded:
		var vs := get_viewport().get_visible_rect().size
		var side := minf(vs.x, vs.y) - 24.0
		map.offset_left = -side - 12.0
		map.offset_bottom = 12.0 + side
	else:
		map.offset_left = _map_small.position.x
		map.offset_bottom = _map_small.size.y


func _compass(yaw: float) -> String:
	# yaw 0 faces -Z, which the map draws as north (up).
	var deg := fposmod(-rad_to_deg(yaw), 360.0)
	const NAMES := ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
	return "%s %03.0f" % [NAMES[int(round(deg / 45.0)) % 8], deg]
