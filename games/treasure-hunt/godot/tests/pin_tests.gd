extends RefCounted
## M3's pins: the beacons Pins builds from a list, the ray P casts, and
## main's P handling over the bridge seams. Over main.tscn on layout_1.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
var main: Node3D
var bridge: WebBridge
var field: TerrainField


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("pins")
	main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	bridge = main.bridge
	field = main.field
	if field == null:
		check(false, "main builds layout_1")
		main.queue_free()
		return
	await t.physics_frame
	test_list()
	test_ray_hit()
	test_ray_sky()
	test_key_rules()
	test_teardown()
	main.queue_free()
	await t.process_frame


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _list(entries: Array) -> void:
	bridge.receive_pins_json(JSON.stringify({"list": entries}))


func _pin(id: String, x: float, z: float, mine := false, color := "#e69f00") -> Dictionary:
	return {"id": id, "x": x, "z": z, "color": color, "mine": mine}


func test_list() -> void:
	var pins: Pins = main.pins
	_list([_pin("a", 10, 20, true), _pin("b", -5, 7)])
	check(pins.count() == 2, "pins list builds beacons (%d)" % pins.count())
	var b := pins.beacon("a")
	var cyl := b.mesh as CylinderMesh if b else null
	check(cyl != null and is_equal_approx(cyl.top_radius, 0.3) and is_equal_approx(cyl.bottom_radius, 0.3) and is_equal_approx(cyl.height, 40.0), "a beacon: radius 0.3, height 40")
	var mat := b.material_override as StandardMaterial3D if b else null
	check(mat != null and mat.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED and mat.albedo_color.is_equal_approx(Color("#e69f00")), "unshaded, in the team colour")
	var h := field.height_at(10, 20)
	check(b != null and absf(b.global_position.y - (h + 20.0)) < 0.01 and absf(b.global_position.x - 10.0) < 0.01, "its base on the ground: centre at height + 20")
	var ring := pins.ring("a")
	var torus := ring.mesh as TorusMesh if ring else null
	check(torus != null and is_equal_approx(torus.inner_radius, 0.6) and is_equal_approx(torus.outer_radius, 0.9), "my own pin has a ring, 0.6 to 0.9")
	check(pins.ring("b") == null, "a teammate's pin has no ring")
	check(_no_colliders(pins), "no colliders")
	# Same list again: nothing rebuilt. A new list: replaced, keyed by id.
	var first := pins.beacon("b")
	_list([_pin("a", 10, 20, true), _pin("b", -5, 7)])
	check(pins.beacon("b") == first, "the same list rebuilds nothing")
	_list([_pin("b", -5, 7), _pin("c", 30, 30, true, "#56b4e9")])
	check(pins.count() == 2 and not pins.has_pin("a") and pins.has_pin("c") and pins.beacon("b") == first, "a new list replaces by id, keeping what didn't change")
	_list([_pin("b", -5, 8)])
	check(pins.count() == 1 and pins.beacon("b") != first, "a moved pin is rebuilt")
	_list([{"id": "", "x": 1, "z": 1, "color": "#fff", "mine": true}, {"id": "q", "x": "1", "z": 1, "color": "#fff"}, {"id": "r", "x": 1, "z": 1, "color": "nope"}, 5])
	check(pins.count() == 0, "malformed entries are dropped")
	_list([])


func _no_colliders(n: Node) -> bool:
	if n is CollisionObject3D or n is CollisionShape3D:
		return false
	for c in n.get_children():
		if not _no_colliders(c):
			return false
	return true


func test_ray_hit() -> void:
	# Level flight at 30 m over a point, then looking steeply down.
	var at := field.spawn
	var from := Vector3(at.x, field.height_at(at.x, at.z) + 30.0, at.z)
	var hit: Variant = Pins.ray_hit(field, from, Vector3.DOWN)
	check(hit != null and absf(hit.x - at.x) < 0.01 and absf(hit.y - at.z) < 0.01, "ray hits the ground ahead")
	# Forward and down at 45 degrees: the hit is on the ground, about 30 m out.
	var dir := Vector3(0, -1, -1).normalized()
	var h2: Variant = Pins.ray_hit(field, from, dir)
	if h2 == null:
		check(false, "a slanted ray finds the ground")
		return
	var gy: float = field.height_at(h2.x, h2.y)
	var along := (Vector3(h2.x, gy, h2.y) - from)
	check(h2.y < from.z and absf(along.normalized().dot(dir)) > 0.98, "a slanted ray lands on its own line (%s)" % str(h2))
	# The ray is within a metre of the surface at the hit (2 m steps, bisected once).
	var ray_y: float = from.y + dir.y * ((from.z - h2.y) / -dir.z)
	check(absf(ray_y - gy) < 1.5, "the hit is on the surface (ray %.2f, ground %.2f)" % [ray_y, gy])


func test_ray_sky() -> void:
	var at := field.spawn
	var from := Vector3(at.x, field.height_at(at.x, at.z) + 30.0, at.z)
	check(Pins.ray_hit(field, from, Vector3.UP) == null, "ray into the sky misses")
	# And through main: nothing emitted.
	var sent: Array[Dictionary] = []
	var cb := func(d: Dictionary) -> void: sent.append(d)
	bridge.pin_sent.connect(cb)
	var cam: Camera3D = main.rig.camera
	cam.global_position = from
	cam.global_basis = Basis.looking_at(Vector3.UP, Vector3.BACK)
	check(not main.drop_pin() and sent.is_empty(), "ray into the sky emits nothing")
	cam.global_position = from
	cam.global_basis = Basis.looking_at(Vector3.DOWN, Vector3.FORWARD)
	var ok: bool = main.drop_pin()
	check(ok and sent.size() == 1, "looking down emits one pin")
	if sent.size() == 1:
		var d := sent[0]
		check(absf(d.x - snappedf(at.x, 0.1)) < 0.001 and absf(d.z - snappedf(at.z, 0.1)) < 0.001, "rounded to 0.1 (%s)" % str(d))
	bridge.pin_sent.disconnect(cb)


func test_key_rules() -> void:
	var sent: Array[Dictionary] = []
	var cb := func(d: Dictionary) -> void: sent.append(d)
	bridge.pin_sent.connect(cb)
	var cam: Camera3D = main.rig.camera
	var at := field.spawn
	cam.global_position = Vector3(at.x, field.height_at(at.x, at.z) + 30.0, at.z)
	cam.global_basis = Basis.looking_at(Vector3.DOWN, Vector3.FORWARD)
	main.set_phase(&"generating")
	check(not main.drop_pin(), "no pin before the round")
	main.set_phase(&"countdown")
	check(main.drop_pin(), "a pin in the countdown")
	main.set_phase(&"finished")
	check(not main.drop_pin(), "no pin after the round")
	main.set_phase(&"hunting")
	check(sent.size() == 1, "one pin sent in all (%d)" % sent.size())
	check(InputMap.has_action("pin"), "pin is in the input map")
	bridge.pin_sent.disconnect(cb)


func test_teardown() -> void:
	var pins: Pins = main.pins
	_list([_pin("a", 10, 20, true)])
	check(pins.count() == 1, "a pin before the teardown")
	var layout: Dictionary = t.layout(2)
	if layout.is_empty():
		check(false, "layout_2 fixture")
		return
	main.start_world(layout)
	check(pins.count() == 0, "a new seed clears the pins")
	_list([_pin("a", 10, 20, true)])
	check(pins.count() == 1, "and the next list rebuilds them")
	_list([])
