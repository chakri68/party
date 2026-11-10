extends RefCounted
## ChunkStreamer (scripts/world/chunk_streamer.gd) over every fixture. Run
## from run_tests.gd, with its helpers and its pass/fail count.

const LOAD_LIMIT_MS := 3000

var t ## the runner (run_tests.gd)
var load_ms: Array[int] = []


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("streaming")
	for n in range(1, t.FIXTURES + 1):
		await test_fixture(n)
	print("  load_initial ms per fixture: %s" % [load_ms])


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _streamer(field: TerrainField) -> ChunkStreamer:
	var s := ChunkStreamer.new()
	t.root.add_child(s)
	s.setup(field, t.ground_material())
	return s


## Chunk centres within `r` of `at`, inside the world.
func _within(at: Vector3, r: float) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for cz in range(-15, 15):
		for cx in range(-15, 15):
			var c := Vector2(cx * 64 + 32, cz * 64 + 32)
			if c.distance_to(Vector2(at.x, at.z)) <= r:
				out.append(Vector2i(cx, cz))
	return out


func _all_loaded_within(s: ChunkStreamer, at: Vector3, r: float) -> bool:
	for k in _within(at, r):
		if not s.has_chunk(k.x, k.y):
			return false
	return true


func _none_beyond(s: ChunkStreamer, at: Vector3, r: float) -> bool:
	for cz in range(-20, 20):
		for cx in range(-20, 20):
			if s.has_chunk(cx, cz) and Vector2(cx * 64 + 32, cz * 64 + 32).distance_to(Vector2(at.x, at.z)) > r:
				return false
	return true


func _focus_chunk(at: Vector3) -> Vector2i:
	return Vector2i(floori(at.x / 64.0), floori(at.z / 64.0))


func test_fixture(n: int) -> void:
	var field := TerrainField.from_layout(t.layout(n))
	var s := _streamer(field)
	var at := field.spawn
	var ms := s.load_initial(at)
	load_ms.append(ms)
	var want := _within(at, ChunkStreamer.LOAD_RADIUS)
	check(_all_loaded_within(s, at, ChunkStreamer.LOAD_RADIUS) and s.loaded_count() == want.size(), "layout %d: load_initial builds the %d in-radius chunks" % [n, want.size()])
	check(_none_beyond(s, at, ChunkStreamer.UNLOAD_RADIUS), "layout %d: nothing beyond UNLOAD_RADIUS" % n)
	check(ms < LOAD_LIMIT_MS, "layout %d: load_initial took %d ms (< %d)" % [n, ms, LOAD_LIMIT_MS])
	check(not s.has_chunk(-16, 0) and not s.has_chunk(15, 0) and not s.has_chunk(0, 15), "layout %d: no chunks outside the world" % n)

	# Nothing to build: one update is cheap.
	var t0 := Time.get_ticks_usec()
	s.update(at)
	var us := Time.get_ticks_usec() - t0
	check(us < 1000, "layout %d: an idle update takes %d us (< 1 ms)" % [n, us])

	# Review Focus 2: the buggy outruns the builder. Teleport 300 m toward the
	# map centre; one update must build the ground under you and around it.
	var dir := Vector3(-at.x, 0, -at.z).normalized() if Vector2(at.x, at.z).length() > 1.0 else Vector3(1, 0, 0)
	var jump := at + dir * 300.0
	s.update(jump)
	var fc := _focus_chunk(jump)
	var ring_ok := true
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			ring_ok = ring_ok and s.has_chunk(fc.x + dx, fc.y + dz)
	check(ring_ok, "layout %d: after a 300 m jump, one update builds the focus chunk and its 8 neighbours" % n)

	# Move 600 m away and update until nothing changes: old chunks go.
	var far := at + dir * 600.0
	far.x = clampf(far.x, -900, 900)
	far.z = clampf(far.z, -900, 900)
	var frames := 0
	var last := -1
	var still := 0
	while still < 3 and frames < 2000:
		s.update(far)
		frames += 1
		if s.loaded_count() == last:
			still += 1
		else:
			still = 0
		last = s.loaded_count()
		await t.process_frame
	check(_all_loaded_within(s, far, ChunkStreamer.LOAD_RADIUS), "layout %d: after a 600 m move, every in-radius chunk is built (%d frames)" % [n, frames])
	check(_none_beyond(s, far, ChunkStreamer.UNLOAD_RADIUS), "layout %d: chunks beyond UNLOAD_RADIUS are freed" % n)
	var keep := _within(far, ChunkStreamer.UNLOAD_RADIUS).size()
	check(s.loaded_count() <= keep, "layout %d: %d chunks loaded, no more than the %d within UNLOAD_RADIUS" % [n, s.loaded_count(), keep])
	var nodes := 0
	for c in s.get_children():
		if c is TerrainChunk and not c.is_queued_for_deletion():
			nodes += 1
	check(nodes == s.loaded_count(), "layout %d: freed chunks leave the tree" % n)
	s.queue_free()
	await t.process_frame
