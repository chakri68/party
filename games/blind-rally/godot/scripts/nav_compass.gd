class_name NavCompass
extends Control
## The Navigator's heading indicator (spec §4.2), drawn like an aircraft's:
## a fixed lubber line at the top is the bonnet, and the compass card turns
## under it, so whatever bearing sits under the line is where the car points.
## Same convention as the Driver's dash compass (client/driver/dashboard.ts),
## and the same readout under it: "042° NE".
##
## Card: fine ticks every 10°, major every 30°, N E S W upright, N in amber.
## Lives top-left over the 3D view; see _layout for why there.
##
## Only your own car's heading, which the 3D view shows anyway; nothing about
## where it is. It never touches the map and is hidden in map-only mode (no
## 3D view to indicate for), so the live-marker rule (spec §4.3) holds
## whatever the assist says.
##
## Cheap: one Control, 2D draws only, redrawn when the smoothed heading moves
## more than a hair or the size changes. Smoothed with lerp_angle, which goes
## the short way round, so 359 -> 001 is two degrees, not a lap.

const INK := MapController.INK
const CREAM := MapController.CREAM
const AMBER := MapController.AMBER
const NAMES := ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

## Dial diameter in CSS pixels on a phone; never fewer than MIN_UNITS canvas
## units (on a desktop a unit is a pixel or more, and the dial would shrink
## to a postage stamp otherwise).
const DIAMETER_PX := 70.0
const MIN_UNITS := 100.0
## In from the corner, canvas units: the minimap's own margin (main.tscn), so
## the two top corners line up on every screen.
const MARGIN := 12.0
## 1/s. Keeps up with a slide, calms the jitter of a car on a rough road.
const SMOOTHING := 12.0
## Redraw threshold, radians (~0.1°).
const EPS := 0.002

var car: Node3D

## Displayed, smoothed car yaw (Godot's rotation.y convention: 0 faces -Z,
## north on the map; positive turns left, toward west).
var car_yaw := 0.0
var _drawn := INF
var _font: FontVariation
var _pill_box := StyleBoxFlat.new()


func _ready() -> void:
	mouse_filter = MOUSE_FILTER_IGNORE
	process_priority = 10 # after the car has moved this frame
	_font = FontVariation.new()
	_font.base_font = ThemeDB.fallback_font # Open Sans SemiBold: has "°"
	var ts := TextServerManager.get_primary_interface()
	_font.opentype_features = {ts.name_to_tag("tnum"): 1, ts.name_to_tag("lnum"): 1}
	get_viewport().size_changed.connect(_layout)
	_layout()


## Yaw of a basis's forward (-Z), flattened onto the ground; immune to the
## car pitching over a crest.
static func yaw_of(b: Basis) -> float:
	var f := -b.z
	return atan2(-f.x, -f.z)


## Compass degrees (0 = N, 90 = E, clockwise) for a yaw.
static func heading_deg(yaw: float) -> float:
	return fposmod(-rad_to_deg(yaw), 360.0)


## "042° NE". Rounded once, so 359.7 reads "000° N", never "360°".
static func heading_text(deg: float) -> String:
	var d := posmod(int(round(deg)), 360)
	return "%03d° %s" % [d, NAMES[int(round(d / 45.0)) % 8]]


## How far the card is turned on screen, clockwise radians: minus the
## heading, so the heading's mark sits under the lubber line.
func card_rotation() -> float:
	return wrapf(car_yaw, -PI, PI)


func text() -> String:
	return heading_text(heading_deg(car_yaw))


## Jump to the car's heading (respawn): no swing.
func snap() -> void:
	if car:
		car_yaw = yaw_of(car.global_basis)
	queue_redraw()


## One smoothing step toward this yaw. Split from _process for tests.
func step(target: float, dt: float) -> void:
	var k := 1.0 - exp(-SMOOTHING * dt)
	car_yaw = wrapf(lerp_angle(car_yaw, target, k), -PI, PI)
	if absf(angle_difference(car_yaw, _drawn)) > EPS or is_inf(_drawn):
		queue_redraw()


func _process(dt: float) -> void:
	if car and visible:
		step(yaw_of(car.global_basis), dt)


## Canvas units per CSS pixel; the same sum as MapController.css_px.
func css_px() -> float:
	var vp := get_viewport()
	if vp == null:
		return 1.0
	var win := vp.get_visible_rect().size
	var real := Vector2(DisplayServer.window_get_size()) / maxf(DisplayServer.screen_get_scale(), 0.01)
	if real.y < 1.0 or DisplayServer.get_name() == "headless":
		return 1.0
	return clampf(win.y / real.y, 0.5, 4.0)


func _dial() -> float:
	return maxf(MIN_UNITS, DIAMETER_PX * css_px())


func _font_size() -> int:
	return int(round(_dial() * 0.19))


## Top-left, level with the minimap: the room hides
## the debug HUD there, the minimap and the pace-notes pad are on the right,
## the status line is bottom-left, and the follow camera keeps the car and
## the road ahead round the middle.
func _layout() -> void:
	var d := _dial()
	var m := MARGIN
	var pill := _font_size() * 1.5
	position = Vector2(m, m)
	size = Vector2(d, d + pill * 0.35 + pill)
	queue_redraw()


func _draw() -> void:
	_drawn = car_yaw
	var d := size.x
	var r := d * 0.5
	var c := Vector2(r, r)
	var u := d / 100.0 # one percent of the dial: every size below is in these
	var font: Font = _font if _font else ThemeDB.fallback_font
	# Bezel: ink disc, a cream hairline at the rim.
	draw_circle(c, r, Color(INK, 0.88), true, -1.0, true)
	draw_arc(c, r - 1.2 * u, 0.0, TAU, 72, Color(CREAM, 0.35), 1.2 * u, true)
	# Card. A bearing b sits at screen angle (b - heading), clockwise from up.
	var rot := card_rotation()
	var outer := r - 4.0 * u
	for i in 36:
		var a := rot + deg_to_rad(i * 10.0)
		var dir := Vector2(sin(a), -cos(a))
		var major := i % 3 == 0
		var tick := (9.0 if major else 5.0) * u
		var col := Color(CREAM, 0.9) if major else Color(CREAM, 0.45)
		if i == 0:
			col = AMBER
		draw_line(c + dir * (outer - tick), c + dir * outer, col, (2.0 if major else 1.1) * u, true)
	# Cardinals, upright, inside the ticks. N bigger and amber.
	var fs := int(round(15.0 * u))
	for i in 4:
		var a := rot + i * TAU / 4.0
		var dir := Vector2(sin(a), -cos(a))
		var txt: String = NAMES[i * 2]
		var size_i := int(round(fs * 1.15)) if i == 0 else fs
		var ts := font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, size_i)
		var at := c + dir * (outer - 19.0 * u)
		var base := at + Vector2(-ts.x * 0.5, (font.get_ascent(size_i) - font.get_descent(size_i)) * 0.5)
		draw_string(font, base, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, size_i, AMBER if i == 0 else Color(CREAM, 0.85))
	# Fixed: the lubber line at the top, and the car at the hub pointing at it.
	var top := c + Vector2(0, -r)
	draw_colored_polygon(PackedVector2Array([top + Vector2(-6.0 * u, -0.5 * u), top + Vector2(6.0 * u, -0.5 * u), top + Vector2(0, 9.0 * u)]), CREAM)
	draw_line(top + Vector2(0, 8.0 * u), top + Vector2(0, 20.0 * u), CREAM, 1.6 * u, true)
	var car_pts := PackedVector2Array([
		c + Vector2(0, -11.0 * u), c + Vector2(7.0 * u, 8.0 * u), c + Vector2(0, 4.0 * u), c + Vector2(-7.0 * u, 8.0 * u)])
	draw_colored_polygon(car_pts, CREAM)
	draw_polyline(car_pts + PackedVector2Array([car_pts[0]]), Color(INK, 0.9), 1.0 * u, true)
	# Readout: an ink pill under the dial, "042° NE" in tabular figures.
	var rfs := _font_size()
	var rt := text()
	var rs := font.get_string_size(rt, HORIZONTAL_ALIGNMENT_LEFT, -1, rfs)
	var ph := rfs * 1.5
	var pw := maxf(rs.x + rfs * 1.1, d * 0.72)
	var pill := Rect2((d - pw) * 0.5, d + ph * 0.35, pw, ph)
	var sb := _pill_box
	sb.bg_color = Color(INK, 0.88)
	sb.border_color = Color(CREAM, 0.35)
	sb.set_border_width_all(maxi(1, int(round(1.2 * u))))
	sb.set_corner_radius_all(int(ph * 0.5))
	sb.anti_aliasing = true
	draw_style_box(sb, pill)
	var rb := Vector2((d - rs.x) * 0.5, pill.position.y + (ph + font.get_ascent(rfs) - font.get_descent(rfs)) * 0.5)
	draw_string(font, rb, rt, HORIZONTAL_ALIGNMENT_LEFT, -1, rfs, CREAM)
