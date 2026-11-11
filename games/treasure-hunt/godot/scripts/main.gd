extends Node3D
## Puts a playable world together: terrain, sea, walls, the walker, the
## buggies (Fleet), the camera, and the hunt on top (caches, compass, the E prompt,
## the position stream). start_world() is the one way in. Locally (editor, desktop run,
## tests) _ready feeds it a fixture; on the web the bridge feeds it the
## session's layout, and hears world-ready back. Same seed twice does nothing, so a session that
## arrives twice builds once.

signal world_ready(ms: int)

## A body this far under the ground fell through: put it back on top.
const FALL_LIMIT := 5.0
## The sea is the edge (spec §4.4): ground this far under sea level is as
## deep as you go: waist-deep on foot (the capsule's 1.8 m tall), and up to
## the wheel hubs (0.48 m) in the buggy.
const SEA_WALK_DEPTH := 1.0
const SEA_DRIVE_DEPTH := 0.5
## Mirrors POS_HZ in shared/world.ts: where you are goes to the server this
## often, in countdown and hunting.
const POS_HZ := 10

@onready var walker: Walker = $Walker
@onready var rig: RigCamera = $Rig
@onready var avatar: PlayerAvatar = $Avatar
@onready var _debug: Label = $UI/Debug
@onready var bridge: WebBridge = $WebBridge

var field: TerrainField
var streamer: ChunkStreamer
var pieces: Pieces
var minor: MinorPoints
var world: Node3D ## everything built from the layout; rebuilt on a new seed
## What the streamer builds around: whichever body you're controlling.
var focus: Node3D
## Bodies the fall check watches: the walker and the local buggies (a
## puppet or a parked one is wherever the server says).
var watched: Array[Node3D] = []
## Every buggy, by vehicle id. Before the first vehicles list, the one
## standalone buggy, id "".
var fleet: Fleet
## The standalone buggy while there is one, else the one you're in.
var buggy: Buggy:
	get:
		var b: Buggy = fleet.get_buggy("") if fleet else null
		return b if b != null or avatar == null else avatar.buggy
## The round's phase, from setPhase. Walker and buggy take input only in
## hunting. Off-web there's no host to send one, so it starts as hunting and
## M1's free roam (and its tests) is unchanged; on the web it starts locked
## and waits for the view.
var phase: StringName = &"hunting"
var caches: Caches ## per world, like pieces
var compass: Compass
var prompt: PickupPrompt
## The other players. Not part of the world: a new seed keeps them, and
## their next snapshots move them onto it.
var remotes: Remotes
## My team's pins. Outside the world, like the fleet; the ground is set per world.
var pins: Pins
## The round's game time. Sits at 10:00, stopped, until a skyClock says
## otherwise (and always off-web), so the look is today's. Lamps and
## headlights listen on day_clock.dark_changed.
var day_clock: DayClock
## Photo clues, rendered in this world for the page. Outside the world like
## pins; the ground is set per world.
var photos: Photos
## Sun, moon, ambient, sky and fog, from day_clock every frame.
var daylight: Daylight
## F: your torch. It only lights the world while on (a spot on the camera).
var torch_on := false
## The sky's darkness as last heard from day_clock.
var dark := 0.0
## Engine, steps and the ambient bed. Quiet until the first key or click.
var hunt_audio: HuntAudio
## Ids already pinged, so the page's resends stay quiet.
## Replays after a reload or late join stay quiet for this long after world-ready.
const PING_SETTLE_S := 2.0
var _world_ready_at := -1
var _pinged_reveals := {}
var _pinged_claims := {}
## The lamps' state as last set: set_lamps only runs when it flips.
var _lamps_lit := false

var _seed := 0
var _pos_accum := 0.0
## Reveals and founds that came before there was ground to put them on (an
## iframe reload: the view re-sends them as soon as we say ready).
var _pending_reveals: Array[Dictionary] = []
var _pending_found: Array[String] = []


func _ready() -> void:
	_park(walker)
	fleet = Fleet.new()
	fleet.name = "Fleet"
	fleet.seaward = seaward.bind(SEA_DRIVE_DEPTH)
	# Puppets move before the avatar snaps a rider to its seat, so the seat
	# it streams is this frame's.
	fleet.process_physics_priority = -1
	add_child(fleet)
	walker.seaward = seaward.bind(SEA_WALK_DEPTH)
	_watch()
	avatar.setup(walker, fleet, rig)
	# Riding, the walker sits in the seat: the streamer and the stream follow it.
	avatar.mode_changed.connect(func(m: StringName) -> void: focus = avatar.buggy if m == &"driving" else walker)
	avatar.seat_asked.connect(bridge.emit_seat)
	avatar.unseated.connect(bridge.emit_unseat)
	bridge.vehicles_set.connect(fleet.apply)
	bridge.session_started.connect(_on_session)
	bridge.cache_revealed.connect(reveal_cache)
	bridge.cache_found.connect(found_cache)
	bridge.phase_set.connect(set_phase)
	avatar.claimed.connect(bridge.emit_claim)
	remotes = Remotes.new()
	remotes.name = "Remotes"
	add_child(remotes)
	bridge.roster_set.connect(remotes.set_roster)
	pins = Pins.new()
	pins.name = "Pins"
	add_child(pins)
	bridge.pins_set.connect(pins.apply)
	bridge.remote_moved.connect(_on_remote)
	day_clock = DayClock.new()
	day_clock.name = "DayClock"
	add_child(day_clock)
	daylight = Daylight.new()
	daylight.name = "Daylight"
	add_child(daylight)
	var env: Environment = $Environment.environment
	daylight.setup($Sun, $Moon, env, env.sky.sky_material)
	daylight.apply(day_clock.minute())
	bridge.sky_clock_set.connect(day_clock.set_clock)
	photos = Photos.new()
	photos.name = "Photos"
	add_child(photos)
	bridge.photos_set.connect(photos.set_list)
	photos.photo_ready.connect(bridge.emit_photo)
	# A listener that joins after the first frame misses the first dark_changed.
	day_clock.dark_changed.connect(_on_dark)
	_on_dark(DayClock.dark_at(day_clock.minute()))
	hunt_audio = HuntAudio.new()
	hunt_audio.name = "HuntAudio"
	add_child(hunt_audio)
	hunt_audio.prepare() # at load, behind the loader: synthesis is 100 ms or so of GDScript
	bridge.sound_set.connect(hunt_audio.set_sound)
	bridge.hot_cold_set.connect(hunt_audio.set_hot_cold)
	bridge.cache_revealed.connect(func(r: Dictionary) -> void:
		if not _pinged_reveals.has(r.id):
			_pinged_reveals[r.id] = true
			if _ping_settled():
				hunt_audio.ping(&"reveal"))
	# Only my team's finds chime; a taken cache still hides its crate, silently.
	bridge.cache_found_by.connect(func(id: String, mine: bool) -> void:
		if not _pinged_claims.has(id):
			_pinged_claims[id] = true
			if mine and _ping_settled():
				hunt_audio.ping(&"claim"))
	compass = Compass.new()
	compass.name = "Compass"
	$UI.add_child(compass)
	prompt = PickupPrompt.new()
	prompt.name = "Prompt"
	$UI.add_child(prompt)
	set_phase(&"generating" if OS.has_feature("web") else &"hunting")
	world_ready.connect(func(ms: int) -> void:
		_world_ready_at = Time.get_ticks_msec()
		bridge.emit_status({"kind": "world-ready", "ms": ms, "chunks": streamer.loaded_count(), "seed": _seed}))
	var n := _requested_layout()
	var path := "res://tests/fixtures/layout_%d.json" % n
	if n > 0 and FileAccess.file_exists(path):
		var layout: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
		if layout is Dictionary:
			start_world(layout)
			return
		push_error("main: %s isn't a layout" % path)
	# Web: wait for the host's session (start_world).


## --layout=<n> after `--`; 1 if there's none. On the web, 0: wait for the
## session (fixtures aren't in the web export, so there's no ?layout).
func _requested_layout() -> int:
	if OS.has_feature("web"):
		return 0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--layout="):
			return parse_layout_arg(a.trim_prefix("--layout="))
	return 1


## The n in --layout=<n>, or 1 (with a warning) if it isn't a fixture.
func parse_layout_arg(v: String) -> int:
	var n := v.to_int() if v.is_valid_int() else 0
	if FileAccess.file_exists("res://tests/fixtures/layout_%d.json" % n):
		return n
	push_warning("main: --layout=%s isn't a fixture, using layout 1" % v)
	return 1


## {layout} from the page. The same seed again (a resend) does nothing.
func _on_session(cfg: Dictionary) -> void:
	var layout: Variant = cfg.get("layout")
	if layout is Dictionary:
		start_world(layout)
	else:
		push_warning("main: a session with no layout")


## Builds the world for `layout` (the server's layout JSON, parsed). A second
## call with the same seed does nothing; a new seed tears down and rebuilds.
func start_world(layout: Dictionary) -> void:
	if not layout.has("seed") or not layout.has("macro"):
		push_error("main: start_world needs a layout with seed and macro")
		return
	var s := int(layout.seed)
	if world != null and s == _seed:
		return
	var t0 := Time.get_ticks_msec()
	_teardown()
	_seed = s
	field = TerrainField.from_layout(layout)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/ground.gdshader")

	world = Node3D.new()
	world.name = "World"
	add_child(world)
	var far := FarTerrain.new()
	far.build(field, mat)
	world.add_child(far)
	var water := Water.new()
	water.build()
	world.add_child(water)
	world.add_child(Bounds.new())
	streamer = ChunkStreamer.new()
	streamer.name = "Streamer"
	world.add_child(streamer)
	streamer.setup(field, mat)
	streamer.load_initial(field.spawn)
	# The field flattens each pad to padY, so the pieces stand on it.
	pieces = Pieces.new()
	pieces.name = "Pieces"
	world.add_child(pieces)
	pieces.build_all(layout)
	_lamps_lit = dark >= DayClock.LAMP_ON
	pieces.set_lamps(_lamps_lit)
	minor = MinorPoints.new()
	minor.name = "MinorPoints"
	minor.field = field
	world.add_child(minor)
	minor.build_all(layout)
	caches = Caches.new()
	caches.name = "Caches"
	caches.field = field
	world.add_child(caches)
	for r in _pending_reveals:
		caches.reveal(r.id, r.x, r.z, r.dy)
	for id in _pending_found:
		caches.found(id)
	_pending_reveals.clear()
	_pending_found.clear()

	avatar.on_foot()
	avatar.field = field
	avatar.caches = caches
	_place(walker, field.spawn, field.spawn_yaw)
	walker.process_mode = Node.PROCESS_MODE_INHERIT
	walker.visible = true
	focus = walker
	fleet.set_field(field)
	pins.set_field(field)
	photos.set_world(field, streamer)
	if not fleet.seen:
		_place(fleet.get_buggy(""), buggy_spawn(), field.spawn_yaw)
	rig.yaw = field.spawn_yaw
	rig.follow(walker, &"walk")
	rig.snap()
	# A list that came before the ground (an iframe reload) may seat us.
	avatar.take_seat()
	world_ready.emit(Time.get_ticks_msec() - t0)


## {id, x, z, dy} from the bridge. Before the world, it waits for one.
func reveal_cache(r: Dictionary) -> void:
	if caches == null:
		_pending_reveals.append(r)
	else:
		caches.reveal(r.id, r.x, r.z, r.dy)


## True once the world has been ready for PING_SETTLE_S: before that the page
## is still replaying what we already knew.
func _ping_settled() -> bool:
	return _world_ready_at >= 0 and Time.get_ticks_msec() - _world_ready_at >= int(PING_SETTLE_S * 1000.0)


func found_cache(id: String) -> void:
	if caches == null:
		_pending_found.append(id)
	else:
		caches.found(id)


## Lamps and headlights follow the dark. Darkness moves in 0.01 steps and
## set_lamps walks every piece, so the lamps only hear about a flip.
func _on_dark(d: float) -> void:
	dark = d
	fleet.set_dark(d)
	var lit := d >= DayClock.LAMP_ON
	if pieces != null and lit != _lamps_lit:
		_lamps_lit = lit
		pieces.set_lamps(lit)


## The glint is measured from you (the walker, which rides in the seat),
## not from the camera behind you.
func glint_tick() -> void:
	if caches != null and focus != null:
		caches.glint(walker.global_position, torch_on, dark)


func set_torch(on: bool) -> void:
	torch_on = on
	rig.torch.visible = on


func set_phase(p: StringName) -> void:
	phase = p
	var lock := p != &"hunting"
	walker.locked = lock
	fleet.set_locked(lock)


## Another player's snapshot: their capsule, and the buggy they drive.
func _on_remote(id: String, snap: Dictionary) -> void:
	remotes.upsert(id, snap, Remotes.now())
	if snap.get("v") is String:
		fleet.puppet_pose(snap.v, snap, id)


## Parked 6 m to your right, facing the same way, at the highest ground
## under its four corners so neither end starts buried on a slope.
func buggy_spawn() -> Vector3:
	var fwd := Vector3(-sin(field.spawn_yaw), 0, -cos(field.spawn_yaw))
	var right := Vector3(-fwd.z, 0, fwd.x)
	var at := field.spawn + right * 6.0
	at.y = Fleet.highest_corner(field, at.x, at.z, field.spawn_yaw)
	return at


func _teardown() -> void:
	if world == null:
		return
	# Out of the tree now, so its colliders are gone before the next tick.
	remove_child(world)
	world.queue_free()
	world = null
	streamer = null
	pieces = null
	minor = null
	caches = null
	avatar.caches = null
	field = null
	fleet.set_field(null)
	pins.set_field(null)
	photos.set_world(null, null)


## Hidden and frozen until there's ground to stand on.
func _park(body: Node3D) -> void:
	body.process_mode = Node.PROCESS_MODE_DISABLED
	body.visible = false


func _place(body: Node3D, at: Vector3, yaw: float) -> void:
	body.global_position = at + Vector3(0, 0.05, 0)
	body.rotation = Vector3(0, yaw, 0)
	_stop(body)


func _stop(body: Node3D) -> void:
	if body is CharacterBody3D:
		(body as CharacterBody3D).velocity = Vector3.ZERO
	elif body is RigidBody3D:
		(body as RigidBody3D).linear_velocity = Vector3.ZERO
		(body as RigidBody3D).angular_velocity = Vector3.ZERO
	body.reset_physics_interpolation()


func _physics_process(_dt: float) -> void:
	if field == null:
		_pos_accum = 0.0
		return
	walker.look_yaw = rig.yaw
	if focus:
		streamer.ensure_around(focus.global_position)
	_watch()
	for b in watched:
		_fall_check(b)
	_pos_tick(_dt)


## Where you are (the walker, the buggy you drive, or the seat you ride in),
## POS_HZ times a second, while the round is counting down or on. yaw is
## that body's facing, from its forward vector; v is the vehicle you're in,
## null on foot. The standalone buggy has no id, so driving it sends foot
## false with v null, which the server takes.
func _pos_tick(dt: float) -> void:
	if focus == null or (phase != &"countdown" and phase != &"hunting"):
		_pos_accum = 0.0
		return
	_pos_accum += dt
	if _pos_accum < 1.0 / POS_HZ:
		return
	_pos_accum = fmod(_pos_accum, 1.0 / POS_HZ)
	var p := focus.global_position
	bridge.emit_pos({"x": snappedf(p.x, 0.01), "y": snappedf(p.y, 0.01), "z": snappedf(p.z, 0.01), "yaw": snappedf(Fleet.yaw_of(focus), 0.001), "foot": avatar.mode == &"foot", "v": avatar.vehicle_id()})


## Feeds HuntAudio. The engine is for the buggy you drive; steps for you on
## foot while the round is on (the walker is parked otherwise, and a rider's
## walker is snapped to the seat); a passenger or anyone else hears the ambient.
func audio_tick(dt: float) -> void:
	var driving: bool = avatar.mode == &"driving" and avatar.buggy != null
	var speed: float = avatar.buggy.forward_speed if driving else 0.0
	var walk := 0.0
	if avatar.mode == &"foot" and phase == &"hunting":
		walk = Vector2(walker.velocity.x, walker.velocity.z).length()
	hunt_audio.tick(dt, speed, driving, walk, walker.is_on_floor(), dark)


## The E prompt: shown while the round's on, you're on foot, and there's a
## cache to pick up.
func prompt_tick() -> void:
	prompt.visible = field != null and phase == &"hunting" and avatar.claimable() != ""


## The deep-water rule. Where the ground at `p` is more than `depth` under
## the sea, the flat unit vector down the seabed, else zero. The walker and
## the buggy call it just before they move and drop the part of their
## velocity along it, so you can go along the shore or back, never deeper.
## (Here in main it would run before they set their velocity, and they'd
## creep out a tick at a time.)
func seaward(p: Vector3, depth: float) -> Vector3:
	if field == null or field.height_at(p.x, p.z) >= TerrainField.SEA_LEVEL - depth:
		return Vector3.ZERO
	const S := 2.0
	var down := Vector3(field.height_at(p.x - S, p.z) - field.height_at(p.x + S, p.z), 0,
		field.height_at(p.x, p.z - S) - field.height_at(p.x, p.z + S))
	return down.normalized() if down.length_squared() > 1e-8 else Vector3.ZERO


func _watch() -> void:
	watched.assign([walker] + fleet.local_buggies())


## Under the ground by more than FALL_LIMIT: back on the surface, still.
func _fall_check(b: Node3D) -> void:
	if not is_instance_valid(b) or not b.is_inside_tree() or b.process_mode == Node.PROCESS_MODE_DISABLED:
		return
	var p := b.global_position
	var g := field.height_at(p.x, p.z)
	if p.y < g - FALL_LIMIT:
		b.global_position = Vector3(p.x, g + 0.1, p.z)
		_stop(b)


func _process(_dt: float) -> void:
	daylight.update(day_clock.minute())
	if streamer and focus:
		streamer.update(focus.global_position)
	compass.set_yaw(rig.yaw)
	glint_tick()
	prompt_tick()
	audio_tick(_dt)
	if _debug.visible:
		_debug.text = "%d fps   %d chunks" % [Engine.get_frames_per_second(), streamer.loaded_count() if streamer else 0]


## P: a pin where the camera's centre meets the ground. Only in countdown
## and hunting; a miss (the sky, or too far) does nothing. On foot, riding
## or driving alike. Whether the pointer is captured is for the key handler.
func drop_pin() -> bool:
	if field == null or (phase != &"countdown" and phase != &"hunting"):
		return false
	var cam := rig.camera
	var hit: Variant = Pins.ray_hit(field, cam.global_position, -cam.global_basis.z)
	if hit == null:
		return false
	bridge.emit_pin({"x": snappedf(hit.x, 0.1), "z": snappedf(hit.y, 0.1)})
	return true


func _unhandled_input(e: InputEvent) -> void:
	# Browsers hold audio until a gesture: the first key or click starts it.
	if not hunt_audio.started and ((e is InputEventKey and e.pressed) or (e is InputEventMouseButton and e.pressed)):
		hunt_audio.start()
	if e.is_action_pressed("pin") and not e.is_echo() and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		drop_pin()
	if e.is_action_pressed("torch") and not e.is_echo():
		set_torch(not torch_on)
	# Not before the round's on: no head start in the buggy, and no
	# resetting it either.
	if field != null and phase == &"hunting" and e.is_action_pressed("interact"):
		avatar.interact()
	elif field != null and phase == &"hunting" and e.is_action_pressed("reset_vehicle"):
		avatar.reset_vehicle()
	if e is InputEventKey and e.pressed and not e.echo and (e as InputEventKey).physical_keycode == KEY_F3:
		_debug.visible = not _debug.visible
