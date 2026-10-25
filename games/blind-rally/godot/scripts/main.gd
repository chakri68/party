extends Node3D
## Navigator spike: wires one track, one car, the follow camera, the static
## map and the web bridge. Race rules here are hints only; the server owns
## checkpoint order and timing (spec §5, §8).
##
## Keys (local testing): WASD/arrows drive, G GPS marker, R reset to last CP
## (probe and editor only: in the room a reset is the server's call), M
## expand map, C camera rotates with car, -/= zoom, N mute, K impact kick,
## F dust and marks, L shadows, P debug autopilot, V cycle clouds,
## Y camera: top-down -> chase -> bonnet, skipping any not allowed.
##
## initSession config read here: assists.liveMarker, keyboard, muted,
## reducedMotion, seed and clouds (weather; same seed = same sky for every
## team, and the same easter eggs), autopilot and eggs (debug only), camera ("topdown" | "chase" | "bonnet";
## default top-down), allowedCameras (a list of those names, default all
## three: a host setting or a sabotage can lock the Navigator to one view;
## Y only cycles through these, and a camera outside the list falls back to
## the first one in it).
##
## And from the room (client/navigator/host.ts): room (true: the server owns
## recovery, so R is dead, a fall out of the world asks for a reset instead
## of teleporting, and the debug HUD is hidden), checkpoints and holdMs (a
## reloaded Navigator mid-race goes back to the anchor of what the server
## counted, held that long), assists.tripMeter, assists.camera3d (false: the
## map-only view, spec §4.3; Nightmare), teamColor / teamNumber / teamShape
## (the livery), ghosts (shared stage: draw rivals from receiveGhostSnapshot).
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
var allowed_cameras: Array[int] = [0, 1, 2] ## FollowCamera.Mode values Y may pick
var eye_forest: EyeForest ## built the first time a perspective camera is used
var eggs: EasterEggs ## deer, birds, moose, campers...: seeded like the weather
var _pending_mode := -1
## In the room (initSession `room`): the server decides where the car goes.
var room := false
## assists.tripMeter. Godot draws no trip meter of its own (the room's TS
## chrome does); the debug HUD says when the assist is off.
var trip_meter := true
## assists.camera3d off: no 3D view at all, only the static map (spec §4.3).
var map_only := false
var team_number := 7
var team_color := Color("1f6fe0")
var team_shape := "circle"
var ghosts: GhostCars
var _server_frozen := false ## freeze / go from the room
var _hold_left := 0.0 ## seconds the car stays held after a server reset
var _fell_pending := false ## out of the world, waiting for the server's reset
var _fell_retry := 0.0
var _map_only_ui: Control
var _map_layout := {} ## the map's anchors and offsets before map-only

## Seconds between "fell" requests while the server hasn't answered.
const FELL_RETRY_S := 3.0

const PALETTE := preload("res://assets/materials/vertex_color.tres")
## The eye-level sky and its haze, one family of colours: the depth fog is the
## horizon a shade darker, so far trees sink into something slightly denser
## than the sky behind them, and the treeline ring is drawn in exactly the fog.
const SKY_TOP := Color(0.36, 0.52, 0.72)
const SKY_HORIZON := Color(0.78, 0.83, 0.86)
const FOG := Color(0.69, 0.74, 0.77)


func _ready() -> void:
	car.reset_to(track.get_spawn().global_transform)
	cam.snap()
	autopilot.setup(track, car)
	autopilot.process_physics_priority = -1 # decide before the car moves
	weather.car = car
	weather.bounds = track.bounds
	weather.register(PALETTE)
	for m in track.world_materials():
		weather.register(m)
	# Locally there's no session yet: a random sky, light cloud. initSession
	# replaces both.
	weather.configure(randi(), 0.4)
	eggs = EasterEggs.new()
	eggs.name = "EasterEggs"
	add_child(eggs)
	eggs.setup(track, car)
	eggs.configure(weather.seed_value)
	ghosts = GhostCars.new()
	ghosts.name = "Ghosts"
	ghosts.car = car
	ghosts.weather = weather
	add_child(ghosts)
	bridge.car = car
	bridge.session_started.connect(_on_session)
	bridge.race_event.connect(_on_race_event)
	bridge.ghost_received.connect(ghosts.receive)
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
	cam.perspective_env = _perspective_env()
	# The map is one render of the baked forest; a camera switch that lands
	# before it (an early initSession) waits, so it can't hide those chunks
	# from it.
	_build_map_only_ui()
	await map.render_static_map(track)
	if _pending_mode >= 0:
		set_camera_mode(_pending_mode)
	if map_only:
		set_map_only(true)


## The eye-level modes need what top-down never shows: a sky above the
## treeline and fog to hide where the world stops. Only their camera gets
## it (Camera3D.environment), so the top-down view and the map are untouched.
func _perspective_env() -> Environment:
	var we := track.get_node_or_null("Environment") as WorldEnvironment
	var env: Environment = we.environment.duplicate() if we and we.environment else Environment.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = SKY_TOP
	sky_mat.sky_horizon_color = SKY_HORIZON
	sky_mat.ground_horizon_color = FOG
	sky_mat.ground_bottom_color = FOG.darkened(0.3)
	sky_mat.sun_angle_max = 20.0
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_32
	sky.process_mode = Sky.PROCESS_MODE_QUALITY # static sky: radiance once, not per frame
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	# Lighting stays colour-ambient as before; the sky is only a backdrop.
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	# Starts closer than the forest LOD swap (EyeForest.NEAR_R, 50 m), so
	# the swap happens in haze; total just behind the treeline ring (106 m),
	# and the far plane (118 m) is only a little past that.
	env.fog_light_color = FOG
	env.fog_depth_begin = 24.0
	env.fog_depth_end = 108.0
	env.fog_depth_curve = 1.25
	env.fog_density = 1.0
	env.fog_sky_affect = 0.0
	env.fog_aerial_perspective = 0.0
	return env


const CAMERA_MODES := ["topdown", "chase", "bonnet"]


## Switches the Navigator's view. A mode outside allowed_cameras is refused
## (returns false). Perspective modes swap the forest for EyeForest and the
## mist for its ground-hugging form; top-down swaps back.
func set_camera_mode(m: int) -> bool:
	if not allowed_cameras.has(m):
		return false
	if map.render_count == 0:
		_pending_mode = m
		return true
	_pending_mode = -1
	cam.set_mode(m)
	var eye := cam.mode != FollowCamera.Mode.TOP_DOWN
	if eye and eye_forest == null:
		eye_forest = EyeForest.new()
		eye_forest.name = "EyeForest"
		eye_forest.fog_color = FOG
		add_child(eye_forest)
		eye_forest.build(track, PALETTE, weather)
	if eye_forest:
		eye_forest.visible = eye
	var forest := track.get_node_or_null("Forest")
	if forest:
		for sc in forest.get_children():
			if sc is Scatter:
				(sc as Scatter).set_drawn(not eye)
	weather.eye_level = eye
	return true


## Y: the next allowed camera after the current one.
func cycle_camera() -> void:
	if map_only:
		return
	for step in range(1, 4):
		var m := (cam.mode + step) % 3
		if allowed_cameras.has(m):
			set_camera_mode(m)
			return


## Locks the Navigator to these modes (names as in CAMERA_MODES). Unknown
## names are ignored; an empty result means all three. If the current view
## isn't allowed any more, it moves to the first allowed one.
func set_allowed_cameras(names: Array) -> void:
	var out: Array[int] = []
	for n in names:
		var i := CAMERA_MODES.find(String(n))
		if i >= 0 and not out.has(i):
			out.append(i)
	if out.is_empty():
		out = [0, 1, 2]
	out.sort()
	allowed_cameras = out
	var now := _pending_mode if _pending_mode >= 0 else int(cam.mode)
	if not out.has(now):
		set_camera_mode(out[0])


func _physics_process(dt: float) -> void:
	if not finished:
		race_time += dt
	_hold_left = maxf(0.0, _hold_left - dt)
	car.frozen = _server_frozen or _hold_left > 0.0
	# Fell out of the world somehow. Locally: put it back where it would reset
	# to. In the room that teleport would be one the server never authorised
	# (it'd refuse every snapshot after it), so park the car and ask; the
	# server's `reset` event does the move.
	var p := car.global_position
	if _fell_pending:
		_fell_retry -= dt
		if _fell_retry <= 0.0:
			_fell_retry = FELL_RETRY_S
			bridge.emit_physics_event({"kind": "fell"})
	elif p.y < track.height_at(p.x, p.z) - 5.0:
		if room:
			_fell_out()
		else:
			recover()


func _fell_out() -> void:
	_fell_pending = true
	_fell_retry = 0.0
	car.velocity = Vector3.ZERO
	car.forward_speed = 0.0
	car.set_physics_process(false)


func _process(_dt: float) -> void:
	if eye_forest and eye_forest.visible:
		eye_forest.follow(cam, car.global_position.y)
	hud.visible = not room
	if not hud.visible:
		return
	hud.text = "%d fps\n%3.0f km/h  %s\ntrip %4.0f m%s\nCP %d/%d%s\nheading %s\nGPS %s   bridge %s\nsound %s%s" % [
		Engine.get_frames_per_second(), absf(car.forward_speed) * 3.6, car.surface,
		car.distance_travelled, "" if trip_meter else " (assist off)", checkpoints_passed, track.get_checkpoints().size(),
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
		KEY_R:
			if not room:
				recover()
		KEY_M:
			if not map_only:
				_toggle_map()
		KEY_C: cam.rotate_with_car = not cam.rotate_with_car
		KEY_MINUS: cam.zoom(1.15)
		KEY_EQUAL: cam.zoom(1.0 / 1.15)
		KEY_N: audio.muted = not audio.muted
		KEY_K: cam.kick_enabled = not cam.kick_enabled
		KEY_F: fx.enabled = not fx.enabled
		KEY_P: set_autopilot(not autopilot.enabled)
		KEY_Y: cycle_camera()
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


## Back to the anchor after `checkpoint` checkpoints, or after Godot's own
## count when that's -1 (the probe's reset button, R, a local fall-out). With
## a number it's the server's count and it becomes ours: a gate the server
## refused has to be driven through again.
func recover(checkpoint := -1) -> void:
	recoveries += 1
	if checkpoint >= 0:
		checkpoints_passed = clampi(checkpoint, 0, track.get_checkpoints().size())
		bridge.checkpoint_hint = checkpoints_passed
	_place_on_anchor()


func _place_on_anchor() -> void:
	_fell_pending = false
	car.set_physics_process(true)
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
	room = bool(cfg.get("room", false))
	var assists: Dictionary = cfg["assists"] if cfg.get("assists") is Dictionary else {}
	_apply_assists(assists, true)
	if cfg.get("teamColor") is String:
		team_color = Color.from_string(cfg["teamColor"], team_color)
		team_number = int(cfg["teamNumber"]) if (cfg.get("teamNumber") is float or cfg.get("teamNumber") is int) else team_number
		team_shape = CarPaint.valid_shape(String(cfg.get("teamShape", CarPaint.shape_for(cfg["teamColor"]))))
		CarPaint.apply(car, team_color, team_number, team_shape)
		ghosts.own_team = team_number
	ghosts.enabled = bool(cfg.get("ghosts", true))
	if not ghosts.enabled:
		ghosts.clear()
	# A reloaded Navigator mid-race: back to the anchor of what the server
	# counted, or it'd refuse every snapshot from wherever Godot spawned.
	if cfg.get("checkpoints") is float or cfg.get("checkpoints") is int:
		checkpoints_passed = clampi(int(cfg["checkpoints"]), 0, track.get_checkpoints().size())
		bridge.checkpoint_hint = checkpoints_passed
		finished = false
		_place_on_anchor()
		hold(float(cfg.get("holdMs", 0.0)) / 1000.0)
	car.keyboard_enabled = bool(cfg.get("keyboard", false))
	audio.muted = bool(cfg.get("muted", audio.muted))
	if cfg.has("reducedMotion"):
		cam.kick_enabled = not bool(cfg["reducedMotion"])
	# Weather: the room picks the seed so every team gets the same sky.
	var sky_seed := int(cfg["seed"]) if (cfg.get("seed") is float or cfg.get("seed") is int) else randi()
	weather.configure(sky_seed, float(cfg.get("clouds", 0.0)))
	# Same seed, same surprises. `eggs` is a debug override for tools and
	# tests ({"deer": true} or {"all": false}), like autopilot.
	eggs.force = cfg["eggs"] if cfg.get("eggs") is Dictionary else {}
	eggs.configure(sky_seed)
	set_autopilot(bool(cfg.get("autopilot", false)))
	set_allowed_cameras(cfg["allowedCameras"] if cfg.get("allowedCameras") is Array else [])
	if cfg.has("camera"):
		var want := maxi(CAMERA_MODES.find(String(cfg["camera"])), 0)
		if not set_camera_mode(want):
			set_camera_mode(allowed_cameras[0])


func _on_race_event(ev: Dictionary) -> void:
	match String(ev.get("kind", "")):
		"reset":
			var n: Variant = ev.get("checkpoint")
			recover(int(n) if (n is float or n is int) else -1)
			hold(float(ev.get("holdMs", 0.0)) / 1000.0)
		"freeze":
			_server_frozen = true
			car.frozen = true
		"go":
			_server_frozen = false
			car.frozen = _hold_left > 0.0
		"neutral": car.neutralize()
		"assists": _apply_assists(ev)
		"autopilot": set_autopilot(bool(ev.get("on", false))) # debug, the probe's auto-drive
		"weather": weather.configure(int(ev.get("seed", weather.seed_value)), float(ev.get("clouds", weather.clouds)))


## Keeps the car held for `seconds` (a server reset's holdMs), whatever
## freeze / go says meanwhile.
func hold(seconds: float) -> void:
	if seconds > 0.0:
		_hold_left = maxf(_hold_left, seconds)
		car.frozen = true


## liveMarker, tripMeter, camera3d. A session starts from the defaults (no
## marker, trip meter on, 3D on); an `assists` event changes only what it names.
func _apply_assists(a: Dictionary, fresh := false) -> void:
	map.gps_enabled = bool(a.get("liveMarker", false if fresh else map.gps_enabled))
	trip_meter = bool(a.get("tripMeter", true if fresh else trip_meter))
	set_map_only(not bool(a.get("camera3d", true if fresh else not map_only)))


## Spec §4.3's 3D-camera-off: the root viewport stops drawing 3D altogether
## and the static map takes the screen, centred, at a fixed size. Nothing
## about that layout depends on the car. The car still drives, sounds and
## sends snapshots; only the Navigator's eyes are gone.
func set_map_only(on: bool) -> void:
	map_only = on
	if map.render_count == 0:
		return # _ready applies it once the map exists; the map render needs the 3D world
	get_viewport().disable_3d = on
	_map_only_ui.visible = on
	if on:
		if _map_layout.is_empty():
			_map_layout = {"al": map.anchor_left, "at": map.anchor_top, "ar": map.anchor_right, "ab": map.anchor_bottom,
				"ol": map.offset_left, "ot": map.offset_top, "or": map.offset_right, "ob": map.offset_bottom}
		_layout_map_only()
	elif not _map_layout.is_empty():
		var l := _map_layout
		map.anchor_left = l.al
		map.anchor_top = l.at
		map.anchor_right = l.ar
		map.anchor_bottom = l.ab
		map.offset_left = l.ol
		map.offset_top = l.ot
		map.offset_right = l.or
		map.offset_bottom = l.ob
		_map_layout = {}
		_map_expanded = false


func _layout_map_only() -> void:
	if not map_only:
		return
	var vs := get_viewport().get_visible_rect().size
	var side := maxf(minf(vs.x, vs.y - 40.0) - 24.0, 120.0)
	map.anchor_left = 0.5
	map.anchor_right = 0.5
	map.anchor_top = 0.5
	map.anchor_bottom = 0.5
	map.offset_left = -side * 0.5
	map.offset_right = side * 0.5
	map.offset_top = -side * 0.5 + 16.0
	map.offset_bottom = side * 0.5 + 16.0


func _build_map_only_ui() -> void:
	var ui := map.get_parent()
	var back := Control.new()
	back.name = "MapOnly"
	back.set_anchors_preset(Control.PRESET_FULL_RECT)
	back.mouse_filter = Control.MOUSE_FILTER_IGNORE
	back.visible = false
	var bg := ColorRect.new()
	bg.name = "Backdrop"
	bg.color = Color(0.09, 0.11, 0.1)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	back.add_child(bg)
	var note := Label.new()
	note.name = "Note"
	note.text = "MAP ONLY  ·  no 3D camera"
	note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	note.set_anchors_preset(Control.PRESET_CENTER_TOP)
	note.offset_left = -200
	note.offset_right = 200
	note.offset_top = 6
	note.offset_bottom = 34
	var ls := LabelSettings.new()
	ls.font_size = 18
	ls.font_color = Color(0.95, 0.75, 0.3)
	ls.outline_size = 4
	ls.outline_color = Color(0, 0, 0, 0.8)
	note.label_settings = ls
	back.add_child(note)
	ui.add_child(back)
	ui.move_child(back, 0) # under everything: the map, and the probe's HUD
	_map_only_ui = back
	get_viewport().size_changed.connect(_layout_map_only)


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
