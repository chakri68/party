extends Node3D
## Puts a playable world together: terrain, sea, walls, the walker and the
## camera. start_world() is the one way in. Locally (editor, desktop run,
## tests) _ready feeds it a fixture; on the web the bridge (Task 6) feeds it
## the session's layout. Same seed twice does nothing, so a session that
## arrives twice builds once.

signal world_ready(ms: int)

## A body this far under the ground fell through: put it back on top.
const FALL_LIMIT := 5.0

@onready var walker: Walker = $Walker
@onready var rig: RigCamera = $Rig
@onready var _debug: Label = $UI/Debug

var field: TerrainField
var streamer: ChunkStreamer
var world: Node3D ## everything built from the layout; rebuilt on a new seed
## What the streamer builds around. The walker for now; Task 5 switches it
## to whatever the player drives.
var focus: Node3D
## Bodies the fall check watches.
var watched: Array[Node3D] = []

var _seed := 0


func _ready() -> void:
	_park(walker)
	watched.append(walker)
	var n := _requested_layout()
	var path := "res://tests/fixtures/layout_%d.json" % n
	if n > 0 and FileAccess.file_exists(path):
		var layout: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
		if layout is Dictionary:
			start_world(layout)
			return
		push_error("main: %s isn't a layout" % path)
	# Web without ?layout: wait for the host's session (start_world).


## --layout=<n> after `--`, or ?layout=<n> on the page. Off the web the
## default is 1; on the web it's 0 (wait for the session).
func _requested_layout() -> int:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--layout="):
			return a.trim_prefix("--layout=").to_int()
	if OS.has_feature("web"):
		var q: Variant = JavaScriptBridge.eval("new URLSearchParams(location.search).get('layout') || ''", true)
		return q.to_int() if q is String else 0
	return 1


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

	_place(walker, field.spawn, field.spawn_yaw)
	walker.process_mode = Node.PROCESS_MODE_INHERIT
	walker.visible = true
	focus = walker
	rig.yaw = field.spawn_yaw
	rig.follow(walker, &"walk")
	rig.snap()
	world_ready.emit(Time.get_ticks_msec() - t0)


func _teardown() -> void:
	if world == null:
		return
	# Out of the tree now, so its colliders are gone before the next tick.
	remove_child(world)
	world.queue_free()
	world = null
	streamer = null
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
	if e is InputEventKey and e.pressed and not e.echo and (e as InputEventKey).physical_keycode == KEY_F3:
		_debug.visible = not _debug.visible
