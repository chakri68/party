extends RefCounted
## M4a's photo clues: Photos renders one pose at a time (the capture is a
## seam here: the headless renderer draws nothing), once per pose, and
## ChunkStreamer.hold keeps the ground under a photo from unloading.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)


## The real render path with a fixed 4 × 4 capture.
class FakePhotos extends Photos:
	func _capture() -> Image:
		return Image.create(4, 4, false, Image.FORMAT_RGB8)


## The real path with the headless renderer's empty frame.
class BlankPhotos extends Photos:
	var tries := 0

	func _capture() -> Image:
		tries += 1
		return null


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("photos")
	await test_render_once_per_pose()
	await test_before_world()
	await test_queued_pose_replaced()
	test_hold()
	await test_blank_capture()
	await test_main_wiring()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _world() -> Dictionary:
	var field := TerrainField.from_layout(t.layout(1))
	var s := ChunkStreamer.new()
	t.root.add_child(s)
	s.setup(field, t.ground_material())
	return {"field": field, "streamer": s}


## Frames until `got` has `n` entries, or `limit` frames went by.
func _until(got: Array, n: int, limit := 120) -> void:
	for i in limit:
		if got.size() >= n:
			return
		await t.process_frame


func _pose(id: String, x: float, z: float, yaw := 0.5) -> Dictionary:
	return {"id": id, "x": x, "z": z, "yaw": yaw, "pitch": 0.05}


func test_render_once_per_pose() -> void:
	var w := _world()
	var p := FakePhotos.new()
	t.root.add_child(p)
	p.set_world(w.field, w.streamer)
	var got: Array = []
	p.photo_ready.connect(func(id: String, x: float, z: float, data: String) -> void: got.append([id, data, x, z]))

	p.set_list([_pose("c1", 10, 20), _pose("c2", -30, 40)])
	await _until(got, 2)
	check(got.size() == 2 and got[0][0] == "c1" and got[1][0] == "c2", "two poses: two photos, in order (%s)" % [got.map(func(g: Array) -> String: return g[0])])
	var jpg := Marshalls.base64_to_raw(got[0][1]) if got.size() > 0 else PackedByteArray()
	check(jpg.size() > 2 and jpg[0] == 0xFF and jpg[1] == 0xD8, "the data is base64 JPEG")
	check(not p.busy(), "idle after the queue empties")

	p.set_list([_pose("c1", 10, 20), _pose("c2", -30, 40)])
	await _until(got, 3, 20)
	check(got.size() == 2, "the same list again: nothing")

	p.set_list([_pose("c1", 12, 20), _pose("c2", -30, 40)])
	await _until(got, 4, 120)
	check(got.size() == 3 and got[2][0] == "c1", "the same id with a new pose: once (%d)" % got.size())
	check(got.size() == 3 and is_equal_approx(got[2][2], 12.0) and is_equal_approx(got[2][3], 20.0), "the photo names the pose it was rendered at")
	check(not w.streamer.is_held(), "the streamer is let go after each photo")

	p.queue_free()
	w.streamer.queue_free()
	await t.process_frame


func test_before_world() -> void:
	var p := FakePhotos.new()
	t.root.add_child(p)
	var got: Array = []
	p.photo_ready.connect(func(id: String, _x: float, _z: float, _data: String) -> void: got.append(id))
	p.set_list([_pose("c1", 10, 20)])
	await _until(got, 1, 10)
	check(got.is_empty(), "no world yet: queued, not rendered")
	var w := _world()
	p.set_world(w.field, w.streamer)
	await _until(got, 1)
	check(got == ["c1"], "the world comes: the queued photo renders")
	# A torn-down world forgets what it rendered: the next one's list starts fresh.
	p.set_world(null, null)
	p.set_world(w.field, w.streamer)
	p.set_list([_pose("c1", 10, 20)])
	await _until(got, 2)
	check(got.size() == 2, "a new world renders the same pose again")
	p.queue_free()
	w.streamer.queue_free()
	await t.process_frame


## A new pose for an id still waiting in the queue takes its place: the old
## pose never renders, and the queue keeps its order.
func test_queued_pose_replaced() -> void:
	var p := FakePhotos.new()
	t.root.add_child(p)
	var got: Array = []
	p.photo_ready.connect(func(id: String, x: float, _z: float, _data: String) -> void: got.append([id, x]))
	# No world yet, so all of it waits in the queue.
	p.set_list([_pose("c1", 10, 20), _pose("c2", -30, 40)])
	p.set_list([_pose("c1", 15, 20), _pose("c2", -30, 40)])
	check(p.pending() == 2, "a queued pose is replaced, not added (%d queued)" % p.pending())
	var w := _world()
	p.set_world(w.field, w.streamer)
	await _until(got, 2)
	await _until(got, 3, 20)
	check(got == [["c2", -30.0], ["c1", 15.0]], "only the new pose renders, after the rest (%s)" % [got])
	p.queue_free()
	w.streamer.queue_free()
	await t.process_frame


func test_hold() -> void:
	var w := _world()
	var s: ChunkStreamer = w.streamer
	var at := Vector3(0, 0, 0)
	s.ensure_around(at)
	var far := Vector3(-900, 0, -900)
	s.hold(at)
	s.update(far)
	check(s.has_chunk(0, 0), "held: a chunk by the held point stays when the focus is far away")
	s.release()
	s.update(far)
	check(not s.has_chunk(0, 0), "released: the next update lets it go")
	s.queue_free()


func test_blank_capture() -> void:
	var w := _world()
	var p := BlankPhotos.new()
	t.root.add_child(p)
	p.set_world(w.field, w.streamer)
	var got: Array = []
	p.photo_ready.connect(func(id: String, _x: float, _z: float, _data: String) -> void: got.append(id))
	p.set_list([_pose("c1", 10, 20)])
	for i in 60:
		await t.process_frame
	check(got.is_empty() and p.tries == Photos.MAX_TRIES and not p.busy() and p.pending() == 0, "an empty capture: tried %d times, then dropped, nothing sent" % p.tries)
	check(not w.streamer.is_held(), "an empty capture lets the streamer go")
	p.set_list([_pose("c1", 10, 20)])
	await _until([], 1, 30)
	check(p.tries == Photos.MAX_TRIES * 2, "a later list tries it again")
	p.queue_free()
	w.streamer.queue_free()
	await t.process_frame


## The bridge seams, and main passing the list on and the photo out.
func test_main_wiring() -> void:
	var main: Node3D = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	var bridge: WebBridge = main.bridge
	var lists: Array = []
	bridge.photos_set.connect(func(list: Array) -> void: lists.append(list))
	bridge.receive_photos_json(JSON.stringify({"list": [_pose("c1", 10, 20)]}))
	bridge.receive_photos_json(JSON.stringify({"list": "nope"}))
	bridge.receive_photos_json("[1]")
	check(lists.size() == 1 and lists[0][0].id == "c1", "photos({list}) reaches photos_set; a bad shape is dropped")
	var sent: Array = []
	bridge.photo_sent.connect(func(d: Dictionary) -> void: sent.append(d))
	var photos: Photos = main.photos
	check(photos != null and photos.pending() + (1 if photos.busy() else 0) == 1, "main hands the list to Photos")
	photos.photo_ready.emit("c9", 1.5, -2.0, "abc")
	check(sent == [{"id": "c9", "x": 1.5, "z": -2.0, "data": "abc"}], "a photo goes out as emitPhoto({id, x, z, data})")
	# The real capture, headless: an empty frame, tried and dropped, quietly.
	for i in 40:
		await t.process_frame
	check(not photos.busy() and photos.pending() == 0 and not main.streamer.is_held(), "the real capture fails soft headless")
	main.queue_free()
	await t.process_frame
