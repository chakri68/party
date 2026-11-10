extends Node3D
## Puts a playable world together: terrain, sea, walls, the walker, the
## buggy and the camera. start_world() is the one way in. Locally (editor, desktop run,
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

@onready var walker: Walker = $Walker
@onready var rig: RigCamera = $Rig
@onready var buggy: Buggy = $Buggy
@onready var avatar: PlayerAvatar = $Avatar
@onready var _debug: Label = $UI/Debug
@onready var bridge: WebBridge = $WebBridge

var field: TerrainField
var streamer: ChunkStreamer
var pieces: Pieces
var world: Node3D ## everything built from the layout; rebuilt on a new seed
## What the streamer builds around: whichever body you're controlling.
var focus: Node3D
## Bodies the fall check watches.
var watched: Array[Node3D] = []

var _seed := 0


func _ready() -> void:
	_park(walker)
	_park(buggy)
	watched.append(walker)
	watched.append(buggy)
	walker.seaward = seaward.bind(SEA_WALK_DEPTH)
	buggy.seaward = seaward.bind(SEA_DRIVE_DEPTH)
	avatar.setup(walker, buggy, rig)
	avatar.mode_changed.connect(func(m: StringName) -> void: focus = buggy if m == &"driving" else walker)
	bridge.session_started.connect(_on_session)
	world_ready.connect(func(ms: int) -> void:
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
	# On the pad height for now. The pads aren't flattened into the terrain
	# yet, so on real ground a piece can float or sink a little.
	pieces = Pieces.new()
	pieces.name = "Pieces"
	world.add_child(pieces)
	pieces.build_all(layout)

	avatar.on_foot()
	avatar.field = field
	_place(walker, field.spawn, field.spawn_yaw)
	walker.process_mode = Node.PROCESS_MODE_INHERIT
	walker.visible = true
	focus = walker
	_place(buggy, buggy_spawn(), field.spawn_yaw)
	buggy.process_mode = Node.PROCESS_MODE_INHERIT
	buggy.visible = true
	rig.yaw = field.spawn_yaw
	rig.follow(walker, &"walk")
	rig.snap()
	world_ready.emit(Time.get_ticks_msec() - t0)


## Parked 6 m to your right, facing the same way, at the highest ground
## under its four corners so neither end starts buried on a slope.
func buggy_spawn() -> Vector3:
	var fwd := Vector3(-sin(field.spawn_yaw), 0, -cos(field.spawn_yaw))
	var right := Vector3(-fwd.z, 0, fwd.x)
	var at := field.spawn + right * 6.0
	at.y = -INF
	for sx in [-0.5, 0.5]:
		for sz in [-0.5, 0.5]:
			var c: Vector3 = at + right * sx * Buggy.BOX.x + fwd * sz * Buggy.BOX.z
			at.y = maxf(at.y, field.height_at(c.x, c.z))
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
	field = null


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
		return
	walker.look_yaw = rig.yaw
	if focus:
		streamer.ensure_around(focus.global_position)
	for b in watched:
		_fall_check(b)


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
	if streamer and focus:
		streamer.update(focus.global_position)
	if _debug.visible:
		_debug.text = "%d fps   %d chunks" % [Engine.get_frames_per_second(), streamer.loaded_count() if streamer else 0]


func _unhandled_input(e: InputEvent) -> void:
	if field != null and e.is_action_pressed("interact"):
		avatar.interact()
	elif field != null and e.is_action_pressed("reset_vehicle"):
		avatar.reset_vehicle()
	if e is InputEventKey and e.pressed and not e.echo and (e as InputEventKey).physical_keycode == KEY_F3:
		_debug.visible = not _debug.visible
