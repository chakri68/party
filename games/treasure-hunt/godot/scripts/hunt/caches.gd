class_name Caches
extends Node3D
## The caches you've come close to (the server reveals them at 40 m, R1).
## Everything here is idempotent: the view re-sends every reveal and every
## found id on each state update, so seeing one twice must change nothing.
## main builds one per world and points `field` at that world's ground.

## Mirrors CLAIM_RANGE in shared/world.ts: E picks up within this, on the
## flat. The server checks a looser 6 m, for lag.
const CLAIM_RANGE := 3.0
## And not from a ledge this far above or below it.
const CLAIM_RISE := 2.5
## After a claim goes out, that cache isn't claimable again for this long,
## so a second E inside one round trip doesn't send a second claim. found()
## ends the hold early; a real reject (moved too fast, no position) just
## lets it lapse, and you can try again.
const CLAIM_HOLD_S := 1.5

var field: TerrainField

var _crates := {} ## id -> Cache
var _found := {} ## id -> true, including ids not revealed yet
var _claimed := {} ## id -> _now when its claim went out
var _now := 0.0 ## seconds of game time, so it runs with the engine's clock


func _process(dt: float) -> void:
	_now += dt


## Puts cache `id` at height_at(x, z) + dy. A second reveal of the same id
## does nothing.
func reveal(id: String, x: float, z: float, dy: float) -> void:
	if _crates.has(id) or field == null:
		return
	var c := Cache.new(id)
	add_child(c)
	c.global_position = Vector3(x, field.height_at(x, z) + dy, z)
	_crates[id] = c
	if _found.has(id):
		c.mark_found()


## Someone (you) found it. Fine before its reveal: it'll arrive found.
func found(id: String) -> void:
	_found[id] = true
	_claimed.erase(id)
	var c: Cache = _crates.get(id)
	if c:
		c.mark_found()


## The id of the nearest unfound cache within CLAIM_RANGE of `pos`, or "".
func nearest_claimable(pos: Vector3) -> String:
	var best := ""
	var best_d := CLAIM_RANGE
	for id: String in _crates:
		if _found.has(id) or (_claimed.has(id) and _now - float(_claimed[id]) < CLAIM_HOLD_S):
			continue
		var p: Vector3 = (_crates[id] as Cache).global_position
		if absf(p.y - pos.y) > CLAIM_RISE:
			continue
		var d := Vector2(p.x - pos.x, p.z - pos.z).length()
		if d <= best_d:
			best_d = d
			best = id
	return best


## A claim for `id` just went out: hold it for CLAIM_HOLD_S.
func mark_claimed(id: String) -> void:
	_claimed[id] = _now


func clear() -> void:
	for c: Node in _crates.values():
		c.queue_free()
	_crates.clear()
	_found.clear()
	_claimed.clear()


func count() -> int:
	return _crates.size()


func crate(id: String) -> Cache:
	return _crates.get(id)


## The strips catch the torch: lit on every cache still out, within
## GLINT_RANGE of `from`, while the torch is on and it is dark enough.
func glint(from: Vector3, torch_on: bool, dark: float) -> void:
	var night := torch_on and dark >= DayClock.LAMP_ON
	for c: Cache in _crates.values():
		c.set_glint(night and c.visible and not c.found and c.global_position.distance_to(from) <= DayClock.GLINT_RANGE)
