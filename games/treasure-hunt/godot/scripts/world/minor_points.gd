class_name MinorPoints
extends Node3D
## The layout's minor points (minor.ts): rock piles, fallen logs and old
## campfires, one child each, named by id. Each is built to the footprint in
## minor.ts's MINOR_SLOT comment, because its one cache slot at local
## (1.2, 0) assumes it:
##   rocks    a pile within 0.8 m of the point, none higher than 1 m
##   log      along Z, z −1.5..1.5, 0.4 m each side of x = 0
##   campfire a stone ring within 0.7 m, small logs inside it
## Local frame as the pieces': −Z front, +X right, turned by yaw.

## Small things: past this they're gone. The pieces carry the distance view.
const RANGE_END := 300.0
## Models start this far under the point, so a slope doesn't show a gap.
const SINK := 0.1

const LOG := Vector3(3.0, 0.6, 0.8) ## log_large runs along its own X
const RING := 0.65 ## stone ring radius
const RING_H := 0.2
## Footprint radius per kind, where ground_y samples.
const FOOTPRINT := {"rocks": 0.8, "campfire": 0.7}

## Read for heights; main sets it. Without one, build_all makes its own.
var field: TerrainField


func build_all(layout: Dictionary) -> void:
	clear()
	var f := field if field != null else TerrainField.from_layout(layout)
	for m: Dictionary in layout.get("minor", []):
		var node := build_one(m, f.height_at)
		if node == null:
			continue
		for g: GeometryInstance3D in node.find_children("*", "GeometryInstance3D", true, false):
			g.visibility_range_end = RANGE_END
		add_child(node)


## Out of the tree now, so a rebuild straight after can reuse the names.
func clear() -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()


## Where a point's root sits: the lowest of 3 samples round its footprint
## (rocks, campfire), or of its middle and both sides (log), so it never
## floats. `ground` is height_at(x, z); an empty Callable means flat at 0.
static func ground_y(m: Dictionary, ground: Callable) -> float:
	if not ground.is_valid():
		return 0.0
	var x := float(m.get("x", 0))
	var z := float(m.get("z", 0))
	var turn := Basis(Vector3.UP, float(m.get("yaw", 0)))
	var spots: Array[Vector3] = []
	var kind := String(m.get("kind", ""))
	if FOOTPRINT.has(kind):
		for k in 3:
			spots.append(Basis(Vector3.UP, TAU * k / 3.0) * Vector3(FOOTPRINT[kind], 0, 0))
	else:
		spots.assign([Vector3.ZERO, Vector3(LOG.z * 0.5, 0, 0), Vector3(-LOG.z * 0.5, 0, 0)])
	var y := INF
	for s in spots:
		var w := turn * s
		y = minf(y, ground.call(x + w.x, z + w.z))
	return y


## One point at (x, ground_y, z), turned by yaw. With ground the log also
## tilts to the slope under its ends.
static func build_one(m: Dictionary, ground: Callable) -> Node3D:
	var root := Node3D.new()
	root.name = String(m.get("id", "minor"))
	root.position = Vector3(float(m.get("x", 0)), ground_y(m, ground), float(m.get("z", 0)))
	root.rotation.y = float(m.get("yaw", 0))
	# Same id, same pile, every client.
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(root.name)
	match String(m.get("kind", "")):
		"rocks":
			_rocks(root, rng)
		"log":
			_log(root, ground)
		"campfire":
			_campfire(root)
		_:
			push_error("MinorPoints: no kind '%s'" % m.get("kind"))
			root.free()
			return null
	return root


## 3–5 rocks: a tall one in the middle, the rest around it. Each rock's
## reach (distance + half its diagonal) stays under 0.8 m.
static func _rocks(root: Node3D, rng: RandomNumberGenerator) -> void:
	var b := PieceKit.body(root)
	var n := 3 + rng.randi() % 3
	_rock(root, b, "rock_tallB", Vector3.ZERO, Vector3(0.75, 0.8, 0.75), rng.randf() * TAU)
	var a0 := rng.randf() * TAU
	for k in n - 1:
		var a := a0 + TAU * k / (n - 1)
		if k % 2 == 0:
			_rock(root, b, "rock_largeA", PieceKit.polar(a, 0.35), Vector3(0.5, 0.25, 0.6), rng.randf() * TAU)
		else:
			_rock(root, b, "rock_smallA", PieceKit.polar(a, 0.5), Vector3(0.35, 0.2, 0.35), rng.randf() * TAU)


static func _rock(root: Node3D, b: StaticBody3D, file: String, at: Vector3, size: Vector3, yaw: float) -> void:
	var base := at - Vector3(0, SINK, 0)
	PieceKit.kenney(root, file, base, size, yaw)
	PieceKit.box_shape(b, size, base + Vector3(0, size.y * 0.5, 0), Basis(Vector3.UP, yaw))


## Lies along Z, pitched to the ground under its two ends.
static func _log(root: Node3D, ground: Callable) -> void:
	var pivot := Node3D.new()
	pivot.name = "Log"
	root.add_child(pivot)
	if ground.is_valid():
		var along := Basis(Vector3.UP, root.rotation.y) * Vector3(0, 0, LOG.x * 0.5)
		var front: float = ground.call(root.position.x - along.x, root.position.z - along.z)
		var back: float = ground.call(root.position.x + along.x, root.position.z + along.z)
		pivot.rotation.x = atan2(front - back, LOG.x)
	var base := Vector3(0, -SINK, 0)
	PieceKit.kenney(pivot, "log_large", base, LOG, PI * 0.5)
	var b := PieceKit.body(pivot)
	PieceKit.box_shape(b, Vector3(LOG.z, LOG.y, LOG.x), base + Vector3(0, LOG.y * 0.5, 0))


static func _campfire(root: Node3D) -> void:
	var base := Vector3(0, -SINK, 0)
	PieceKit.kenney(root, "campfire_stones", base, Vector3(RING * 2, RING_H + SINK, RING * 2))
	PieceKit.kenney(root, "campfire_logs", base + Vector3(0, 0.02, 0), Vector3(0.7, 0.35, 0.7))
	var b := PieceKit.body(root)
	PieceKit.cylinder_shape(b, RING, RING_H + SINK + 0.15, base + Vector3(0, (RING_H + SINK + 0.15) * 0.5, 0))
