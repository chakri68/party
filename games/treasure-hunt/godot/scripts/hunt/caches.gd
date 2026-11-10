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

var field: TerrainField

var _crates := {} ## id -> Cache
var _found := {} ## id -> true, including ids not revealed yet


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
	var c: Cache = _crates.get(id)
	if c:
		c.mark_found()


## The id of the nearest unfound cache within CLAIM_RANGE of `pos`, or "".
func nearest_claimable(pos: Vector3) -> String:
	var best := ""
	var best_d := CLAIM_RANGE
	for id: String in _crates:
		if _found.has(id):
			continue
		var p: Vector3 = (_crates[id] as Cache).global_position
		if absf(p.y - pos.y) > CLAIM_RISE:
			continue
		var d := Vector2(p.x - pos.x, p.z - pos.z).length()
		if d <= best_d:
			best_d = d
			best = id
	return best


func clear() -> void:
	for c: Node in _crates.values():
		c.queue_free()
	_crates.clear()
	_found.clear()


func count() -> int:
	return _crates.size()


func crate(id: String) -> Cache:
	return _crates.get(id)
