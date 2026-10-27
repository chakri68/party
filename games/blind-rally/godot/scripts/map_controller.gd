class_name MapController
extends Control
## Static full-course map (spec §4.2-4.3). Rendered once from a top-down ortho
## camera that can't see the car (render layer 2), copied to a plain texture,
## and then never touched again: no pan, no rotate, no centring, no highlight.
## The only thing that moves is the GPS marker, and only when the assist is on.
##
## Map coords: north (-Z) up, +X right, framed on Track.bounds. Track.world_to_map
## does the conversion, so pins and replays can share it later.
##
## Big map (main.gd's set_map_expanded): the same image in a larger rect,
## cropped to the course bounds, plus `detail`: landmark labels, enlarged
## callout icons and numbered checkpoints, drawn in 2D over the image. All of
## it is static; nothing in detail knows where the car is. The corner glyph
## is an expand hint when small and the close button when big.
##
## Taps. Corner map: any tap is `tapped` (main opens the big map). Big map, once
## open, and map-only: a tap places or moves the guess pin, a long press or
## the "clear pin" chip removes it, and only the X is `tapped`. Mid-animation
## a tap is still `tapped`, so a quick second one turns it round.
##
## Guess pins (spec §4.4): the Navigator's own "I think we're here". One pin,
## plus the last TRAIL it replaced, faded, so they can see their own dead
## reckoning. Kept in world XZ and drawn through Track.world_to_map, on both
## maps; they never move on their own and nothing about them reads the car.
## Placing or clearing one is `pin_changed` (main sends it to the room).

signal tapped
## The Navigator put their pin here (world XZ, a Vector2), or cleared it (null).
signal pin_changed(at: Variant)

## 1024 so the big map stays sharp; mipmapped so the 260 px corner map
## doesn't shimmer from the downscale. Still one render.
const MAP_PX := 1024
## What the map camera draws: world plus the map-only overlay. Not the car
## and its effects (layer 2), not the weather (layer 4), not the eggs (5) or
## ghosts (6).
const CULL_MASK := 1 | 4
const FRAME := 4.0 ## the dark frame around the image, canvas units

## Detail styling, in CSS pixels (see css_px()): sized for a phone held
## sideways, where a canvas unit is about half a pixel.
const LABEL_PX := 13.0
const CP_RADIUS_PX := 11.0
const ICON_PX := 30.0 ## callout icons are enlarged to at least this across
const CLOSE_PX := 40.0
const INK := Color(0.05, 0.06, 0.05) ## same as the frame
const CREAM := Color("f3ead2") ## a lighter cut of the road ribbon
const AMBER := Color(0.95, 0.75, 0.3) ## the MAP ONLY note's colour
## Previous pins kept on the map, faded.
const TRAIL := 3
## Held this long without moving: clears the pin. Game seconds.
const LONG_PRESS_S := 0.5
## A press that wanders further than this (CSS px) is no long press.
const PRESS_SLOP_PX := 12.0
## The pin's height on the big map, CSS px; on the corner map, PIN_SMALL units.
const PIN_PX := 30.0
const PIN_SMALL := 16.0

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
## Labels, big icons and checkpoint numbers. Off in the corner, on when big.
var detail := false:
	set(v):
		detail = v
		if _detail:
			_detail.visible = v
			_detail.queue_redraw()
		_press_at = null
		_layout_inner()
## Big-map look: image cropped to the course bounds, close button.
var big := false:
	set(v):
		big = v
		if _corner:
			_corner.visible = expandable or big
		_layout_inner()
## Image cropped to the course bounds (the frame's aspect decides how much):
## the big map and map-only.
var crop := false:
	set(v):
		crop = v
		_layout_inner()
## False in map-only mode: no expand hint in the corner.
var expandable := true:
	set(v):
		expandable = v
		if _corner:
			_corner.visible = v or big
		_layout_inner()

## The guess pin, world XZ, or null; and the ones it replaced, oldest first.
var pin: Variant = null
var trail: Array[Vector2] = []
## Rally (initSession selfDrive): the map shows where you are, so there's
## nothing to guess, and a tap on the big map just closes it.
var pins_enabled := true
## Team colour for the pins (main sets it from the session's livery).
var pin_color := Color("e69f00"):
	set(v):
		pin_color = v
		if _pins:
			_pins.queue_redraw()

var _marker: Polygon2D
var _detail: Control
var _corner: Control
var _pins: Control
var _clear: Control ## the "clear pin" chip
## A press in pin mode: where (map-local), how long it's been held, and
## whether the long press already fired (the release is then spent).
var _press_at: Variant = null
var _press_s := 0.0
var _press_spent := false
## Built once from the track: [{label, at: Vector3, tris: PackedVector2Array
## (map metres about `at`), cols: PackedColorArray, extent: float}].
var _items: Array = []
var _cps: Array = [] ## [index, Vector3]


func _ready() -> void:
	clip_contents = true
	mouse_filter = MOUSE_FILTER_STOP
	mouse_default_cursor_shape = CURSOR_POINTING_HAND
	var bg := ColorRect.new()
	bg.name = "Frame"
	bg.color = Color(0.05, 0.06, 0.05, 0.85)
	bg.set_anchors_preset(PRESET_FULL_RECT)
	bg.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(bg)
	image_rect = TextureRect.new()
	image_rect.name = "MapImage"
	image_rect.set_anchors_preset(PRESET_FULL_RECT)
	image_rect.offset_left = FRAME
	image_rect.offset_top = FRAME
	image_rect.offset_right = -FRAME
	image_rect.offset_bottom = -FRAME
	image_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image_rect.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	image_rect.mouse_filter = MOUSE_FILTER_IGNORE
	add_child(image_rect)
	_detail = Control.new()
	_detail.name = "Detail"
	_detail.set_anchors_preset(PRESET_FULL_RECT)
	_detail.mouse_filter = MOUSE_FILTER_IGNORE
	_detail.visible = false
	_detail.draw.connect(_draw_detail)
	_detail.resized.connect(_detail.queue_redraw)
	image_rect.add_child(_detail)
	_pins = Control.new()
	_pins.name = "Pins"
	_pins.set_anchors_preset(PRESET_FULL_RECT)
	_pins.mouse_filter = MOUSE_FILTER_IGNORE
	_pins.draw.connect(_draw_pins)
	_pins.resized.connect(_pins.queue_redraw)
	image_rect.add_child(_pins) # over the labels, under the live marker
	_marker = Polygon2D.new()
	_marker.name = "GpsMarker"
	_marker.polygon = PackedVector2Array([Vector2(0, -9), Vector2(6, 7), Vector2(0, 3), Vector2(-6, 7)])
	_marker.color = Color(1, 0.95, 0.2)
	_marker.visible = gps_enabled
	image_rect.add_child(_marker)
	_corner = Control.new()
	_corner.name = "Corner"
	_corner.mouse_filter = MOUSE_FILTER_IGNORE # a tap on it is a tap on the map
	_corner.draw.connect(_draw_corner)
	add_child(_corner)
	_clear = Control.new()
	_clear.name = "ClearPin"
	_clear.mouse_filter = MOUSE_FILTER_IGNORE # hit-tested in _gui_input, like the corner
	_clear.visible = false
	_clear.draw.connect(_draw_clear)
	add_child(_clear)
	resized.connect(_layout_inner)
	_layout_inner()


## Render the course once. Await it; it takes a frame.
func render_static_map(t: Track) -> void:
	track = t
	_collect(t)
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
	cam.cull_mask = CULL_MASK
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
		img.generate_mipmaps()
		image_rect.texture = ImageTexture.create_from_image(img)
		vp.queue_free() # done with it; the copy is the map now
	else:
		# Headless/dummy renderer: nothing to read back. Keep the (inert)
		# viewport texture so the node graph is the same as on a real GPU.
		image_rect.texture = vp.get_texture()
	_layout_inner()


## The camera the map was rendered with, or null once it's been freed (on a
## real GPU the image is copied and the viewport dropped).
func map_camera() -> Camera3D:
	var vp := get_node_or_null("MapRender")
	return vp.get_child(0) as Camera3D if vp and vp.get_child_count() else null


## Height over width of what's worth showing: the course bounds.
func content_aspect() -> float:
	if track == null or track.bounds.size.x <= 0.0:
		return 1.0
	return track.bounds.size.y / track.bounds.size.x


## Canvas units per CSS pixel. The canvas is 720 units tall whatever the
## window, so a phone held sideways (390 CSS px) gets about 1.85 of them a
## pixel; text sized in units alone would come out half size there.
func css_px() -> float:
	var vp := get_viewport()
	if vp == null:
		return 1.0
	var win := vp.get_visible_rect().size
	var real := Vector2(DisplayServer.window_get_size()) / maxf(DisplayServer.screen_get_scale(), 0.01)
	if real.y < 1.0 or DisplayServer.get_name() == "headless":
		return 1.0
	return clampf(win.y / real.y, 0.5, 4.0)


## Pins go down on the big map once it's open, and on the map-only map.
func pinnable() -> bool:
	return pins_enabled and track != null and ((big and detail) or not expandable)


func _gui_input(e: InputEvent) -> void:
	# Touch arrives as emulated mouse (input_devices/pointing/emulate_mouse_from_touch,
	# on by default), so a tap is one left button. Without that emulation the
	# touch itself counts; never both, or a tap would count twice.
	var at: Variant = null # where a press or release landed
	var down := false
	var mb := e as InputEventMouseButton
	if mb and mb.button_index == MOUSE_BUTTON_LEFT:
		at = mb.position
		down = mb.pressed
	var st := e as InputEventScreenTouch
	if st and st.index == 0 and not ProjectSettings.get_setting("input_devices/pointing/emulate_mouse_from_touch", true):
		at = st.position
		down = st.pressed
	var mm := e as InputEventMouseMotion
	if mm and _press_at != null and (mm.position - (_press_at as Vector2)).length() > PRESS_SLOP_PX * css_px():
		_press_s = -INF # dragged: not a long press any more
	if at == null or not Rect2(Vector2.ZERO, size).has_point(at):
		if at != null and not down:
			_press_at = null
		return
	accept_event()
	if not pinnable():
		if not down:
			tapped.emit()
		return
	if down:
		_press_at = at
		_press_s = 0.0
		_press_spent = false
		return
	var spent := _press_spent or _press_at == null
	_press_at = null
	if spent:
		return
	if big and _corner.visible and Rect2(_corner.position, _corner.size).has_point(at):
		tapped.emit() # the X
	elif _clear.visible and Rect2(_clear.position, _clear.size).grow(4.0 * css_px()).has_point(at):
		clear_pin()
	else:
		var w: Variant = local_to_world(at)
		if w != null:
			set_pin(w)


func _process(dt: float) -> void:
	if gps_enabled:
		_update_marker()
	if _press_at != null and not _press_spent:
		_press_s += dt
		if _press_s >= LONG_PRESS_S:
			_press_spent = true
			clear_pin()


# --- guess pins ----------------------------------------------------------------

## A point in this control (canvas units) to world XZ, or null off the
## visible map. Clamped to the track's bounds: that's all the server takes.
func local_to_world(p: Vector2) -> Variant:
	if track == null:
		return null
	var q := p - image_rect.position
	if not _visible_rect().has_point(q):
		return null
	var r := _drawn_rect()
	var uv := (q - r.position) / r.size
	var side := maxf(track.bounds.size.x, track.bounds.size.y)
	var w := track.bounds.get_center() + (uv - Vector2(0.5, 0.5)) * side
	return Vector2(clampf(w.x, track.bounds.position.x, track.bounds.end.x), clampf(w.y, track.bounds.position.y, track.bounds.end.y))


## Where world XZ lands in this control, canvas units.
func world_to_local(w: Vector2) -> Vector2:
	return image_rect.position + _to_px(Vector3(w.x, 0.0, w.y))


## Places or moves the pin. The old one joins the trail.
func set_pin(w: Vector2, emit := true) -> void:
	if pin != null:
		trail.append(pin)
		if trail.size() > TRAIL:
			trail = trail.slice(trail.size() - TRAIL)
	pin = w
	_pins_changed()
	if emit:
		pin_changed.emit(w)


## Takes the pin off. The trail stays; the cleared pin doesn't join it.
func clear_pin(emit := true) -> void:
	if pin == null:
		return
	pin = null
	_pins_changed()
	if emit:
		pin_changed.emit(null)


## What the room kept: {pin: [x, z] | null, trail: [[x, z], ...]}. Replaces
## whatever's on the map, quietly (it's the server's copy coming back).
func restore_pins(d: Dictionary) -> void:
	var p: Variant = d.get("pin")
	pin = Vector2(float(p[0]), float(p[1])) if p is Array and p.size() == 2 else null
	trail.clear()
	var t: Variant = d.get("trail")
	if t is Array:
		for x in t:
			if x is Array and x.size() == 2:
				trail.append(Vector2(float(x[0]), float(x[1])))
	if trail.size() > TRAIL:
		trail = trail.slice(trail.size() - TRAIL)
	_pins_changed()


func _pins_changed() -> void:
	_sync_clear()
	if _pins:
		_pins.queue_redraw()


func _sync_clear() -> void:
	if _clear == null:
		return
	var on := pin != null and pinnable()
	if _clear.visible != on:
		_clear.visible = on
		if _detail:
			_detail.queue_redraw() # labels keep clear of the chip
	if on:
		_clear.queue_redraw()


## Pin height in image_rect units: phone-readable on the big map.
func _pin_h() -> float:
	return maxf(18.0, PIN_PX * css_px()) if detail else PIN_SMALL


## Trail: the pins it replaced, smaller and faded (oldest faintest), joined
## by a dashed line to the current one: their own dead reckoning. Pin: a
## teardrop in the team colour, point on the spot, ink rim, cream eye; a
## shape the live marker's arrow can't be taken for.
func _draw_pins() -> void:
	if track == null or (pin == null and trail.is_empty()):
		return
	var k := css_px() if detail else 1.0
	var h := _pin_h()
	var pts: Array[Vector2] = []
	for t in trail:
		pts.append(_to_px(Vector3(t.x, 0.0, t.y)))
	var head: Variant = _to_px(Vector3(pin.x, 0.0, pin.y)) if pin != null else null
	var line := pts.duplicate()
	if head != null:
		line.append(head)
	var lw := maxf(1.5, 2.0 * k)
	for i in line.size() - 1:
		_pins.draw_dashed_line(line[i], line[i + 1], Color(INK, 0.6), lw + 2.0 * k, 5.0 * k, true)
	for i in line.size() - 1:
		_pins.draw_dashed_line(line[i], line[i + 1], Color(pin_color, 0.85), lw, 5.0 * k, true)
	for i in pts.size():
		var a := 0.45 + 0.3 * float(i + TRAIL - pts.size()) / float(TRAIL - 1)
		_draw_drop(pts[i], h * 0.62, k, a)
	if head == null:
		return
	_draw_drop(head, h, k, 1.0)
	if detail:
		var font := ThemeDB.fallback_font
		var fs := int(round(LABEL_PX * 0.9 * k))
		var at: Vector2 = head + Vector2(h * 0.34 + 5.0 * k, -h * 0.66 + font.get_ascent(fs) * 0.5)
		_pins.draw_string_outline(font, at, "your guess", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, maxi(3, int(round(4.0 * k))), Color(INK, 0.9))
		_pins.draw_string(font, at, "your guess", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, CREAM)


## One teardrop pin `h` tall with its point at `tip`, at alpha `a`.
func _draw_drop(tip: Vector2, h: float, k: float, a: float) -> void:
	var r := h * 0.34
	var c := tip + Vector2(0.0, -(h - r))
	var drop := teardrop(c, r, tip)
	var rim := PackedVector2Array()
	for p in drop:
		var d := (p - c).length()
		rim.append(c + (p - c) * (d + 1.5 * k) / maxf(d, 0.001))
	_pins.draw_colored_polygon(rim, Color(INK, 0.92 * a))
	_pins.draw_colored_polygon(drop, Color(pin_color, a))
	_pins.draw_circle(c, r * 0.42, Color(CREAM, a))
	_pins.draw_circle(tip, maxf(1.0, 1.2 * k), Color(INK, a))


## The pin's outline: a circle round `c`, closed by two tangents to `tip`.
static func teardrop(c: Vector2, r: float, tip: Vector2) -> PackedVector2Array:
	var d := (tip - c).length()
	var a := acos(clampf(r / maxf(d, r + 0.001), -1.0, 1.0)) # from "straight at the tip" to a tangent point
	var out := PackedVector2Array([tip])
	var n := 20
	for i in n + 1:
		var b := a + (TAU - 2.0 * a) * float(i) / float(n)
		out.append(c + Vector2(sin(b), cos(b)) * r)
	return out


## For tests: the pin and trail as drawn, in this control's units.
func pin_points() -> Dictionary:
	return {"pin": world_to_local(pin) if pin != null else null, "trail": trail.map(world_to_local)}


## "clear pin" on an ink chip.
func _draw_clear() -> void:
	var s := _clear.size
	var k := css_px()
	_clear.draw_rect(Rect2(Vector2.ZERO, s), Color(INK, 0.88))
	_clear.draw_rect(Rect2(Vector2.ZERO, s), Color(CREAM, 0.5), false, maxf(1.0, 1.5 * k))
	var font := ThemeDB.fallback_font
	var fs := int(round(LABEL_PX * k))
	var tw := font.get_string_size("clear pin", HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	_clear.draw_string(font, Vector2((s.x - tw.x) * 0.5, (s.y + font.get_ascent(fs) - font.get_descent(fs)) * 0.5), "clear pin", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, CREAM)


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


## Small: the image fills the frame. Big: it's as wide as the frame and the
## frame is cut to the bounds, so the empty strips above and below the course
## are clipped off. The marker and the corner glyph scale with the map.
func _layout_inner() -> void:
	if image_rect == null or _corner == null or _clear == null:
		return
	var inner := size - Vector2(FRAME, FRAME) * 2.0
	if (big or crop) and inner.x > 0.0:
		var spill := (inner.y - inner.x) * 0.5 # negative: the square is taller than the frame
		image_rect.offset_top = FRAME + spill
		image_rect.offset_bottom = -FRAME - spill
	else:
		image_rect.offset_top = FRAME
		image_rect.offset_bottom = -FRAME
	var k := css_px()
	var side := _corner_side()
	_corner.position = Vector2(size.x - side - FRAME - 4.0 * k, FRAME + 4.0 * k) if big else Vector2(FRAME, size.y - side - FRAME)
	_corner.size = Vector2(side, side)
	_corner.queue_redraw()
	# The chip: left of the X on the big map, top-right on map-only.
	var font := ThemeDB.fallback_font
	var cs := Vector2(font.get_string_size("clear pin", HORIZONTAL_ALIGNMENT_LEFT, -1, int(round(LABEL_PX * k))).x + 20.0 * k, maxf(side * 0.8, 28.0 * k))
	var right := (_corner.position.x - 8.0 * k) if big else (size.x - FRAME - 6.0 * k)
	_clear.size = cs
	_clear.position = Vector2(right - cs.x, (_corner.position.y + (side - cs.y) * 0.5) if big else FRAME + 6.0 * k)
	_sync_clear()
	if _pins:
		_pins.queue_redraw()
	# Marker: ~18 units on the corner map; on the big one, a phone-readable size.
	var ms := maxf(1.0, (minf(inner.x, inner.y) / 252.0) * 0.6) if detail else 1.0
	ms = maxf(ms, k * 1.4) if detail else ms
	_marker.scale = Vector2.ONE * ms
	if gps_enabled:
		_update_marker()
	if _detail:
		_detail.queue_redraw()


func _corner_side() -> float:
	return CLOSE_PX * css_px() if big else maxf(18.0, 14.0 * css_px())


## Big: a close button (an X on an ink disc). Small: a hint that the corner
## map opens (two arrow heads out to the corners).
func _draw_corner() -> void:
	var s := _corner.size
	var c := s * 0.5
	if big:
		_corner.draw_circle(c, s.x * 0.5, Color(INK, 0.88))
		_corner.draw_arc(c, s.x * 0.5 - 1.0, 0, TAU, 32, Color(CREAM, 0.5), 1.5 * css_px(), true)
		var a := s.x * 0.2
		var w := maxf(2.0, s.x * 0.07)
		_corner.draw_line(c + Vector2(-a, -a), c + Vector2(a, a), CREAM, w, true)
		_corner.draw_line(c + Vector2(-a, a), c + Vector2(a, -a), CREAM, w, true)
	else:
		_corner.draw_rect(Rect2(Vector2.ZERO, s), Color(INK, 0.75))
		var col := Color(CREAM, 0.85)
		var m := 4.0
		var l := 4.5
		# Bottom-left and top-right corners, the way the map grows.
		_corner.draw_polyline(PackedVector2Array([Vector2(m, s.y - m - l), Vector2(m, s.y - m), Vector2(m + l, s.y - m)]), col, 1.5, true)
		_corner.draw_polyline(PackedVector2Array([Vector2(s.x - m - l, m), Vector2(s.x - m, m), Vector2(s.x - m, m + l)]), col, 1.5, true)
		_corner.draw_line(Vector2(m + 1, s.y - m - 1), Vector2(s.x - m - 1, m + 1), col, 1.0, true)


## Landmarks (label, and for callouts the icon's triangles off the baked
## overlay mesh, so the big icon is the same icon), checkpoints.
func _collect(t: Track) -> void:
	_items.clear()
	_cps.clear()
	var icons := {}
	var ig := t.get_node_or_null("MapOverlay/Icons")
	if ig:
		for c in ig.get_children():
			if c is MeshInstance3D and c.has_meta("label"):
				icons[String(c.get_meta("label"))] = c
	for lm in t.get_landmarks():
		var it := {"label": String(lm.get_meta("label", lm.name)), "at": lm.global_position,
			"tris": PackedVector2Array(), "cols": PackedColorArray(), "extent": 0.0}
		var mi: MeshInstance3D = icons.get(it.label)
		if mi and mi.mesh:
			var arr := mi.mesh.surface_get_arrays(0)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var cs: Variant = arr[Mesh.ARRAY_COLOR]
			var ix: Variant = arr[Mesh.ARRAY_INDEX]
			var order: PackedInt32Array = ix if ix is PackedInt32Array and ix.size() else PackedInt32Array(range(vs.size()))
			var tris := PackedVector2Array()
			var cols := PackedColorArray()
			var extent := 0.0
			var centre := Vector2.ZERO
			for v in vs:
				var w := mi.global_transform * v
				centre += Vector2(w.x, w.z)
			centre /= maxf(1.0, vs.size())
			for i in order:
				var w := mi.global_transform * vs[i]
				var p := Vector2(w.x, w.z) - centre
				tris.append(p)
				cols.append(cs[i] if cs is PackedColorArray and cs.size() > i else CREAM)
				extent = maxf(extent, p.length())
			it.tris = tris
			it.cols = cols
			it.extent = extent
			it.at = Vector3(centre.x, 0.0, centre.y)
		_items.append(it)
	for cp in t.get_checkpoints():
		_cps.append([int(cp.get_meta("index")), cp.global_position])
	var sp := t.get_spawn()
	if sp:
		_items.append({"label": "start", "at": sp.global_position, "tris": PackedVector2Array(), "cols": PackedColorArray(), "extent": 0.0})
	var fin := t.get_finish()
	if fin:
		_items.append({"label": "finish", "at": fin.global_position, "tris": PackedVector2Array(), "cols": PackedColorArray(), "extent": 0.0})


## Visible part of image_rect (the map's frame clips the big map), local.
func _visible_rect() -> Rect2:
	var own := Rect2(Vector2(FRAME, FRAME), size - Vector2(FRAME, FRAME) * 2.0)
	own.position -= image_rect.position
	return own.intersection(_drawn_rect())


func _to_px(at: Vector3) -> Vector2:
	var r := _drawn_rect()
	return r.position + track.world_to_map(at) * r.size


## Labels, big icons, checkpoint numbers. A static picture: no input from the
## car, ever. Laid out greedily: checkpoints first (they're the race), then
## icons, then each label at the first free side of its thing.
func _draw_detail() -> void:
	if track == null or not detail:
		return
	var k := css_px()
	var font := ThemeDB.fallback_font
	var fs := int(round(LABEL_PX * k))
	var outline := maxi(3, int(round(4.0 * k)))
	var vis := _visible_rect().grow(-2.0 * k)
	var r := _drawn_rect()
	var px_per_m := r.size.x / maxf(track.bounds.size.x, track.bounds.size.y)
	var taken: Array[Rect2] = []
	if big:
		taken.append(Rect2(_corner.position - image_rect.position, _corner.size).grow(4.0 * k))
	if _clear.visible:
		taken.append(Rect2(_clear.position - image_rect.position, _clear.size).grow(4.0 * k))
	# Checkpoints: ink disc, amber ring, number.
	var cr := CP_RADIUS_PX * k
	for cp in _cps:
		var p := _to_px(cp[1])
		taken.append(Rect2(p - Vector2(cr, cr), Vector2(cr, cr) * 2.0))
	# Icons, enlarged about their centre to at least ICON_PX.
	var anchors := [] # [item, centre px, half size px]
	# Every icon's triangles in one command: one draw, not one per triangle.
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	for it in _items:
		var p := _to_px(it.at)
		var half: float = 5.0 * k
		if it.tris.size() >= 3:
			var sc := maxf(px_per_m, ICON_PX * k * 0.5 / maxf(it.extent, 0.01))
			half = it.extent * sc
			for i in it.tris.size() - it.tris.size() % 3:
				pts.append(p + it.tris[i] * sc)
				cols.append(it.cols[i])
		elif it.label != "start" and it.label != "finish":
			half = 8.0 * k # the big boxes (bridge, cabin, sawmill) are already baked at size
		else:
			half = 7.0 * k
		taken.append(Rect2(p - Vector2(half, half) * 0.8, Vector2(half, half) * 1.6))
		anchors.append([it, p, half])
	if pts.size():
		RenderingServer.canvas_item_add_triangle_array(_detail.get_canvas_item(), PackedInt32Array(range(pts.size())), pts, cols)
	for cp in _cps:
		var p := _to_px(cp[1])
		_detail.draw_circle(p, cr, Color(INK, 0.92))
		_detail.draw_arc(p, cr - 0.75 * k, 0, TAU, 28, AMBER, 2.0 * k, true)
		var txt := str(cp[0])
		var tw := font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		_detail.draw_string(font, p + Vector2(-tw.x * 0.5, font.get_ascent(fs) * 0.5 - 1.0 * k), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, CREAM)
	# Labels.
	var gap := 4.0 * k
	var placed := [] # [text, baseline]
	for a in anchors:
		var txt: String = a[0].label
		var p: Vector2 = a[1]
		var half: float = a[2]
		var ts := font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		var h := font.get_height(fs)
		var tries := [
			Vector2(p.x + half + gap, p.y - h * 0.5), # right
			Vector2(p.x - half - gap - ts.x, p.y - h * 0.5), # left
			Vector2(p.x - ts.x * 0.5, p.y + half + gap), # below
			Vector2(p.x - ts.x * 0.5, p.y - half - gap - h), # above
			Vector2(p.x + half * 0.7, p.y + half * 0.7), # the four diagonals
			Vector2(p.x - half * 0.7 - ts.x, p.y + half * 0.7),
			Vector2(p.x + half * 0.7, p.y - half * 0.7 - h),
			Vector2(p.x - half * 0.7 - ts.x, p.y - half * 0.7 - h),
		]
		# The first side that's on the map and clear; failing that, the one
		# that overlaps least.
		var spot: Variant = null
		var least := INF
		for at in tries:
			var box := Rect2(at, Vector2(ts.x, h)).grow(1.0 * k)
			if not vis.encloses(box):
				continue
			var hit := 0.0
			for t in taken:
				hit += t.intersection(box).get_area()
			if hit < least:
				least = hit
				spot = at
			if hit == 0.0:
				break
		if spot == null:
			continue
		taken.append(Rect2(spot, Vector2(ts.x, h)))
		placed.append([txt, spot + Vector2(0, font.get_ascent(fs))])
	# Outlines first, then the fills: two runs of one font, which batch.
	for l in placed:
		_detail.draw_string_outline(font, l[1], l[0], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, outline, Color(INK, 0.9))
	for l in placed:
		_detail.draw_string(font, l[1], l[0], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, CREAM)


## For tests: what detail draws, as data. [{label, at (px in image_rect)}]
## and checkpoint numbers; no car anywhere in it.
func detail_items() -> Dictionary:
	var out := {"labels": [], "checkpoints": []}
	if track == null:
		return out
	for it in _items:
		out.labels.append(it.label)
	for cp in _cps:
		out.checkpoints.append(cp[0])
	return out
