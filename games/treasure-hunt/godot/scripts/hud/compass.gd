class_name Compass
extends Control
## The strip at the top centre: ±60° either side of where the camera looks,
## a tick every 10°, a label every 30° (N, E, S, W at 0, 90, 180, 270), and
## the heading as a number under the middle mark. North is −Z. Bearing clues
## need this; the full map is M3.
##
## One _draw() and nothing else, redrawn only when the heading moves by
## REDRAW_DEG or more.

const SPAN_DEG := 60.0
const PX_PER_DEG := 4.0
const STRIP_H := 30.0
const REDRAW_DEG := 0.5

var heading_deg := 0.0

var _drawn := 0.0
var _have := false


func _init() -> void:
	mouse_filter = MOUSE_FILTER_IGNORE
	custom_minimum_size = Vector2(SPAN_DEG * 2.0 * PX_PER_DEG, STRIP_H + 22.0)
	set_anchors_preset(PRESET_CENTER_TOP)
	var w := custom_minimum_size.x
	offset_left = -w * 0.5
	offset_right = w * 0.5
	offset_top = 8.0
	offset_bottom = 8.0 + custom_minimum_size.y


## Degrees clockwise from north (−Z) for a flat forward `f`, in [0, 360).
static func heading_of(f: Vector3) -> float:
	return fposmod(rad_to_deg(atan2(f.x, -f.z)) + 360.0, 360.0)


## The camera's yaw (rotation about +Y): forward is (−sin, 0, −cos).
func set_yaw(yaw: float) -> void:
	set_heading(heading_of(Vector3(-sin(yaw), 0.0, -cos(yaw))))


func set_heading(deg: float) -> void:
	heading_deg = deg
	if not _have or absf(angle_difference(deg_to_rad(deg), deg_to_rad(_drawn))) >= deg_to_rad(REDRAW_DEG):
		_have = true
		_drawn = deg
		queue_redraw()


func _draw() -> void:
	var font := get_theme_default_font()
	var w := size.x
	var mid := w * 0.5
	draw_rect(Rect2(0, 0, w, STRIP_H), Color(0, 0, 0, 0.35))
	var first := ceili((_drawn - SPAN_DEG) / 10.0) * 10
	var d := first
	while d <= _drawn + SPAN_DEG:
		var x := mid + (d - _drawn) * PX_PER_DEG
		var b := posmod(d, 360)
		if b % 30 == 0:
			draw_line(Vector2(x, 0), Vector2(x, 9), Color.WHITE, 2.0)
			var text := _label(b)
			var fs := 15 if text.length() == 1 else 11
			var tw := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
			draw_string(font, Vector2(x - tw * 0.5, 25), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
				Color(1, 0.85, 0.4) if b == 0 else Color.WHITE)
		else:
			draw_line(Vector2(x, 0), Vector2(x, 6), Color(1, 1, 1, 0.7), 1.0)
		d += 10
	# Where you're looking: a mark in the middle and the number under it.
	draw_line(Vector2(mid, 0), Vector2(mid, STRIP_H), Color(1, 0.85, 0.4), 2.0)
	var num := "%d°" % (roundi(_drawn) % 360)
	var nw := font.get_string_size(num, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x
	draw_string_outline(font, Vector2(mid - nw * 0.5, STRIP_H + 17), num, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, 4, Color(0, 0, 0, 0.8))
	draw_string(font, Vector2(mid - nw * 0.5, STRIP_H + 17), num, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.WHITE)


static func _label(b: int) -> String:
	match b:
		0: return "N"
		90: return "E"
		180: return "S"
		270: return "W"
	return str(b)
