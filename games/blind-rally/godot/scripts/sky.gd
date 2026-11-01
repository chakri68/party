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

## The light moved enough to show (darkness or tint by more than PUSH_EPS,
## or it landed on an end). Weather pushes these into the shaders, main into
## the eye-level sky and fog. A static sky emits it once, not every frame.
signal light_changed(dark: float, tint: Color)
## set_plan ran: what's decided once per plan (sun shadows) is decided now.
signal plan_changed
## The rain or the road's wetness moved enough to matter (more than PUSH_EPS,
## or one landed on its end). Cars read wet from here. Emitted at once on
## set_plan and set_clock, so a reload mid-storm has the right grip this frame.
signal rain_changed(rain: float, wet: float)

const DARK := {"day": 0.0, "dawn": 0.35, "dusk": 0.35, "night": 1.0}
## Multiplied into every world colour at eye level (never the map). Day is
## white: today's look. Starting values, tuned by eye.
const TINTS := {
	"day": Color(1.0, 1.0, 1.0),
	"dawn": Color(0.85, 0.88, 1.0),
	"dusk": Color(1.0, 0.82, 0.68),
	"night": Color(0.55, 0.62, 0.9),
}
## What the dark leaves of the sky, the fog and everything unshaded that
## stands in for distance or air (treeline, far landmarks, mist, snowfall).
## Above the ground's NIGHT_FLOOR (weather.gdshaderinc, 0.12), so treetops
## still show against the sky, but low enough that the horizon doesn't glow
## over a dark stage. The shaders' sky_haze() uses the same number.
const HAZE_FLOOR := 0.3
const PUSH_EPS := 0.002
## The road soaks slower than it rains and dries slower than it soaks.
## Mirrors WET_LAG_UP_MS / WET_LAG_DOWN_MS in shared/sky.ts.
const WET_LAG_UP_MS := 20000.0
const WET_LAG_DOWN_MS := 40000.0
const LIGHTS := ["day", "dawn", "dusk", "night"]

var clock := 0.0 ## seconds of run clock
var running := false
var plan := {"from": "day", "to": "day", "atMs": 0.0, "overMs": 0.0}
var _wall_usec := 0 ## ticks at the last advance
var _sent_dark := -1.0 ## what light_changed said last; -1: nothing yet
var _sent_tint := Color(-1, -1, -1)
var rain_plan := {"from": 0.0, "to": 0.0, "atMs": 0.0, "overMs": 0.0} ## missing or malformed: dry
var _sent_rain := -1.0
var _sent_wet := -1.0


func set_plan(p: Dictionary) -> void:
	var l: Variant = p.get("light")
	if not (l is Dictionary) or not (l.get("from") in LIGHTS) or not (l.get("to") in LIGHTS) \
			or not _is_num(l.get("atMs")) or not _is_num(l.get("overMs")):
		plan = {"from": "day", "to": "day", "atMs": 0.0, "overMs": 0.0}
	else:
		plan = {"from": l["from"], "to": l["to"], "atMs": float(l["atMs"]), "overMs": float(l["overMs"])}
	var r: Variant = p.get("rain")
	if r is Dictionary and _is_num(r.get("from")) and _is_num(r.get("to")) \
			and _is_num(r.get("atMs")) and _is_num(r.get("overMs")):
		rain_plan = {"from": float(r["from"]), "to": float(r["to"]), "atMs": float(r["atMs"]), "overMs": float(r["overMs"])}
	else:
		rain_plan = {"from": 0.0, "to": 0.0, "atMs": 0.0, "overMs": 0.0}
	plan_changed.emit()
	refresh()


## Night start to finish: the only plan with no sun shadows. Decided per
## plan, never mid-race: a shadow switch swaps every lit material's shader
## variant in one frame. A day-into-night run keeps them; at night they're
## multiplied down with everything else anyway.
func static_night() -> bool:
	return plan.from == "night" and plan.to == "night"


## At an end of the ramp (k 0 or 1): values here are exact table rows.
func landed() -> bool:
	var k: float = light_at(clock * 1000.0).k
	return k == 0.0 or k == 1.0


## How far the light moved between two (darkness, tint) pairs: the largest
## change in darkness or any tint channel.
static func moved(d0: float, c0: Color, d1: float, c1: Color) -> float:
	return maxf(absf(d1 - d0), maxf(absf(c1.r - c0.r), maxf(absf(c1.g - c0.g), absf(c1.b - c0.b))))


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


## The colour of the sky, fog and unshaded stand-ins at darkness `dark`
## under `tint`: the tint, dimmed toward HAZE_FLOOR. Day: the tint itself.
static func haze(dark: float, tint_now: Color) -> Color:
	var k := lerpf(1.0, HAZE_FLOOR, clampf(dark, 0.0, 1.0))
	return Color(tint_now.r * k, tint_now.g * k, tint_now.b * k)


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
## last one (or landed on an end, so a ramp can't stop at 0.999), or
## always with `force`. Cheap: two lerps and a compare.
func refresh(force := false) -> void:
	_refresh_rain(force)
	var d := darkness()
	var c := tint()
	var m := moved(_sent_dark, _sent_tint, d, c)
	if not force and m <= PUSH_EPS and not (landed() and m > 0.0):
		return
	_sent_dark = d
	_sent_tint = c
	light_changed.emit(d, c)


## How hard it rains at `ms`, 0..1. Mirrors rainAt in shared/sky.ts.
func rain_at(ms: float) -> float:
	return _ramp(rain_plan.from, rain_plan.to, rain_plan.atMs, rain_plan.overMs, ms)


## How wet the road is at `ms`, 0..1: slow to soak, slower to dry.
## Mirrors wetnessAt in shared/sky.ts.
func wetness_at(ms: float) -> float:
	var lag := WET_LAG_UP_MS if rain_plan.to > rain_plan.from else WET_LAG_DOWN_MS
	return _ramp(rain_plan.from, rain_plan.to, rain_plan.atMs, rain_plan.overMs + lag, ms)


func rain() -> float:
	return rain_at(clock * 1000.0)


func wetness() -> float:
	return wetness_at(clock * 1000.0)


static func _ramp(from: float, to: float, at_ms: float, over_ms: float, ms: float) -> float:
	if from == to:
		return to
	var k := 1.0 if over_ms <= 0.0 else clampf((ms - at_ms) / over_ms, 0.0, 1.0)
	return from + (to - from) * k


## rain_changed, on the same terms as light_changed.
func _refresh_rain(force: bool) -> void:
	var r := rain()
	var w := wetness()
	var m := maxf(absf(r - _sent_rain), absf(w - _sent_wet))
	var landed_now: bool = r == rain_plan.to or w == rain_plan.to
	if not force and m <= PUSH_EPS and not (landed_now and m > 0.0):
		return
	_sent_rain = r
	_sent_wet = w
	rain_changed.emit(r, w)


func _process(_dt: float) -> void:
	var now := Time.get_ticks_usec()
	if running:
		clock += float(now - _wall_usec) / 1_000_000.0
	_wall_usec = now
	refresh()


static func _is_num(v: Variant) -> bool:
	return v is float or v is int
