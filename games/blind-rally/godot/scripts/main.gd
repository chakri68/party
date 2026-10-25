extends Node3D
## Navigator spike: wires one track, one car, the follow camera, the static
## map and the web bridge. Race rules here are hints only; the server owns
## checkpoint order and timing (spec §5, §8).
##
## Keys (local testing): WASD/arrows drive, G GPS marker, R reset to last CP,
## M expand map, C camera rotates with car, -/= zoom, N mute, K impact kick,
## F dust and marks, L shadows, P debug autopilot, V cycle clouds.
##
## initSession config read here: assists.liveMarker, keyboard, muted,
## reducedMotion, seed and clouds (weather; same seed = same sky for every
## team), autopilot (debug only).
##
## Phones (web on Android/iOS) start with shadows off and half the dust.
## Audio waits for the first tap or key press, as browsers require.

@onready var track: Track = $Track
@onready var car: CarController = $Car
@onready var cam: FollowCamera = $Camera
@onready var map: MapController = $UI/Map
@onready var hud: Label = $UI/Hud
@onready var bridge: WebBridge = $WebBridge
@onready var fx: CarFx = $Car/Fx
@onready var audio: CarAudio = $Car/Audio
@onready var weather: Weather = $Weather
@onready var autopilot: Autopilot = $Autopilot

var checkpoints_passed := 0
var finished := false
var is_phone := false
var _map_expanded := false
var _map_small := Rect2()
var recoveries := 0 ## resets so far, for tests and the autopilot's report card
var race_time := 0.0 ## physics seconds since spawn, until the finish


func _ready() -> void:
	car.reset_to(track.get_spawn().global_transform)
	cam.snap()
	autopilot.setup(track, car)
	autopilot.process_physics_priority = -1 # decide before the car moves
	weather.car = car
	weather.bounds = track.bounds
	# Locally there's no session yet: a random sky, light cloud. initSession
	# replaces both.
	weather.configure(randi(), 0.4)
	bridge.car = car
	bridge.session_started.connect(_on_session)
	bridge.race_event.connect(_on_race_event)
	track.checkpoint_entered.connect(_on_checkpoint)
	track.finish_entered.connect(_on_finish)
	car.impact.connect(func(strength: float, _who: Object) -> void:
		cam.kick(strength, car.last_impact_normal)
		bridge.emit_physics_event({"kind": "impact", "strength": snappedf(strength, 0.1)}))
	is_phone = OS.has_feature("web_android") or OS.has_feature("web_ios") or OS.has_feature("mobile")
	if is_phone:
		set_shadows(false)
		fx.density = 0.5
	map.car = car
	_map_small = Rect2(map.offset_left, map.offset_top, map.offset_right, map.offset_bottom)
	map.render_static_map(track)


func _physics_process(dt: float) -> void:
	if not finished:
		race_time += dt
	# Fell out of the world somehow: put it back where it would reset to.
	var p := car.global_position
	if p.y < track.height_at(p.x, p.z) - 5.0:
		recover()


func _process(_dt: float) -> void:
	hud.text = "%d fps\n%3.0f km/h  %s\ntrip %4.0f m\nCP %d/%d%s\nheading %s\nGPS %s   bridge %s\nsound %s%s" % [
		Engine.get_frames_per_second(), absf(car.forward_speed) * 3.6, car.surface,
		car.distance_travelled, checkpoints_passed, track.get_checkpoints().size(),
		"  FINISHED" if finished else "", _compass(car.global_rotation.y),
		"on" if map.gps_enabled else "off", "up" if bridge.connected else "-",
		"muted" if audio.muted else ("on" if audio.started else "tap to start"),
		"\nAUTOPILOT" if autopilot.enabled else "",
	]


## Browsers only allow audio after a gesture; any press counts.
func _input(e: InputEvent) -> void:
	if audio.started:
		return
	if (e is InputEventKey and e.pressed) or (e is InputEventMouseButton and e.pressed) or (e is InputEventScreenTouch and e.pressed):
		audio.start()


func set_shadows(on: bool) -> void:
	var sun := track.get_node_or_null("Sun") as DirectionalLight3D
	if sun:
		sun.shadow_enabled = on


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
		KEY_N: audio.muted = not audio.muted
		KEY_K: cam.kick_enabled = not cam.kick_enabled
		KEY_F: fx.enabled = not fx.enabled
		KEY_P: set_autopilot(not autopilot.enabled)
		KEY_V: weather.configure(weather.seed_value, fposmod(snappedf(weather.clouds, 0.5) + 0.5, 1.5))
		KEY_L:
			var sun := track.get_node_or_null("Sun") as DirectionalLight3D
			if sun:
				set_shadows(not sun.shadow_enabled)


## Debug autopilot on or off. While it's on it owns the car: remote control
## from the bridge is dropped so the two don't fight over set_control().
func set_autopilot(on: bool) -> void:
	autopilot.enabled = on
	bridge.forward_control = not on


func recover() -> void:
	recoveries += 1
	car.reset_to(track.recovery_for(checkpoints_passed).global_transform)
	cam.snap()
	fx.reset_trail()


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
	audio.muted = bool(cfg.get("muted", audio.muted))
	if cfg.has("reducedMotion"):
		cam.kick_enabled = not bool(cfg["reducedMotion"])
	# Weather: the room picks the seed so every team gets the same sky.
	var sky_seed := int(cfg["seed"]) if (cfg.get("seed") is float or cfg.get("seed") is int) else randi()
	weather.configure(sky_seed, float(cfg.get("clouds", 0.0)))
	set_autopilot(bool(cfg.get("autopilot", false)))


func _on_race_event(ev: Dictionary) -> void:
	match String(ev.get("kind", "")):
		"reset": recover()
		"freeze": car.frozen = true
		"go": car.frozen = false
		"neutral": car.neutralize()
		"assists": map.gps_enabled = bool(ev.get("liveMarker", map.gps_enabled))
		"autopilot": set_autopilot(bool(ev.get("on", false))) # debug, the probe's auto-drive
		"weather": weather.configure(int(ev.get("seed", weather.seed_value)), float(ev.get("clouds", weather.clouds)))


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
