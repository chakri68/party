class_name ChunkStreamer
extends Node3D
## Keeps near ground built around a moving point. No threads (the web build
## has none), so building is time-sliced: a few ms of chunks per frame,
## nearest first. The 3 × 3 under the focus are built at once, budget or
## not, so a fast buggy never drives off the edge of the built world.

const LOAD_RADIUS := 400.0
const UNLOAD_RADIUS := 480.0
const FRAME_BUDGET_MS := 4.0

## Chunk indices that exist: the world is ±960 m, 30 chunks a side.
const MIN_C := -15
const MAX_C := 14

var _field: TerrainField
var _mat: Material
var _chunks := {} # Vector2i -> TerrainChunk
## A photo's spot (hold): chunks within LOAD_RADIUS of it outlive the focus moving off.
var _held: Variant = null # Vector3 or null


func setup(field: TerrainField, mat: Material) -> void:
	_field = field
	_mat = mat


## Builds every chunk within LOAD_RADIUS of `at`, now. Returns elapsed ms.
func load_initial(at: Vector3) -> int:
	var t0 := Time.get_ticks_usec()
	for k in _missing(at):
		_build(k)
	return int((Time.get_ticks_usec() - t0) / 1000)


## The chunk under `at` and its 8 neighbours, now, whatever the budget.
func ensure_around(at: Vector3) -> void:
	var c := _cell(at)
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var k := Vector2i(c.x + dx, c.y + dz)
			if _inside(k) and not _chunks.has(k):
				_build(k)


## Once a frame: the ground under you, then nearest missing chunks until the
## budget is gone, then drop what's fallen behind.
func update(at: Vector3) -> void:
	var t0 := Time.get_ticks_usec()
	ensure_around(at)
	var missing := _missing(at)
	if not missing.is_empty():
		var p := Vector2(at.x, at.z)
		missing.sort_custom(func(a: Vector2i, b: Vector2i) -> bool: return _centre(a).distance_squared_to(p) < _centre(b).distance_squared_to(p))
		var budget_us := FRAME_BUDGET_MS * 1000.0
		for k in missing:
			if Time.get_ticks_usec() - t0 >= budget_us:
				break
			_build(k)
	_unload(at)


## Keeps chunks within LOAD_RADIUS of `at` from unloading until release().
## One point at a time: a second hold moves it.
func hold(at: Vector3) -> void:
	_held = at


func release() -> void:
	_held = null


func is_held() -> bool:
	return _held != null


func has_chunk(cx: int, cz: int) -> bool:
	return _chunks.has(Vector2i(cx, cz))


func loaded_count() -> int:
	return _chunks.size()


func _build(k: Vector2i) -> void:
	var c := TerrainChunk.build(_field, k.x, k.y, _mat)
	_chunks[k] = c
	add_child(c)


## In-radius chunks not built yet, in no particular order.
func _missing(at: Vector3) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	var p := Vector2(at.x, at.z)
	var r2 := LOAD_RADIUS * LOAD_RADIUS
	var size := TerrainField.CHUNK
	var x0 := maxi(MIN_C, floori((at.x - LOAD_RADIUS) / size))
	var x1 := mini(MAX_C, floori((at.x + LOAD_RADIUS) / size))
	var z0 := maxi(MIN_C, floori((at.z - LOAD_RADIUS) / size))
	var z1 := mini(MAX_C, floori((at.z + LOAD_RADIUS) / size))
	for cz in range(z0, z1 + 1):
		for cx in range(x0, x1 + 1):
			var k := Vector2i(cx, cz)
			if not _chunks.has(k) and _centre(k).distance_squared_to(p) <= r2:
				out.append(k)
	return out


func _unload(at: Vector3) -> void:
	var p := Vector2(at.x, at.z)
	var r2 := UNLOAD_RADIUS * UNLOAD_RADIUS
	var held := Vector2(_held.x, _held.z) if _held != null else Vector2.ZERO
	var keep2 := LOAD_RADIUS * LOAD_RADIUS
	var gone: Array[Vector2i] = []
	for k: Vector2i in _chunks:
		var c := _centre(k)
		if c.distance_squared_to(p) > r2 and (_held == null or c.distance_squared_to(held) > keep2):
			gone.append(k)
	for k in gone:
		var c: TerrainChunk = _chunks[k]
		_chunks.erase(k)
		remove_child(c)
		c.queue_free()


func _cell(at: Vector3) -> Vector2i:
	return Vector2i(floori(at.x / TerrainField.CHUNK), floori(at.z / TerrainField.CHUNK))


func _centre(k: Vector2i) -> Vector2:
	var half := TerrainField.CHUNK * 0.5
	return Vector2(k.x * TerrainField.CHUNK + half, k.y * TerrainField.CHUNK + half)


static func _inside(k: Vector2i) -> bool:
	return k.x >= MIN_C and k.x <= MAX_C and k.y >= MIN_C and k.y <= MAX_C
