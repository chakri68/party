extends RefCounted
## The set pieces (spec §5, templates.ts). Every template, built from the
## params in pieces.json at the origin on a flat floor, leaves each of its
## cache slots open: room for the walker's capsule, standing on a surface at
## the slot's dy. Then Pieces.build_all over layout_1, and main building it.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
## The walker's capsule (Walker.RADIUS, Walker.HEIGHT).
const RADIUS := 0.35
const HEIGHT := 1.8
## The capsule stands this far up, so resting on the surface isn't an overlap.
const LIFT := 0.05
## How far the surface under a slot may be from its dy.
const DY_TOL := 0.3
const MAX_NODES := 60
const MAX_ACROSS := 60.0
## The M4b built templates. Their slots also keep clear of every mesh's AABB.
const BUILT := ["windmill", "farm", "watchtower", "lookout", "garden"]

var _vp: SubViewport
var _space: PhysicsDirectSpaceState3D


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("set pieces")
	var fx := _fixture()
	check(not fx.is_empty(), "pieces.json parses")
	if fx.is_empty():
		return
	# Its own world, so nothing left over from other suites is at the origin.
	_vp = SubViewport.new()
	_vp.world_3d = World3D.new()
	t.root.add_child(_vp)
	_vp.add_child(_floor())
	await t.physics_frame
	_space = _vp.find_world_3d().direct_space_state
	var ground := _space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(100, 2, 100), Vector3(100, -1, 100), 1))
	check(ground and absf(ground.position.y) < 0.01, "the queries see the test floor")

	test_labels(fx)
	for tid: String in fx.templates:
		var samples: Array = fx.templates[tid].samples
		for i in samples.size():
			await test_sample(tid, i, samples[i])
	await test_build_all()
	test_kits()
	_vp.queue_free()
	await t.process_frame
	await test_main_builds_pieces()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _fixture() -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/pieces.json"))
	return parsed if parsed is Dictionary else {}


func _floor() -> StaticBody3D:
	var b := StaticBody3D.new()
	b.collision_layer = 1
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(400, 1, 400)
	cs.shape = box
	cs.position.y = -0.5
	b.add_child(cs)
	return b


func test_labels(fx: Dictionary) -> void:
	for tid: String in fx.templates:
		var want: Array = fx.templates[tid].labels
		var got: Array = PieceKit.LABELS.get(tid, [])
		check(got == want, "%s labels match templates.ts %s" % [tid, want])
		for w: String in want:
			check(PieceKit.COLOURS.has(w), "%s has a colour for '%s'" % [tid, w])


func test_sample(tid: String, i: int, s: Dictionary) -> void:
	var what := "%s #%d %s" % [tid, i, JSON.stringify(s.params)]
	var t0 := Time.get_ticks_usec()
	var piece := PieceKit.build({"id": "test", "template": tid, "x": 0.0, "z": 0.0, "yaw": 0.0,
		"padY": 0.0, "padR": 0.0, "variant": float(s.variant), "params": s.params})
	var us := Time.get_ticks_usec() - t0
	check(piece != null, what + ": builds")
	if piece == null:
		return
	_vp.add_child(piece)
	await t.physics_frame
	await t.physics_frame
	var nodes := _count(piece)
	print("       %s: %d nodes, built in %.2f ms" % [what, nodes, us / 1000.0])
	check(nodes <= MAX_NODES, "%s: %d nodes (at most %d)" % [what, nodes, MAX_NODES])
	var shapes := _shapes(piece)
	check(shapes > 0, "%s: has a collider on layer 1 (%d)" % [what, shapes])
	check(_bodies_on_layer_1(piece), what + ": every body is on layer 1 only")
	var box := _aabb(piece)
	var across := maxf(box.size.x, box.size.z)
	check(across < MAX_ACROSS, "%s: %.1f m across (under %d)" % [what, across, MAX_ACROSS])
	check(_queries_see(piece), what + ": the queries see its colliders")
	for slot: Dictionary in s.slots:
		_check_slot(what, slot)
	if s.has("top"):
		# `top` is the height over the origin, the one a shadow tip is cast
		# from. The windmill's sails sit off it, at z −2.8, and reach higher.
		var hi := _aabb_geometry(piece, ["Sails"]).end.y
		check(absf(hi - float(s.top)) <= 0.15, "%s: top %.2f m within 0.15 of %.2f" % [what, hi, float(s.top)])
	for k in (s.lamps if s.has("lamps") else []).size():
		_check_lamp(what, piece, k, s.lamps[k])
	if s.has("lamps"):
		_check_lamp_switch(what, piece)
	if tid == "shipwreck":
		_check_bow(what, piece, s.params)
	if tid == "plane":
		var top := _space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(2.0, 3, 5.3), Vector3(2.0, 0.5, 5.3), 1))
		check(top and absf(top.position.y - 1.5) < 0.05, what + ": the tail stabiliser is solid")
	if BUILT.has(tid):
		_check_mesh_clear(what, piece, s.slots)
	if tid == "windmill":
		await _check_sails(what, piece, s)
	if tid == "farm":
		_check_doorway(what)
	if tid == "plane":
		check(_debris_clear(piece, s.slots) >= 1.0, "%s: loose debris is 1 m clear of every slot (%.2f m)" % [what, _debris_clear(piece, s.slots)])
	_vp.remove_child(piece)
	piece.free()


## Lamp<k> is an OmniLight3D at the lamp, range 9, off until the clock turns it on.
func _check_lamp(what: String, piece: Node, k: int, l: Dictionary) -> void:
	var n := piece.get_node_or_null("Lamp%d" % k) as OmniLight3D
	check(n != null, "%s: has an OmniLight3D Lamp%d" % [what, k])
	if n == null:
		return
	var want := Vector3(l.x, l.y, l.z)
	check(n.global_position.distance_to(want) <= 0.05, "%s: Lamp%d at %s (got %s)" % [what, k, want, n.global_position])
	check(is_equal_approx(n.omni_range, 9.0) and not n.visible, "%s: Lamp%d range 9, hidden" % [what, k])


## The bulbs are lamp_mat: off after a build, emissive and unshaded when on.
func _check_lamp_switch(what: String, piece: Node) -> void:
	PieceKit.set_lamps_on(false)
	for c in [Color("#ffe8a0"), Color("#ff4030"), Color("#ffc870")]:
		var m := PieceKit.lamp_mat(c)
		check(not m.emission_enabled and m.shading_mode == BaseMaterial3D.SHADING_MODE_PER_PIXEL, "%s: lamp %s starts off" % [what, c.to_html()])
		PieceKit.set_lamps_on(true)
		check(m.emission_enabled and m.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED, "%s: set_lamps_on(true) lights %s" % [what, c.to_html()])
		PieceKit.set_lamps_on(false)
		check(not m.emission_enabled and m.shading_mode == BaseMaterial3D.SHADING_MODE_PER_PIXEL, "%s: set_lamps_on(false) dims %s" % [what, c.to_html()])
	# A piece built while lamps are on starts lit, lights and all.
	PieceKit.set_lamps_on(true)
	var lit := PieceKit.build({"id": "lit", "template": "camp", "params": {"tents": 1, "firepit": 0}})
	var l := lit.get_node_or_null("Lamp0") as OmniLight3D
	check(l != null and l.visible, what + ": a piece built with lamps on has its light on")
	lit.free()
	PieceKit.set_lamps_on(false)
	var dark := PieceKit.build({"id": "dark", "template": "camp", "params": {"tents": 1, "firepit": 0}})
	check(not (dark.get_node("Lamp0") as OmniLight3D).visible, what + ": and with lamps off, its light is off")
	dark.free()


func _check_slot(what: String, slot: Dictionary) -> void:
	var at := Vector3(slot.x, slot.dy, slot.z)
	var tag := "%s: slot (%.2f, %.2f, dy %.1f)" % [what, at.x, at.z, at.y]
	var pq := PhysicsPointQueryParameters3D.new()
	pq.position = at + Vector3(0, 0.5, 0)
	pq.collision_mask = 1
	var inside := _space.intersect_point(pq)
	check(inside.is_empty(), tag + " has no collider 0.5 m up" + _names(inside))

	var cap := CapsuleShape3D.new()
	cap.radius = RADIUS
	cap.height = HEIGHT
	var sq := PhysicsShapeQueryParameters3D.new()
	sq.shape = cap
	sq.transform = Transform3D(Basis.IDENTITY, at + Vector3(0, LIFT + HEIGHT * 0.5, 0))
	sq.collision_mask = 1
	var hits := _space.intersect_shape(sq)
	check(hits.is_empty(), tag + " has room for the walker" + _names(hits))

	var rq := PhysicsRayQueryParameters3D.create(at + Vector3(0, 2, 0), at + Vector3(0, -1, 0), 1)
	var hit := _space.intersect_ray(rq)
	var y: float = hit.position.y if hit else NAN
	check(hit and absf(y - at.y) <= DY_TOL, "%s stands on something at dy (hit y %.2f)" % [tag, y])


## A point at the middle of each of its collision shapes finds that body,
## so an empty query near a slot means open, not unseen.
func _queries_see(piece: Node) -> bool:
	for cs: CollisionShape3D in piece.find_children("*", "CollisionShape3D", true, false):
		var pq := PhysicsPointQueryParameters3D.new()
		pq.position = cs.global_position
		pq.collision_mask = 1
		var found := false
		for h: Dictionary in _space.intersect_point(pq):
			found = found or h.collider == cs.get_parent()
		if not found:
			return false
	return true


## The bow is a wedge: solid on its centreline near the tip, open beside it
## where a full box would leave an invisible wall.
func _check_bow(what: String, piece: Node3D, p: Dictionary) -> void:
	var hull := piece.get_node_or_null("Hull") as Node3D
	check(hull != null, what + ": has a Hull node")
	if hull == null:
		return
	var L := float(p.length)
	var B := L * 0.3
	var H := L * 0.25
	# In the hull's own frame, so the probes follow its tilt and burying.
	var at := func(x: float, z: float) -> bool:
		var q := PhysicsPointQueryParameters3D.new()
		q.position = hull.global_transform * Vector3(x, H * 0.5, z)
		q.collision_mask = 1
		return not _space.intersect_point(q).is_empty()
	check(at.call(0.0, -L * 0.5 + 0.3), what + ": the bow is solid near its tip")
	check(not at.call(B * 0.5 - 0.2, -L * 0.5 + 0.3), what + ": beside the bow's tip is open")


## Waist height over each slot is outside every mesh's box. A merged mesh
## that rings a slot (posts, walls, hedges) would hide a cache in plain
## view of the queries, so each such part is its own mesh.
func _check_mesh_clear(what: String, piece: Node, slots: Array) -> void:
	for sl: Dictionary in slots:
		var at := Vector3(sl.x, float(sl.dy) + 0.9, sl.z)
		var inside: Array[String] = []
		for g: GeometryInstance3D in _geometry(piece):
			if (g.global_transform * g.get_aabb()).has_point(at):
				inside.append(String(g.name))
		check(inside.is_empty(), "%s: slot (%.2f, %.2f) waist is outside every mesh's box %s" % [what, at.x, at.z, inside])


## Turning sails spin; still ones don't. Either way the slots stay open.
func _check_sails(what: String, piece: Node3D, s: Dictionary) -> void:
	var sails := piece.get_node_or_null("Sails") as Node3D
	check(sails != null, what + ": has a Sails node")
	if sails == null:
		return
	check(sails.find_children("*", "CollisionShape3D", true, false).is_empty(), what + ": the sails have no collider")
	var before := sails.rotation.z
	for k in 60:
		await t.process_frame
	var turned := absf(angle_difference(before, sails.rotation.z))
	if int(s.params.turning) == 1:
		check(turned > 0.1, "%s: the sails turned %.2f rad in 60 frames" % [what, turned])
	else:
		check(turned == 0.0, "%s: still sails stay still (%.2f)" % [what, turned])
	await t.physics_frame
	for slot: Dictionary in s.slots:
		_check_slot(what + " after 60 frames", slot)
	var low := INF
	for g: GeometryInstance3D in _geometry(sails):
		low = minf(low, (g.global_transform * g.get_aabb()).position.y)
	check(low >= 3.0, "%s: the sails stay %.2f m up (at least 3)" % [what, low])


## The barn's doorway, in the middle of its +Z wall (z −3.2..−3): room for
## the walker standing in the gap, so the slot inside can be reached.
func _check_doorway(what: String) -> void:
	for z in [-3.1, -2.5, -3.7]:
		var cap := CapsuleShape3D.new()
		cap.radius = RADIUS
		cap.height = HEIGHT
		var sq := PhysicsShapeQueryParameters3D.new()
		sq.shape = cap
		sq.transform = Transform3D(Basis.IDENTITY, Vector3(0, LIFT + HEIGHT * 0.5, z))
		sq.collision_mask = 1
		var hits := _space.intersect_shape(sq)
		check(hits.is_empty(), "%s: the walker fits the barn doorway at z %.1f%s" % [what, z, _names(hits)])
	# 1.4 m wide: walls on both sides, just outside it.
	for x in [-0.8, 0.8]:
		var pq := PhysicsPointQueryParameters3D.new()
		pq.position = Vector3(x, 1.0, -3.1)
		pq.collision_mask = 1
		check(not _space.intersect_point(pq).is_empty(), "%s: the barn wall stands at x %.1f, beside the doorway" % [what, x])


## The plane's small bits have no colliders, so the queries can't see them:
## the nearest any of their corners comes to a slot, flat.
func _debris_clear(piece: Node, slots: Array) -> float:
	var near := INF
	for name in ["Debris", "Scrap"]:
		var mi := piece.get_node_or_null(name) as MeshInstance3D
		if mi == null:
			continue
		for v: Vector3 in mi.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]:
			for sl: Dictionary in slots:
				near = minf(near, Vector2(v.x - sl.x, v.z - sl.z).length())
	return near


func _names(hits: Array) -> String:
	if hits.is_empty():
		return ""
	var out: PackedStringArray = []
	for h: Dictionary in hits:
		var c: Object = h.collider
		var s: Node = (c as CollisionObject3D).shape_owner_get_owner(h.shape) if c is CollisionObject3D else null
		out.append(s.name if s else str(c))
	return " (hits %s)" % ", ".join(out)


func _count(n: Node) -> int:
	var c := 1
	for k in n.get_children():
		c += _count(k)
	return c


func _shapes(n: Node) -> int:
	var c := 0
	if n is CollisionShape3D and n.get_parent() is StaticBody3D and (n.get_parent() as StaticBody3D).collision_layer & 1:
		c += 1
	for k in n.get_children():
		c += _shapes(k)
	return c


func _bodies_on_layer_1(n: Node) -> bool:
	if n is CollisionObject3D and (n as CollisionObject3D).collision_layer != 1:
		return false
	for k in n.get_children():
		if not _bodies_on_layer_1(k):
			return false
	return true


func _aabb(n: Node) -> AABB:
	var out := AABB()
	var first := true
	for v: VisualInstance3D in n.find_children("*", "VisualInstance3D", true, false):
		var b := v.global_transform * v.get_aabb()
		out = b if first else out.merge(b)
		first = false
	return out


## Meshes only: lights have an AABB of their own range. Nodes under a
## child named in `skip` are left out.
func _aabb_geometry(n: Node, skip: Array = []) -> AABB:
	var out := AABB()
	var first := true
	for v: GeometryInstance3D in _geometry(n):
		var under := false
		for name: String in skip:
			var k := n.get_node_or_null(NodePath(name))
			under = under or (k != null and k.is_ancestor_of(v))
		if under:
			continue
		var b := v.global_transform * v.get_aabb()
		out = b if first else out.merge(b)
		first = false
	return out


func _geometry(n: Node) -> Array[Node]:
	return n.find_children("*", "GeometryInstance3D", true, false)


## Every model the M4b set-piece builders may use, as PieceKit.kenney names it.
const KIT_MODELS := {
	"town": ["windmill", "blade", "wall-wood", "wall-wood-broken", "wall-wood-doorway-square", "roof-gable", "fence", "fence-broken", "cart", "fountain-round", "hedge", "lantern", "pillar-wood", "planks", "stairs-wood"],
	"castle": ["tower-square-base", "tower-square-mid", "tower-square-top", "wall-half", "rocks-large", "rocks-small", "siege-trebuchet", "siege-trebuchet-demolished", "siege-catapult", "siege-catapult-demolished", "siege-ballista", "siege-ballista-demolished", "flag-banner-long"],
	"survival": ["box-large", "barrel", "structure-canvas", "structure", "campfire-fishing-stand", "signpost", "tool-pickaxe", "tool-shovel", "resource-stone-large", "bucket"],
	"nature": ["cliff_block_rock", "cliff_blockHalf_rock", "cliff_cave_rock", "rock_smallFlatA", "rock_smallB", "log_stack"],
}


func test_kits() -> void:
	var host := Node3D.new()
	var bad_size: Array[String] = []
	var bad_mat: Array[String] = []
	var n := 0
	for kit: String in KIT_MODELS:
		for model: String in KIT_MODELS[kit]:
			n += 1
			var name := "%s/%s" % [kit, model]
			var mi := PieceKit.kenney(host, name, Vector3.ZERO, Vector3.ONE)
			if mi == null or mi.mesh == null:
				bad_size.append(name)
				continue
			var sz := mi.mesh.get_aabb().size
			if sz.x <= 0.01 or sz.y <= 0.01 or sz.z <= 0.01:
				bad_size.append(name)
			if kit != "nature":
				var textured := false
				for i in mi.mesh.get_surface_count():
					var m := mi.mesh.surface_get_material(i) as BaseMaterial3D
					textured = textured or (m != null and m.albedo_texture != null)
				if not textured or mi.material_override != null:
					bad_mat.append(name)
	check(n == 44, "test_kits covers 44 models (%d)" % n)
	check(bad_size.is_empty(), "every kit model loads with a mesh above 0.01 on each axis %s" % [bad_size])
	check(bad_mat.is_empty(), "castle, town and survival models keep a textured material %s" % [bad_mat])
	check(PieceKit.COLOURS.has("brown"), "COLOURS has brown")
	check(PieceKit.kenney(host, "rock_smallA", Vector3.ZERO, Vector3.ONE) != null, "a bare name is still the nature kit")
	host.free()


func test_build_all() -> void:
	var layout: Dictionary = t.layout(1)
	var want: Array = layout.pieces
	var pieces := Pieces.new()
	_vp.add_child(pieces)
	pieces.build_all(layout)
	check(pieces.get_child_count() == want.size(), "build_all makes one child per piece (%d of %d)" % [pieces.get_child_count(), want.size()])
	pieces.build_all(layout)
	check(pieces.get_child_count() == want.size(), "build_all twice replaces them (%d)" % pieces.get_child_count())
	var placed := true
	var ranged := true
	for p: Dictionary in want:
		var n := pieces.get_node_or_null(NodePath(String(p.id))) as Node3D
		if n == null or not n.position.is_equal_approx(Vector3(p.x, p.padY, p.z)) or not n.basis.is_equal_approx(Basis(Vector3.UP, p.yaw)):
			placed = false
			continue
		for g: GeometryInstance3D in _geometry(n):
			ranged = ranged and g.visibility_range_end == 1100.0
	check(placed, "each piece sits at (x, padY, z), turned by yaw")
	check(ranged, "every mesh in a piece fades out at 1100 m")
	pieces.clear()
	check(pieces.get_child_count() == 0, "clear empties it")
	pieces.queue_free()


func test_main_builds_pieces() -> void:
	var main: Node3D = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	var n: Node = main.world.get_node_or_null("Pieces") if main.world else null
	var want: int = t.layout(1).pieces.size()
	check(n != null and n.get_child_count() == want, "main's world has layout_1's %d pieces" % want)
	main.queue_free()
	await t.process_frame
