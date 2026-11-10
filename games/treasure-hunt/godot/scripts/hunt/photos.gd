class_name Photos
extends Node
## Photo clues (§6.2), rendered here in the real world and handed to the page
## as base64 JPEG. One at a time: a SubViewport sharing the main World3D (so
## the same sun, sky and lamps), a camera at the pose, two frames for the
## ground to settle, one draw, one capture. Each pose renders once per Godot
## session; an iframe reload starts over, and the page keeps its images.
##
## A list before the world waits for it. A torn-down world forgets the lot:
## the new map's list comes with the new state.
##
## The capture can come back empty (the headless dummy renderer draws
## nothing): that pose goes to the back of the queue, and after MAX_TRIES
## it's dropped, unrendered, until a list names it again.

## pose: {x, z, yaw, pitch, fov}, the pose it was rendered at, so the page
## files it under that.
signal photo_ready(id: String, pose: Dictionary, data: String)

## Copies of PHOTO_W, PHOTO_H, PHOTO_Q and PHOTO_EYE in shared/sky.ts.
const PHOTO_W := 480
const PHOTO_H := 270
const PHOTO_Q := 0.75
const PHOTO_EYE := 1.7
## Ground is built here as well as under the camera: the middle of the view.
const AHEAD := 150.0
const MAX_TRIES := 3

var _field: TerrainField
var _streamer: ChunkStreamer
var _vp: SubViewport
var _cam: Camera3D
## id -> the pose key rendered for it.
var _done := {}
## [{id, x, z, yaw, pitch, fov, key, tries}], oldest first. One per id.
var _queue: Array[Dictionary] = []
var _busy := false
## Bumped by set_world: a render that outlives its world is thrown away.
var _gen := 0


func _ready() -> void:
	_vp = SubViewport.new()
	_vp.name = "PhotoViewport"
	_vp.size = Vector2i(PHOTO_W, PHOTO_H)
	_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	_vp.world_3d = get_viewport().world_3d
	add_child(_vp)
	_cam = Camera3D.new()
	_cam.far = 1500.0
	_cam.current = true
	_vp.add_child(_cam)


## The ground to stand on, or null for none (main's teardown).
func set_world(field: TerrainField, streamer: ChunkStreamer) -> void:
	if field == null or _field != null:
		# A world going away: what it rendered and what it asked for go too.
		_done.clear()
		_queue.clear()
		_gen += 1
		_busy = false
	_field = field
	_streamer = streamer
	_pump.call_deferred()


## [{id, x, z, yaw, pitch, fov}]: render whatever hasn't been, for that pose.
## fov is vertical, in degrees. Entries that don't check out are skipped.
func set_list(list: Array) -> void:
	for e: Variant in list:
		if not (e is Dictionary and e.get("id") is String and _num(e.get("x")) and _num(e.get("z")) and _num(e.get("yaw")) and _num(e.get("pitch")) and _fov(e.get("fov"))):
			continue
		var key := "%s,%s,%s,%s,%s" % [e.x, e.z, e.yaw, e.pitch, e.fov]
		if _done.get(e.id) == key:
			continue
		var at := _queue.find_custom(func(q: Dictionary) -> bool: return q.id == e.id)
		if at >= 0:
			if _queue[at].key == key:
				continue
			_queue.remove_at(at)
		_queue.append({"id": e.id, "x": float(e.x), "z": float(e.z), "yaw": float(e.yaw), "pitch": float(e.pitch), "fov": float(e.fov), "key": key, "tries": 0})
	_pump()


func busy() -> bool:
	return _busy


func pending() -> int:
	return _queue.size()


## The seam: the drawn frame. Tests return a fixed image. Headless there is
## no frame (asking the dummy renderer for one logs an engine error), so null.
func _capture() -> Image:
	if DisplayServer.get_name() == "headless":
		return null
	var tex := _vp.get_texture()
	return tex.get_image() if tex != null else null


## The frame after the viewport drew. Headless (the dummy renderer) never
## draws, so frame_post_draw never comes: a plain frame stands in.
func _drawn() -> void:
	if DisplayServer.get_name() == "headless":
		await get_tree().process_frame
	else:
		await RenderingServer.frame_post_draw


func _pump() -> void:
	if _busy or _field == null or _queue.is_empty() or not is_inside_tree():
		return
	_render(_queue.pop_front())


func _render(e: Dictionary) -> void:
	_busy = true
	var gen := _gen
	var streamer := _streamer
	var eye := Vector3(e.x, _field.height_at(e.x, e.z) + PHOTO_EYE, e.z)
	_cam.position = eye
	_cam.rotation = Vector3(e.pitch, e.yaw, 0.0)
	# Camera3D keeps height by default, so fov is the vertical one, as photoCam means it.
	_cam.fov = e.fov
	streamer.ensure_around(eye)
	streamer.ensure_around(eye + Vector3(-sin(e.yaw), 0.0, -cos(e.yaw)) * AHEAD)
	streamer.hold(eye)
	await get_tree().process_frame
	await get_tree().process_frame
	if gen != _gen:
		_let_go(streamer)
		return
	_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	await _drawn()
	if gen != _gen:
		_let_go(streamer)
		return
	var img := _capture()
	_let_go(streamer)
	_busy = false
	if img == null or img.is_empty():
		# Fail soft: try again later, then give up on it.
		e.tries += 1
		if e.tries < MAX_TRIES and not _queue.any(func(q: Dictionary) -> bool: return q.id == e.id):
			_queue.append(e)
		_pump.call_deferred()
		return
	if img.get_format() != Image.FORMAT_RGB8:
		img.convert(Image.FORMAT_RGB8)
	_done[e.id] = e.key
	var pose := {"x": e.x, "z": e.z, "yaw": e.yaw, "pitch": e.pitch, "fov": e.fov}
	photo_ready.emit(e.id, pose, Marshalls.raw_to_base64(img.save_jpg_to_buffer(PHOTO_Q)))
	_pump.call_deferred()


## A world torn down mid-photo may have freed its streamer already.
static func _let_go(streamer: ChunkStreamer) -> void:
	if is_instance_valid(streamer):
		streamer.release()


static func _num(v: Variant) -> bool:
	return v is float or v is int


## Camera3D takes 1–179; photoCam sends 10–60.
static func _fov(v: Variant) -> bool:
	return _num(v) and v >= 1.0 and v <= 179.0
