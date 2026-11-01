class_name SkyClock
extends Node
## One sky clock for the whole stage. The host sends the run clock as a
## snapshot (`clock` event: ms, running); this node carries it forward
## between events and says how dark it is. Weather, the light and the
## headlights all read from here, so they can't disagree.
##
## (Not `Sky`: that's a Godot class, and a script can't take its name.)
##
## Advances by wall time, not the render delta. A hidden browser tab stops
## _process; the next frame catches up by the wall time that passed, so the
## sky never falls behind the server's clock.
##
## light_at mirrors lightAt in shared/sky.ts; tests/sky_cases.json pins both.

signal changed
## The light moved enough to show (darkness or tint by more than PUSH_EPS,
## or it landed on an end). Weather pushes these into the shaders, main into
## the eye-level sky and fog. A static sky emits it once, not every frame.
signal light_changed(dark: float, tint: Color)

const DARK := {"day": 0.0, "dawn": 0.35, "dusk": 0.35, "night": 1.0}
## Multiplied into every world colour at eye level (never the map). Day is
## white: today's look. Starting values, tuned by eye.
const TINTS := {
	"day": Color(1.0, 1.0, 1.0),
	"dawn": Color(0.85, 0.88, 1.0),
	"dusk": Color(1.0, 0.82, 0.68),
	"night": Color(0.55, 0.62, 0.9),
}
const PUSH_EPS := 0.002
const LIGHTS := ["day", "dawn", "dusk", "night"]

var clock := 0.0 ## seconds of run clock
var running := false
var plan := {"from": "day", "to": "day", "atMs": 0.0, "overMs": 0.0}
var _wall_usec := 0 ## ticks at the last advance
var _sent_dark := -1.0 ## what light_changed said last; -1: nothing yet
var _sent_tint := Color(-1, -1, -1)


func set_plan(p: Dictionary) -> void:
	var l: Variant = p.get("light")
	if not (l is Dictionary) or not (l.get("from") in LIGHTS) or not (l.get("to") in LIGHTS) \
			or not _is_num(l.get("atMs")) or not _is_num(l.get("overMs")):
		plan = {"from": "day", "to": "day", "atMs": 0.0, "overMs": 0.0}
	else:
		plan = {"from": l["from"], "to": l["to"], "atMs": float(l["atMs"]), "overMs": float(l["overMs"])}
	refresh()


func set_clock(ms: float, run: bool) -> void:
	clock = ms / 1000.0
	running = run
	_wall_usec = Time.get_ticks_usec()
	refresh()


## Where the light sits between from and to at `ms`: k 0 is all from, 1 all to.
func light_at(ms: float) -> Dictionary:
	var over: float = plan.overMs
	var k := 1.0 if over <= 0.0 else clampf((ms - float(plan.atMs)) / over, 0.0, 1.0)
	return {"from": plan.from, "to": plan.to, "k": k}


## 0 (day) to 1 (night) at `clock`. Day into night goes through dusk: 0.35 at
## k 0.5, not the straight line's 0.5.
func darkness() -> float:
	return _along(DARK)


## The colour the light has at `clock`, from TINTS, along the same path.
func tint() -> Color:
	return _along(TINTS)


## A row of `table` (DARK, TINTS) blended from -> to at `clock`.
func _along(table: Dictionary) -> Variant:
	var l := light_at(clock * 1000.0)
	var a: Variant = table[l.from]
	var b: Variant = table[l.to]
	var k: float = l.k
	if (l.from == "day" and l.to == "night") or (l.from == "night" and l.to == "day"):
		var mid: Variant = table["dusk"]
		return lerp(a, mid, k * 2.0) if k < 0.5 else lerp(mid, b, k * 2.0 - 1.0)
	return lerp(a, b, k)


## Emits light_changed if the light moved by more than PUSH_EPS since the
## last one (or reached an end exactly, so a ramp can't stop at 0.999), or
## always with `force`. Cheap: two lerps and a compare.
func refresh(force := false) -> void:
	var d := darkness()
	var c := tint()
	var moved := maxf(absf(d - _sent_dark), maxf(absf(c.r - _sent_tint.r), maxf(absf(c.g - _sent_tint.g), absf(c.b - _sent_tint.b))))
	var at_end := (d == 0.0 or d == 1.0) and moved > 0.0
	if not force and moved <= PUSH_EPS and not at_end:
		return
	_sent_dark = d
	_sent_tint = c
	light_changed.emit(d, c)


func _process(_dt: float) -> void:
	var now := Time.get_ticks_usec()
	if running:
		clock += float(now - _wall_usec) / 1_000_000.0
	_wall_usec = now
	changed.emit()
	refresh()


static func _is_num(v: Variant) -> bool:
	return v is float or v is int
