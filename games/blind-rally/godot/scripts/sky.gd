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

const DARK := {"day": 0.0, "dawn": 0.35, "dusk": 0.35, "night": 1.0}
const LIGHTS := ["day", "dawn", "dusk", "night"]

var clock := 0.0 ## seconds of run clock
var running := false
var plan := {"from": "day", "to": "day", "atMs": 0.0, "overMs": 0.0}
var _wall_usec := 0 ## ticks at the last advance


func set_plan(p: Dictionary) -> void:
	var l: Variant = p.get("light")
	if not (l is Dictionary) or not (l.get("from") in LIGHTS) or not (l.get("to") in LIGHTS) \
			or not _is_num(l.get("atMs")) or not _is_num(l.get("overMs")):
		plan = {"from": "day", "to": "day", "atMs": 0.0, "overMs": 0.0}
		return
	plan = {"from": l["from"], "to": l["to"], "atMs": float(l["atMs"]), "overMs": float(l["overMs"])}


func set_clock(ms: float, run: bool) -> void:
	clock = ms / 1000.0
	running = run
	_wall_usec = Time.get_ticks_usec()


## Where the light sits between from and to at `ms`: k 0 is all from, 1 all to.
func light_at(ms: float) -> Dictionary:
	var over: float = plan.overMs
	var k := 1.0 if over <= 0.0 else clampf((ms - float(plan.atMs)) / over, 0.0, 1.0)
	return {"from": plan.from, "to": plan.to, "k": k}


## 0 (day) to 1 (night) at `clock`. Day into night goes through dusk: 0.35 at
## k 0.5, not the straight line's 0.5.
func darkness() -> float:
	var l := light_at(clock * 1000.0)
	var a: float = DARK[l.from]
	var b: float = DARK[l.to]
	var k: float = l.k
	if (l.from == "day" and l.to == "night") or (l.from == "night" and l.to == "day"):
		var mid: float = DARK["dusk"]
		return lerpf(a, mid, k * 2.0) if k < 0.5 else lerpf(mid, b, k * 2.0 - 1.0)
	return lerpf(a, b, k)


func _process(_dt: float) -> void:
	var now := Time.get_ticks_usec()
	if running:
		clock += float(now - _wall_usec) / 1_000_000.0
	_wall_usec = now
	changed.emit()


static func _is_num(v: Variant) -> bool:
	return v is float or v is int
