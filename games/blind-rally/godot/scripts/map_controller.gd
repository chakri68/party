class_name MapController
extends Control
## Static full-course map (spec §4.2-4.3). Rendered once from a top-down ortho
## camera that can't see the car (render layer 2), copied to a plain texture,
## and then never touched again: no pan, no rotate, no centring, no highlight.
## The only thing that moves is the GPS marker, and only when the assist is on.
##
## Map coords: north (-Z) up, +X right, framed on Track.bounds. Track.world_to_map
## does the conversion, so pins and replays can share it later.

const MAP_PX := 512

@export var gps_enabled := false:
	set(v):
		gps_enabled = v
		if _marker:
			_marker.visible = v
			if v:
				_update_marker()

var car: Node3D
var track: Track
var render_count := 0 ## how many times the map image was produced; stays 1
var image_rect: TextureRect

var _marker: Polygon2D


func _ready() -> void:
	clip_contents = true
	var bg := ColorRect.new()
	bg.name = "Frame"
	bg.color = Color(0.05, 0.06, 0.05, 0.85)
	bg.set_anchors_preset(PRESET_FULL_RECT)
	bg.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(bg)
	image_rect = TextureRect.new()
	image_rect.name = "MapImage"
	image_rect.set_anchors_preset(PRESET_FULL_RECT)
	image_rect.offset_left = 4
	image_rect.offset_top = 4
	image_rect.offset_right = -4
	image_rect.offset_bottom = -4
	image_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image_rect.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(image_rect)
	_marker = Polygon2D.new()
	_marker.name = "GpsMarker"
	_marker.polygon = PackedVector2Array([Vector2(0, -9), Vector2(6, 7), Vector2(0, 3), Vector2(-6, 7)])
	_marker.color = Color(1, 0.95, 0.2)
	_marker.visible = gps_enabled
	image_rect.add_child(_marker)


## Render the course once. Await it; it takes a frame.
func render_static_map(t: Track) -> void:
	track = t
	var vp := SubViewport.new()
	vp.name = "MapRender"
	vp.size = Vector2i(MAP_PX, MAP_PX)
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	vp.msaa_3d = Viewport.MSAA_DISABLED
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	var side := maxf(t.bounds.size.x, t.bounds.size.y)
	var c := t.bounds.get_center()
	cam.size = side
	cam.near = 1.0
	cam.far = 400.0
	cam.cull_mask = 1 | 4 # world plus the map-only overlay; the car and its dust live on layer 2
	vp.add_child(cam)
	add_child(vp)
	# Straight down, north up. Set after entering the tree so global_* works.
	cam.global_transform = Transform3D(Basis.from_euler(Vector3(-PI / 2, 0, 0)), Vector3(c.x, 200, c.y))
	cam.current = true
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	# The dummy (headless) renderer never draws, so frame_post_draw never fires.
	if DisplayServer.get_name() == "headless":
		await get_tree().process_frame
	else:
		await RenderingServer.frame_post_draw
	render_count += 1
	var img: Image = null
	if DisplayServer.get_name() != "headless":
		img = vp.get_texture().get_image()
	if img and not img.is_empty():
		image_rect.texture = ImageTexture.create_from_image(img)
		vp.queue_free() # done with it; the copy is the map now
	else:
		# Headless/dummy renderer: nothing to read back. Keep the (inert)
		# viewport texture so the node graph is the same as on a real GPU.
		image_rect.texture = vp.get_texture()


func _process(_dt: float) -> void:
	if gps_enabled:
		_update_marker()


func _update_marker() -> void:
	if not (car and track and image_rect):
		return
	var r := _drawn_rect()
	var uv := track.world_to_map(car.global_position)
	_marker.position = r.position + uv * r.size
	_marker.rotation = -car.global_rotation.y


## Where the square map image actually lands inside image_rect.
func _drawn_rect() -> Rect2:
	var s := image_rect.size
	var side := minf(s.x, s.y)
	return Rect2((s - Vector2(side, side)) * 0.5, Vector2(side, side))
