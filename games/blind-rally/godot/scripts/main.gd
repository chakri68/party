extends Node3D
## Navigator spike: wires one track, one car, the follow camera, the static
## map and the web bridge. Race rules here are hints only; the server owns
## checkpoint order and timing (spec §5, §8).
##
## Which track: initSession.trackId. The stage scene is loaded once that's
## known (res://scenes/tracks/<id>.scn), so only the chosen stage is ever in
## memory. Before a session, or without one: `track_id` if a tool set it,
## then `?track=<id>` on the page URL (web) or `--track=<id>` after `--` on
## the command line, then DEFAULT_TRACK. On the web with a host page the
## session decides; HOST_WAIT_S without one and it's the fallback. A
## session naming another track than the one already loaded (only after
## that fallback) reloads the scene and carries the session over.
##
## Keys (local testing): WASD/arrows drive, G GPS marker (only where
## assists.liveMarker allows it; see live_marker_allowed), R reset to last CP
## (probe and editor only: in the room a reset is the server's call), M
## big map (tap or click the corner map too; Esc, a tap outside it or on its
## X closes it; a tap on it places the guess pin, see MapController), C camera
## rotates with car, -/= zoom, N mute, K impact kick, F dust and marks, L
## shadows, P debug autopilot, V cycle clouds, Y camera: top-down -> chase -> bonnet, skipping any not allowed.
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
## (the livery), ghosts (shared stage: draw rivals from receiveGhostSnapshot),
## pins ({pin, trail}: a reloaded Navigator's own guess pins; a `pins` race
## event replaces them too). Placing or clearing one emits {kind: "pin", x, z}
## or {kind: "pin", clear: true} on the bridge.
##
## The compass (NavCompass, top-left) is the heading indicator of spec §4.2:
## own car, 3D view only, hidden with it in map-only mode.
##
## Phones (web on Android/iOS) start with shadows off and half the dust.
## Audio waits for the first tap or key press, as browsers require.

var track: Track ## null until the stage is loaded; see track_ready
@onready var car: CarController = $Car
@onready var cam: FollowCamera = $Camera
@onready var map: MapController = $UI/Map
@onready var hud: Label = $UI/Hud
@onready var bridge: WebBridge = $WebBridge
@onready var fx: CarFx = $Car/Fx
@onready var audio: CarAudio = $Car/Audio
@onready var weather: Weather = $Weather
@onready var autopilot: Autopilot = $Autopilot

signal track_ready

const DEFAULT_TRACK := "pine_panic"
const TRACK_DIR := "res://scenes/tracks/"
## Web: how long to wait for a host page (and its initSession) before
## loading the fallback track.
const HOST_WAIT_S := 3.0
## Web, host attached: how long its initSession may take.
const SESSION_WAIT_S := 12.0

## Set before the node enters the tree to pick the stage without a session
## (tools, tests). Empty: see the header.
@export var track_id := ""
## A session that arrived for another track than the one loaded; the
## reloaded scene picks it up.
static var _carried_session := {}

var checkpoints_passed := 0
var finished := false
var is_phone := false
## The big map: the corner map grown over most of the screen. Not a pause:
## the car drives, the 3D view keeps drawing (at OPEN_3D_SCALE, since most of
## it is covered), and the bridge hears {kind: "map", open} each way.
var map_expanded := false
var _map_corner := {} ## the corner map's anchors and offsets
var _map_tween: Tween
var _map_scrim: ColorRect
var _3d_scale := 1.0 ## the root viewport's 3D scale before the map opened
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
## assists.liveMarker: whether G may show the live marker at all. True only
## before any session (a bare local run, where G is a debug key); every
## session sets it, and with it off G does nothing (Classic, Nightmare).
var live_marker_allowed := true
## assists.camera3d off: no 3D view at all, only the static map (spec §4.3).
var map_only := false
var team_number := 7
var team_color := Color("1f6fe0")
var team_shape := "circle"
var ghosts: GhostCars
## The heading indicator (spec §4.2), top-left over the 3D view.
var compass: NavCompass
var _server_frozen := false ## freeze / go from the room
var _hold_left := 0.0 ## seconds the car stays held after a server reset
var _fell_pending := false ## out of the world, waiting for the server's reset
var _fell_retry := 0.0
var _map_only_ui: Control
var _map_layout := {} ## the map's anchors and offsets before map-only

## Seconds between "fell" requests while the server hasn't answered.
const FELL_RETRY_S := 3.0
## Open / close animation, seconds.
const MAP_ANIM_S := 0.16
## Margin round the big map, CSS pixels (MapController.css_px).
const MAP_MARGIN_PX := 10.0
## 3D resolution while the big map is open: it covers 60-75% of the screen,
## and what's left is dimmed, so nobody misses the pixels.
const OPEN_3D_SCALE := 0.5

const PALETTE := preload("res://assets/materials/vertex_color.tres")
var biome: Biome ## the loaded track's (Track.get_biome())
var _session_seen := false
var _pending_session: Array = [] ## [cfg, seat] that came before the track did


func _ready() -> void:
	bridge.car = car
	bridge.session_started.connect(_on_session)
	var want := track_id
	if want == "":
		want = _requested_track()
	if not _carried_session.is_empty():
		want = String(_carried_session.cfg.get("trackId", want))
	if want == "" and OS.has_feature("web"):
		want = await _wait_for_session_track()
	if track == null:
		_load_track(want)


## --track=<id> after `--`, or ?track=<id> on the page. "" if neither.
func _requested_track() -> String:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--track="):
			return a.trim_prefix("--track=")
	if OS.has_feature("web"):
		var q: Variant = JavaScriptBridge.eval("new URLSearchParams(location.search).get('track') || ''", true)
		if q is String:
			return q
	return ""


## Web: the host page's session names the track. Gives up (returns "") after
## HOST_WAIT_S without a host, or SESSION_WAIT_S with one.
func _wait_for_session_track() -> String:
	var t := 0.0
	while not _session_seen:
		await get_tree().process_frame
		t += get_process_delta_time()
		if t > (SESSION_WAIT_S if bridge.connected else HOST_WAIT_S):
			break
	if _pending_session.is_empty():
		return ""
	return String((_pending_session[0] as Dictionary).get("trackId", ""))


static func track_path(id: String) -> String:
	return TRACK_DIR + id + ".scn"


## Ids with a scene in the build.
static func available_tracks() -> PackedStringArray:
	var out := PackedStringArray()
	for f in ResourceLoader.list_directory(TRACK_DIR):
		if f.ends_with(".scn"):
			out.append(f.get_basename())
	return out


## Loads one stage and wires everything that hangs off it. Unknown ids fall
## back to DEFAULT_TRACK (with a warning), so a typo can't leave a blank page.
func _load_track(id: String) -> void:
	if id == "" or not id.is_valid_ascii_identifier() or not ResourceLoader.exists(track_path(id)):
		if id != "":
			push_warning("no track %s; loading %s" % [id, DEFAULT_TRACK])
		id = DEFAULT_TRACK
	var scene: PackedScene = load(track_path(id))
	track = scene.instantiate() as Track
	track.name = "Track"
	add_child(track)
	move_child(track, 0)
	track_id = track.track_id
	biome = track.get_biome()
	_setup_track()
	track_ready.emit()
	if not _carried_session.is_empty():
		var s := _carried_session
		_carried_session = {}
		_on_session(s.cfg, s.seat)
	for s in _pending_session:
		_on_session(s[0], s[1])
	_pending_session.clear()


func _setup_track() -> void:
	car.reset_to(track.get_spawn().global_transform)
	cam.snap()
	autopilot.setup(track, car)
	autopilot.process_physics_priority = -1 # decide before the car moves
	weather.car = car
	weather.bounds = track.bounds
	weather.set_biome(biome)
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
	bridge.race_event.connect(_on_race_event)
	bridge.ghost_received.connect(ghosts.receive)
	track.checkpoint_entered.connect(_on_checkpoint)
	track.finish_entered.connect(_on_finish)
	car.impact.connect(func(strength: float, _who: Object) -> void:
		cam.kick(strength, car.last_impact_normal)
		bridge.emit_physics_event({"kind": "impact", "strength": snappedf(strength, 0.1)}))
	is_phone = OS.has_feature("web_android") or OS.has_feature("web_ios") or OS.has_feature("mobile")
	fx.dust_road = biome.dust_road
	fx.dust_off = biome.dust_off
	fx.plume = biome.plume
	fx.grit = biome.grit
	fx.marks = biome.marks
	if is_phone:
		set_shadows(false)
		fx.density = 0.5
	map.car = car
	_build_compass()
	_map_corner = _layout_of(map)
	map.tapped.connect(_on_map_tapped)
	map.pin_changed.connect(func(at: Variant) -> void:
		bridge.emit_physics_event({"kind": "pin", "clear": true} if at == null else {"kind": "pin", "x": snappedf(at.x, 0.1), "z": snappedf(at.y, 0.1)}))
	cam.perspective_env = _perspective_env()
	cam.persp_far = biome.persp_far
	# The map is one render of the baked forest; a camera switch that lands
	# before it (an early initSession) waits, so it can't hide those chunks
	# from it.
	_build_map_only_ui()
	_build_map_scrim()
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
	sky_mat.sky_top_color = biome.sky_top
	sky_mat.sky_horizon_color = biome.sky_horizon
	sky_mat.ground_horizon_color = biome.fog
	sky_mat.ground_bottom_color = biome.fog.darkened(0.3)
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
	# Forest: starts closer than the LOD swap (EyeForest near_r, 50 m), so
	# the swap happens in haze; total just behind the treeline ring (106 m),
	# and the far plane (118 m) is only a little past that. Other biomes
	# keep the same order of things at their own distances.
	env.fog_light_color = biome.fog
	env.fog_depth_begin = biome.fog_begin
	env.fog_depth_end = biome.fog_end
	env.fog_depth_curve = biome.fog_curve
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
		eye_forest.fog_color = biome.fog
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
	if track == null:
		return
	if not finished:
		race_time += dt
	_hold_left = maxf(0.0, _hold_left - dt)
	car.frozen = _server_frozen or _hold_left > 0.0
	# Fell out of the world somehow, or off a cliff (Track.fall_y). Locally:
	# put it back where it would reset to. In the room that teleport would be
	# one the server never authorised (it'd refuse every snapshot after it),
	# so park the car and ask; the server's `reset` event does the move.
	var p := car.global_position
	if _fell_pending:
		_fell_retry -= dt
		if _fell_retry <= 0.0:
			_fell_retry = FELL_RETRY_S
			bridge.emit_physics_event({"kind": "fell"})
	elif p.y < track.height_at(p.x, p.z) - 5.0 or p.y < track.fall_y:
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
	if track == null:
		return
	if eye_forest and eye_forest.visible:
		eye_forest.follow(cam, car.global_position.y)
	hud.visible = not room
	if not hud.visible:
		return
	hud.position.y = (compass.get_rect().end.y + 4.0) if compass.visible else 8.0
	hud.text = "%d fps\n%3.0f km/h  %s\ntrip %4.0f m%s\nCP %d/%d%s\nheading %s\nGPS %s   bridge %s\nsound %s%s" % [
		Engine.get_frames_per_second(), absf(car.forward_speed) * 3.6, car.surface,
		car.distance_travelled, "" if trip_meter else " (assist off)", checkpoints_passed, track.get_checkpoints().size(),
		"  FINISHED" if finished else "", NavCompass.heading_text(NavCompass.heading_deg(NavCompass.yaw_of(car.global_basis))),
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
	if track == null or not k.pressed or k.echo:
		return
	match k.physical_keycode:
		KEY_G:
			if live_marker_allowed:
				map.gps_enabled = not map.gps_enabled
		KEY_R:
			if not room:
				recover()
		KEY_M: toggle_map()
		KEY_ESCAPE: set_map_expanded(false)
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
	compass.snap()
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


func _on_session(cfg: Dictionary, seat: String) -> void:
	_session_seen = true
	if track == null:
		_pending_session.append([cfg, seat])
		return
	var session_track := String(cfg.get("trackId", track_id))
	if session_track != track_id and ResourceLoader.exists(track_path(session_track)) and session_track.is_valid_ascii_identifier():
		# Only after a fallback load: start again on the right stage.
		push_warning("session is for %s, %s is loaded: reloading" % [session_track, track_id])
		_carried_session = {"cfg": cfg, "seat": seat}
		get_tree().reload_current_scene.call_deferred()
		return
	room = bool(cfg.get("room", false))
	var assists: Dictionary = cfg["assists"] if cfg.get("assists") is Dictionary else {}
	_apply_assists(assists, true)
	if cfg.get("teamColor") is String:
		team_color = Color.from_string(cfg["teamColor"], team_color)
		team_number = int(cfg["teamNumber"]) if (cfg.get("teamNumber") is float or cfg.get("teamNumber") is int) else team_number
		team_shape = CarPaint.valid_shape(String(cfg.get("teamShape", CarPaint.shape_for(cfg["teamColor"]))))
		CarPaint.apply(car, team_color, team_number, team_shape)
		map.pin_color = team_color
		ghosts.own_team = team_number
	if cfg.get("pins") is Dictionary:
		map.restore_pins(cfg["pins"])
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
		"pins": map.restore_pins(ev)
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
	live_marker_allowed = bool(a.get("liveMarker", false if fresh else live_marker_allowed))
	map.gps_enabled = live_marker_allowed
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
	if on:
		set_map_expanded(false, false) # map only is already the big map
	get_viewport().disable_3d = on
	_map_only_ui.visible = on
	compass.visible = not on # a heading indicator for a view that isn't there
	map.detail = on
	map.crop = on
	map.expandable = not on
	if on:
		if _map_layout.is_empty():
			_map_layout = _layout_of(map)
		_layout_map_only()
	elif not _map_layout.is_empty():
		_apply_layout(map, _map_layout)
		_map_layout = {}


func _layout_map_only() -> void:
	if not map_only:
		return
	# The big map's shape (cropped to the course), centred, under the note.
	var vs := get_viewport().get_visible_rect().size
	var f := MapController.FRAME * 2.0
	var a := minf(map.content_aspect(), 1.0)
	var h := maxf(vs.y - 40.0 - 24.0, 120.0)
	var w := (h - f) / a + f
	if w > vs.x - 24.0:
		w = maxf(vs.x - 24.0, 120.0)
		h = (w - f) * a + f
	map.anchor_left = 0.5
	map.anchor_right = 0.5
	map.anchor_top = 0.5
	map.anchor_bottom = 0.5
	map.offset_left = -w * 0.5
	map.offset_right = w * 0.5
	map.offset_top = -h * 0.5 + 16.0
	map.offset_bottom = h * 0.5 + 16.0


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


func _layout_of(c: Control) -> Dictionary:
	return {"al": c.anchor_left, "at": c.anchor_top, "ar": c.anchor_right, "ab": c.anchor_bottom,
		"ol": c.offset_left, "ot": c.offset_top, "or": c.offset_right, "ob": c.offset_bottom}


func _apply_layout(c: Control, l: Dictionary) -> void:
	c.anchor_left = l.al
	c.anchor_top = l.at
	c.anchor_right = l.ar
	c.anchor_bottom = l.ab
	c.offset_left = l.ol
	c.offset_top = l.ot
	c.offset_right = l.or
	c.offset_bottom = l.ob


## Where a saved layout puts its control on the current screen.
func _rect_of(l: Dictionary) -> Rect2:
	var vs := get_viewport().get_visible_rect().size
	var p0 := Vector2(l.al * vs.x + l.ol, l.at * vs.y + l.ot)
	var p1 := Vector2(l.ar * vs.x + l.or, l.ab * vs.y + l.ob)
	return Rect2(p0, p1 - p0)


## Pins the map to a plain rect (top-left anchors), for the tween.
func _set_map_rect(r: Rect2) -> void:
	map.anchor_left = 0.0
	map.anchor_top = 0.0
	map.anchor_right = 0.0
	map.anchor_bottom = 0.0
	map.offset_left = r.position.x
	map.offset_top = r.position.y
	map.offset_right = r.end.x
	map.offset_bottom = r.end.y


## The big map: full height less a margin, as wide as the course's bounds
## make it (the empty strips of the square render are cropped), pinned to the
## right edge so it grows out of the corner map and leaves the widest strip
## of 3D view it can on the left. Nothing here depends on the car.
func _big_map_rect() -> Rect2:
	var vs := get_viewport().get_visible_rect().size
	var m := maxf(12.0, MAP_MARGIN_PX * map.css_px())
	var f := MapController.FRAME * 2.0
	var a := minf(map.content_aspect(), 1.0)
	var h := vs.y - m * 2.0
	var w := (h - f) / a + f
	if w > vs.x - m * 2.0:
		w = vs.x - m * 2.0
		h = (w - f) * a + f
	return Rect2(vs.x - m - w, (vs.y - h) * 0.5, w, h)


func toggle_map() -> void:
	set_map_expanded(not map_expanded)


## Opens or closes the big map. Refused in map-only mode (the map is the
## whole screen already) and before the map exists. Animated unless
## `animate` is false; either way the state flips now, so a quick second tap
## turns it round mid-flight.
func set_map_expanded(on: bool, animate := true) -> void:
	if on and (map_only or map.render_count == 0):
		return
	if on == map_expanded:
		return
	map_expanded = on
	if _map_tween:
		_map_tween.kill()
	var vp := get_viewport()
	var from := map.get_rect()
	_map_scrim.visible = true
	map.detail = false
	if on:
		_3d_scale = vp.scaling_3d_scale
		map.big = true
		_set_map_rect(from)
		var to := _big_map_rect()
		if animate:
			_map_tween = create_tween().set_parallel().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			_map_tween.tween_method(_set_map_rect, from, to, MAP_ANIM_S)
			_map_tween.tween_property(_map_scrim, "modulate:a", 1.0, MAP_ANIM_S)
			_map_tween.chain().tween_callback(_map_opened)
		else:
			_set_map_rect(to)
			_map_scrim.modulate.a = 1.0
			_map_opened()
	else:
		vp.scaling_3d_scale = _3d_scale
		var to := _rect_of(_map_corner)
		if animate:
			_map_tween = create_tween().set_parallel().set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			_map_tween.tween_method(_set_map_rect, from, to, MAP_ANIM_S)
			_map_tween.tween_property(_map_scrim, "modulate:a", 0.0, MAP_ANIM_S)
			_map_tween.chain().tween_callback(_map_closed)
		else:
			_map_closed()
	bridge.emit_physics_event({"kind": "map", "open": on})


func _map_opened() -> void:
	map.detail = true
	get_viewport().scaling_3d_scale = _3d_scale * OPEN_3D_SCALE


func _map_closed() -> void:
	map.big = false
	_map_scrim.visible = false
	_map_scrim.modulate.a = 0.0
	_apply_layout(map, _map_corner)


func _on_map_tapped() -> void:
	if not map_only:
		toggle_map()


## Dims the 3D view under the big map; a tap on it closes the map.
func _build_map_scrim() -> void:
	var s := ColorRect.new()
	s.name = "MapScrim"
	s.color = Color(0.02, 0.03, 0.02, 0.45)
	s.set_anchors_preset(Control.PRESET_FULL_RECT)
	s.mouse_filter = Control.MOUSE_FILTER_STOP
	s.visible = false
	s.modulate.a = 0.0
	s.gui_input.connect(func(e: InputEvent) -> void:
		var mb := e as InputEventMouseButton
		if mb and mb.button_index == MOUSE_BUTTON_LEFT and not mb.pressed:
			s.accept_event()
			set_map_expanded(false))
	var ui := map.get_parent()
	ui.add_child(s)
	ui.move_child(s, map.get_index())
	_map_scrim = s
	get_viewport().size_changed.connect(func() -> void:
		if map_expanded:
			if _map_tween:
				_map_tween.kill()
			_set_map_rect(_big_map_rect())
			_map_opened())


## Under the map in the UI, so the big map's scrim (which goes in at the
## map's index) dims it along with the 3D view.
func _build_compass() -> void:
	compass = NavCompass.new()
	compass.name = "Compass"
	compass.car = car
	var ui := map.get_parent()
	ui.add_child(compass)
	ui.move_child(compass, map.get_index())
	compass.snap()
