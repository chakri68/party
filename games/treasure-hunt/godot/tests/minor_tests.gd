extends RefCounted
## Minor points (minor.ts): rock piles, fallen logs and old campfires. Each
## kind, built at the origin on a flat floor at several turns, leaves its one
## cache slot at local (1.2, 0) open, as the piece slots are. Then
## MinorPoints.build_all over layout_1, and main building it.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
## The walker's capsule (Walker.RADIUS, Walker.HEIGHT).
const RADIUS := 0.35
const HEIGHT := 1.8
const LIFT := 0.05
const DY_TOL := 0.3
## MINOR_SLOT in minor.ts: the same spot for every kind.
const SLOT := Vector3(1.2, 0, 0)
const YAWS := [0.0, 1.0, 2.5, 4.4]

var _vp: SubViewport
var _space: PhysicsDirectSpaceState3D


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("minor points")
	_vp = SubViewport.new()
	_vp.world_3d = World3D.new()
	t.root.add_child(_vp)
	_vp.add_child(_floor())
	await t.physics_frame
	_space = _vp.find_world_3d().direct_space_state
	var ground := _space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(10, 2, 10), Vector3(10, -1, 10), 1))
	check(ground and absf(ground.position.y) < 0.01, "the queries see the test floor")
	for kind: String in ["rocks", "log", "campfire"]:
		for i in 3:
			for yaw: float in YAWS:
				await test_slot(kind, "m%d" % i, yaw)
	test_build_all()
	_vp.queue_free()
	await t.process_frame
	await test_slope()
	await t.process_frame
	await test_main_builds_minor()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _floor() -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = 1
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(100, 1, 100)
	cs.shape = box
	cs.position.y = -0.5
	b.add_child(cs)
	return b


func test_slot(kind: String, id: String, yaw: float) -> void:
	var what := "%s %s yaw %.1f" % [kind, id, yaw]
	var node := MinorPoints.build_one({"id": id, "kind": kind, "x": 0.0, "z": 0.0, "yaw": yaw}, Callable())
	check(node != null, what + ": builds")
	if node == null:
		return
	_vp.add_child(node)
	await t.physics_frame
	await t.physics_frame
	var shapes := node.find_children("*", "CollisionShape3D", true, false)
	check(shapes.size() > 0, "%s: has a collider (%d)" % [what, shapes.size()])
	check(_queries_see(node), what + ": the queries see its colliders")
	var tops := 0.0
	for v: VisualInstance3D in node.find_children("*", "VisualInstance3D", true, false):
		tops = maxf(tops, (v.global_transform * v.get_aabb()).end.y)
	if kind == "rocks":
		var rocks := node.find_children("*", "MeshInstance3D", true, false).size()
		check(rocks >= 3 and rocks <= 5 and tops <= 1.0, "%s: %d rocks, none higher than 1 m (%.2f)" % [what, rocks, tops])

	var at := Basis(Vector3.UP, yaw) * SLOT
	var tag := "%s: slot (%.2f, %.2f)" % [what, at.x, at.z]
	var pq := PhysicsPointQueryParameters3D.new()
	pq.position = at + Vector3(0, 0.5, 0)
	pq.collision_mask = 1
	check(_space.intersect_point(pq).is_empty(), tag + " has no collider 0.5 m up")
	var cap := CapsuleShape3D.new()
	cap.radius = RADIUS
	cap.height = HEIGHT
	var sq := PhysicsShapeQueryParameters3D.new()
	sq.shape = cap
	sq.transform = Transform3D(Basis.IDENTITY, at + Vector3(0, LIFT + HEIGHT * 0.5, 0))
	sq.collision_mask = 1
	check(_space.intersect_shape(sq).is_empty(), tag + " has room for the walker")
	var hit := _space.intersect_ray(PhysicsRayQueryParameters3D.create(at + Vector3(0, 2, 0), at + Vector3(0, -1, 0), 1))
	check(hit and absf(hit.position.y) <= DY_TOL, tag + " stands on the ground")
	# And the thing itself is solid: a capsule on the point hits it.
	sq.transform = Transform3D(Basis.IDENTITY, Vector3(0, LIFT + HEIGHT * 0.5, 0))
	check(not _space.intersect_shape(sq).is_empty(), what + ": the point itself is blocked")
	_vp.remove_child(node)
	node.free()


## A point at the middle of each collision shape finds its body, so an empty
## query near the slot means open, not unseen.
func _queries_see(node: Node) -> bool:
	for cs: CollisionShape3D in node.find_children("*", "CollisionShape3D", true, false):
		var pq := PhysicsPointQueryParameters3D.new()
		pq.position = cs.global_position
		pq.collision_mask = 1
		var found := false
		for h: Dictionary in _space.intersect_point(pq):
			found = found or h.collider == cs.get_parent()
		if not found:
			return false
	return true


func test_build_all() -> void:
	var layout: Dictionary = t.layout(1)
	var field := TerrainField.from_layout(layout)
	var want: Array = layout.minor
	var mp := MinorPoints.new()
	_vp.add_child(mp)
	mp.field = field
	mp.build_all(layout)
	check(want.size() > 0 and mp.get_child_count() == want.size(), "build_all makes one child per minor point (%d of %d)" % [mp.get_child_count(), want.size()])
	mp.build_all(layout)
	check(mp.get_child_count() == want.size(), "build_all twice replaces them (%d)" % mp.get_child_count())
	var placed := true
	var ranged := true
	var bodies := true
	for m: Dictionary in want:
		var n := mp.get_node_or_null(NodePath(String(m.id))) as Node3D
		var h := MinorPoints.ground_y(m, field.height_at)
		if n == null or not n.position.is_equal_approx(Vector3(m.x, h, m.z)) or not n.basis.is_equal_approx(Basis(Vector3.UP, m.yaw)) or h > field.height_at(m.x, m.z) + 1e-6:
			placed = false
			continue
		for g: GeometryInstance3D in n.find_children("*", "GeometryInstance3D", true, false):
			ranged = ranged and g.visibility_range_end == MinorPoints.RANGE_END
		bodies = bodies and n.find_children("*", "CollisionShape3D", true, false).size() > 0
	check(placed, "each minor point sits at (x, ground_y, z), no higher than height_at, turned by yaw")
	check(MinorPoints.RANGE_END == 300.0 and ranged, "every minor mesh fades out at 300 m")
	check(bodies, "every minor point has a collider")
	mp.clear()
	check(mp.get_child_count() == 0, "clear empties it")
	mp.queue_free()


func test_main_builds_minor() -> void:
	var main: Node3D = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	var n: Node = main.world.get_node_or_null("MinorPoints") if main.world else null
	var want: int = t.layout(1).minor.size()
	check(n != null and n.get_child_count() == want, "main's world has layout_1's %d minor points" % want)
	main.queue_free()
	await t.process_frame


## On a 25° slope (the steepest minor.ts allows): the slot beside each kind
## stays open whichever way it faces, and rocks and campfires don't float.
## The slope is on layer 2, so the walker query (mask 1) sees only the point.
func test_slope() -> void:
	var vp := SubViewport.new()
	vp.world_3d = World3D.new()
	t.root.add_child(vp)
	var g := tan(deg_to_rad(25.0))
	var ground := func(x: float, _z: float) -> float: return g * x
	var b := StaticBody3D.new()
	b.collision_layer = 2
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(60, 1, 60)
	cs.shape = box
	# Top face through the origin, rising along +X.
	cs.transform = Transform3D(Basis(Vector3.BACK, deg_to_rad(25.0)), Vector3(0, -0.5, 0).rotated(Vector3.BACK, deg_to_rad(25.0)))
	b.add_child(cs)
	vp.add_child(b)
	await t.physics_frame
	var space := vp.find_world_3d().direct_space_state
	var probe := space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(2, 10, 0), Vector3(2, -10, 0), 2))
	check(probe and absf(probe.position.y - ground.call(2.0, 0.0)) < 0.02, "the queries see the 25° slope")
	for kind: String in ["rocks", "log", "campfire"]:
		for yaw: float in [0.0, PI * 0.5, PI, PI * 1.5]:
			var what := "%s on 25° yaw %.2f" % [kind, yaw]
			var node := MinorPoints.build_one({"id": "m1", "kind": kind, "x": 0.0, "z": 0.0, "yaw": yaw}, ground)
			vp.add_child(node)
			await t.physics_frame
			await t.physics_frame
			var s := Basis(Vector3.UP, yaw) * SLOT
			var at := Vector3(s.x, ground.call(s.x, s.z), s.z)
			var pq := PhysicsPointQueryParameters3D.new()
			pq.position = at + Vector3(0, 0.5, 0)
			pq.collision_mask = 1
			check(space.intersect_point(pq).is_empty(), what + ": no collider 0.5 m over the slot")
			var cap := CapsuleShape3D.new()
			cap.radius = RADIUS
			cap.height = HEIGHT
			var sq := PhysicsShapeQueryParameters3D.new()
			sq.shape = cap
			sq.transform = Transform3D(Basis.IDENTITY, at + Vector3(0, LIFT + HEIGHT * 0.5, 0))
			sq.collision_mask = 1
			check(space.intersect_shape(sq).is_empty(), what + ": the slot has room for the walker")
			sq.transform = Transform3D(Basis.IDENTITY, Vector3(0, node.position.y + LIFT + HEIGHT * 0.5, 0))
			check(not space.intersect_shape(sq).is_empty(), what + ": the point itself is blocked")
			if kind != "log":
				# Its base, all round its footprint, is at most 0.1 m over the ground.
				var base := node.position.y - MinorPoints.SINK
				var worst := -INF
				for a in 16:
					var q := Basis(Vector3.UP, TAU * a / 16.0) * Vector3(MinorPoints.FOOTPRINT[kind], 0, 0)
					worst = maxf(worst, base - ground.call(q.x, q.z))
				check(worst <= 0.1, "%s: doesn't float (base at most %.2f m over the ground)" % [what, worst])
			vp.remove_child(node)
			node.free()
	vp.queue_free()
	await t.process_frame
