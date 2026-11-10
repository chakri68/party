class_name DayClock
extends Node
## The round's game time, in minutes after midnight. The host sends it as a
## snapshot (skyClock: min, running); this node carries it forward at 1 game
## minute per real minute and says when the dark moves.
##
## Same idea as Blind Rally's SkyClock: wall time, not the render delta. A
## hidden tab stops _process, but minute() is the anchor plus the wall time
## since it, so the next frame is already on time.
##
## sun_at and dark_at mirror sunAt and darkAt in shared/sky.ts, and the
## constants below are copied from it. tests/day_cases.json pins both.

## The dark moved by more than DARK_EPS, or landed on 0 or 1. Lamps and
## headlights hang off this. The first refresh (or set_clock) always says it.
signal dark_changed(dark: float)

# Copied from shared/sky.ts.
const START_MIN := {"day": 600.0, "dusk": 1060.0, "night": 1320.0}
const SUNRISE := 360.0
const SUNSET := 1080.0
const SUN_MAX_EL := 55.0
const DARK_LIGHT_EL := 6.0
const DARK_FULL_EL := -6.0

const DAY := 1440.0
const DARK_EPS := 0.01

var running := false
## Test seam: when >= 0, the wall clock reads this instead of Time.
var fake_usec := -1

var _min: float = START_MIN.day ## the minute at _at_usec
var _at_usec := 0
var _sent_dark := -1.0 ## what dark_changed said last; -1: nothing yet


## Az is a compass bearing (0 north, -Z; 90 east, +X), el degrees above the
## horizon, negative at night. x is az, y is el.
static func sun_at(m: float) -> Vector2:
	# t runs 0 at sunrise to 1 at sunset; outside that the sun is below the horizon.
	var t := (fposmod(m, DAY) - SUNRISE) / (SUNSET - SUNRISE)
	return Vector2(fposmod(90.0 + 180.0 * t, 360.0), SUN_MAX_EL * sin(PI * t))


## 0 in full light, 1 in full dark. Smoothstep on the sun's elevation.
static func dark_at(m: float) -> float:
	var x := clampf((DARK_LIGHT_EL - sun_at(m).y) / (DARK_LIGHT_EL - DARK_FULL_EL), 0.0, 1.0)
	return x * x * (3.0 - 2.0 * x)


func set_clock(m: float, run: bool) -> void:
	_min = m
	running = run
	_at_usec = _now()
	refresh()


func minute() -> float:
	if not running:
		return _min
	return _min + float(_now() - _at_usec) / 60_000_000.0


## Says the dark if it moved enough. _process runs it; tests call it.
func refresh() -> void:
	var d := dark_at(minute())
	var moved := absf(d - _sent_dark)
	if moved > DARK_EPS or ((d == 0.0 or d == 1.0) and moved > 0.0):
		_sent_dark = d
		dark_changed.emit(d)


func _process(_dt: float) -> void:
	refresh()


func _now() -> int:
	return fake_usec if fake_usec >= 0 else Time.get_ticks_usec()
