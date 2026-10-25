extends SceneTree
## Generates scenes/tracks/test_loop.tscn. Placeholder geometry, deterministic.
## Run: godot --headless --path . --script res://tools/build_test_loop.gd
##
## Hand-placing 60 trees in a .tscn is nobody's idea of fun, so the scene is
## baked from this script. The output is a plain static scene: markers, meshes
## and collision all live in the file, nothing is generated at runtime.

const OUT := "res://scenes/tracks/test_loop.tscn"
const ROAD_HALF_WIDTH := 5.0
const STEP := 2.0 # metres between road samples
const SEED := 7

# Control points (x, z) of a lumpy closed loop, driven in this order.
const CONTROL := [
	Vector2(-80, 45), Vector2(0, 55), Vector2(70, 45), Vector2(105, 5),
	Vector2(85, -40), Vector2(30, -25), Vector2(5, -65), Vector2(-55, -60),
	Vector2(-105, -10),
]
const CP_FRACTIONS := [0.22, 0.45, 0.68, 0.86]

const LAYER_WORLD := 1
const LAYER_CAR := 2
const LAYER_TRIGGER := 4
const LAYER_SURFACE := 8

var track: Track
var pts: PackedVector3Array # uniform samples along the centreline
var tans: PackedVector3Array
var mats := {}


func _init() -> void:
	_sample_centerline()
	track = Track.new()
	track.name = "TestLoop"
	track.track_id = "test_loop"
	track.display_name = "Test Loop"
	var bb := _road_bounds().grow(25.0)
	track.bounds = bb

	_env()
	_ground(bb)
	_road()
	_world_walls(bb)
	_markers()
	_barriers()
	_landmarks()
	_trees(bb)

	_own(track)
	var ps := PackedScene.new()
	var err := ps.pack(track)
	assert(err == OK)
	err = ResourceSaver.save(ps, OUT)
	print("saved %s (err %d): %d road samples, length %.0f m, bounds %s" % [OUT, err, pts.size(), pts.size() * STEP, bb])
	track.free()
	quit(0 if err == OK else 1)


# --- centreline ---------------------------------------------------------------

func _catmull(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: float) -> Vector2:
	var t2 := t * t
	var t3 := t2 * t
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)


func _sample_centerline() -> void:
	var dense: Array[Vector2] = []
	var n := CONTROL.size()
	for i in n:
		for k in 60:
			dense.append(_catmull(CONTROL[(i - 1 + n) % n], CONTROL[i], CONTROL[(i + 1) % n], CONTROL[(i + 2) % n], k / 60.0))
	# Resample at uniform arc length so road samples double as distance markers.
	var total := 0.0
	for i in dense.size():
		total += dense[i].distance_to(dense[(i + 1) % dense.size()])
	var count := int(round(total / STEP))
	var step := total / count
	var acc := 0.0
	var target := 0.0
	for i in dense.size():
		var a := dense[i]
		var b := dense[(i + 1) % dense.size()]
		var seg := a.distance_to(b)
		while target <= acc + seg and pts.size() < count:
			var p := a.lerp(b, (target - acc) / seg)
			pts.append(Vector3(p.x, 0.0, p.y))
			target += step
		acc += seg
	for i in pts.size():
		tans.append((pts[(i + 1) % pts.size()] - pts[(i - 1 + pts.size()) % pts.size()]).normalized())


func _right(i: int) -> Vector3:
	var t := tans[i]
	return Vector3(-t.z, 0, t.x)


func _road_bounds() -> Rect2:
	var r := Rect2(Vector2(pts[0].x, pts[0].z), Vector2.ZERO)
	for p in pts:
		r = r.expand(Vector2(p.x, p.z))
	return r


func _dist_to_road(p: Vector3) -> float:
	var best := INF
	for q in pts:
		best = minf(best, Vector2(p.x - q.x, p.z - q.z).length())
	return best


func _xf_at(i: int, lift := 0.0) -> Transform3D:
	return Transform3D(Basis.looking_at(tans[i], Vector3.UP), pts[i] + Vector3(0, lift, 0))


# --- pieces --------------------------------------------------------------------

func _mat(key: String, c: Color) -> StandardMaterial3D:
	if not mats.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.roughness = 1.0
		mats[key] = m
	return mats[key]


func _env() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-55, -35, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = false # conservative for phones; revisit after M0 numbers
	track.add_child(sun)
	var we := WorldEnvironment.new()
	we.name = "Environment"
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.55, 0.7, 0.62)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.75, 0.78, 0.8)
	env.ambient_light_energy = 0.6
	we.environment = env
	track.add_child(we)


func _ground(bb: Rect2) -> void:
	var body := StaticBody3D.new()
	body.name = "Ground"
	body.collision_layer = LAYER_WORLD
	body.set_meta("surface", "offroad")
	var size := maxf(bb.size.x, bb.size.y) + 120.0
	var c := bb.get_center()
	body.position = Vector3(c.x, 0, c.y)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	var pm := PlaneMesh.new()
	pm.size = Vector2(size, size)
	pm.material = _mat("grass", Color(0.36, 0.52, 0.27))
	mi.mesh = pm
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var bs := BoxShape3D.new()
	bs.size = Vector3(size, 2, size)
	cs.shape = bs
	cs.position = Vector3(0, -1, 0)
	body.add_child(cs)
	track.add_child(body)


## Road = visual strip + a probe-only trimesh on the surfaces layer. The car
## drives on the flat ground; its downward ray reads the surface type from
## whatever it hits on layer 4, so there's no lip at the road edge to snag on.
func _road() -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_normal(Vector3.UP)
	var n := pts.size()
	var lift := Vector3(0, 0.03, 0)
	for i in n:
		var i2 := (i + 1) % n
		var a := pts[i] - _right(i) * ROAD_HALF_WIDTH + lift
		var b := pts[i] + _right(i) * ROAD_HALF_WIDTH + lift
		var c := pts[i2] - _right(i2) * ROAD_HALF_WIDTH + lift
		var d := pts[i2] + _right(i2) * ROAD_HALF_WIDTH + lift
		for v in [a, c, b, b, c, d]:
			st.add_vertex(v)
	var mesh := st.commit()
	mesh.surface_set_material(0, _mat("road", Color(0.32, 0.3, 0.29)))

	var body := StaticBody3D.new()
	body.name = "Road"
	body.add_to_group("track_road", true)
	body.set_meta("surface", "road")
	body.collision_layer = LAYER_SURFACE
	body.collision_mask = 0
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.mesh = mesh
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var shape := mesh.create_trimesh_shape()
	shape.backface_collision = true
	cs.shape = shape
	body.add_child(cs)
	track.add_child(body)


## Invisible fence at the edge of the world so nobody drives into the void.
func _world_walls(bb: Rect2) -> void:
	var walls := Node3D.new()
	walls.name = "WorldBounds"
	track.add_child(walls)
	var c := bb.get_center()
	var e := bb.size * 0.5 + Vector2(20, 20)
	var defs := [
		[Vector3(c.x, 2, c.y - e.y), Vector3(e.x * 2, 4, 1)],
		[Vector3(c.x, 2, c.y + e.y), Vector3(e.x * 2, 4, 1)],
		[Vector3(c.x - e.x, 2, c.y), Vector3(1, 4, e.y * 2)],
		[Vector3(c.x + e.x, 2, c.y), Vector3(1, 4, e.y * 2)],
	]
	for k in defs.size():
		var body := StaticBody3D.new()
		body.name = "Wall%d" % k
		body.collision_layer = LAYER_WORLD
		body.position = defs[k][0]
		var cs := CollisionShape3D.new()
		cs.name = "Shape"
		var bs := BoxShape3D.new()
		bs.size = defs[k][1]
		cs.shape = bs
		body.add_child(cs)
		walls.add_child(body)


func _gate(name: String, i: int) -> Area3D:
	var area := Area3D.new()
	area.name = name
	area.transform = _xf_at(i, 1.5)
	area.collision_layer = LAYER_TRIGGER
	area.collision_mask = LAYER_CAR
	area.monitorable = false
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var bs := BoxShape3D.new()
	bs.size = Vector3(ROAD_HALF_WIDTH * 2 + 8, 3, 2)
	cs.shape = bs
	area.add_child(cs)
	return area


func _markers() -> void:
	var n := pts.size()
	var markers := Node3D.new()
	markers.name = "Markers"
	track.add_child(markers)

	var fin := _gate("Finish", 0)
	fin.add_to_group("track_finish", true)
	markers.add_child(fin)
	# Chequered stripe so the line reads on both the 3D view and the map.
	var stripe := MeshInstance3D.new()
	stripe.name = "Stripe"
	var sm := BoxMesh.new()
	sm.size = Vector3(ROAD_HALF_WIDTH * 2, 0.05, 1.2)
	sm.material = _mat("finish", Color(0.95, 0.95, 0.95))
	stripe.mesh = sm
	stripe.position = Vector3(0, -1.47, 0)
	fin.add_child(stripe)

	var spawn_i := int(8.0 / STEP)
	var spawn := Marker3D.new()
	spawn.name = "Spawn"
	spawn.transform = _xf_at(spawn_i, 0.6)
	spawn.add_to_group("track_spawn", true)
	markers.add_child(spawn)

	var start_anchor := Marker3D.new()
	start_anchor.name = "Recovery0"
	start_anchor.transform = _xf_at(spawn_i, 0.6)
	start_anchor.add_to_group("track_recovery", true)
	start_anchor.set_meta("after_checkpoint", 0)
	markers.add_child(start_anchor)

	for k in CP_FRACTIONS.size():
		var i := int(CP_FRACTIONS[k] * n)
		var cp := _gate("CP%d" % (k + 1), i)
		cp.add_to_group("track_checkpoint", true)
		cp.set_meta("index", k + 1)
		cp.set_meta("distance_m", i * STEP)
		markers.add_child(cp)
		var rec := Marker3D.new()
		rec.name = "Recovery%d" % (k + 1)
		rec.transform = _xf_at((i + 3) % n, 0.6)
		rec.add_to_group("track_recovery", true)
		rec.set_meta("after_checkpoint", k + 1)
		markers.add_child(rec)


func _box_body(name: String, size: Vector3, mat: Material, kind: String) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = name
	body.collision_layer = LAYER_WORLD
	body.add_to_group("track_obstacle", true)
	body.set_meta("kind", kind)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	var bm := BoxMesh.new()
	bm.size = size
	bm.material = mat
	mi.mesh = bm
	mi.position.y = size.y * 0.5
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	cs.name = "Shape"
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	cs.position.y = size.y * 0.5
	body.add_child(cs)
	return body


## Barriers on the outside of every corner tight enough to matter.
func _barriers() -> void:
	var group := Node3D.new()
	group.name = "Barriers"
	track.add_child(group)
	var n := pts.size()
	var shared_mesh := BoxMesh.new()
	shared_mesh.size = Vector3(0.6, 1.0, STEP * 2 - 0.2)
	shared_mesh.material = _mat("barrier", Color(0.85, 0.2, 0.15))
	var shared_shape := BoxShape3D.new()
	shared_shape.size = shared_mesh.size
	var count := 0
	for i in range(0, n, 2):
		var turn := tans[(i - 4 + n) % n].cross(tans[(i + 4) % n]).y
		if absf(turn) < 0.35:
			continue
		var outside := _right(i) * (1.0 if turn > 0 else -1.0)
		var body := StaticBody3D.new()
		body.name = "Barrier%d" % count
		body.collision_layer = LAYER_WORLD
		body.add_to_group("track_obstacle", true)
		body.set_meta("kind", "barrier")
		body.transform = Transform3D(Basis.looking_at(tans[i], Vector3.UP), pts[i] + outside * (ROAD_HALF_WIDTH + 1.0))
		var mi := MeshInstance3D.new()
		mi.name = "Mesh"
		mi.mesh = shared_mesh
		mi.position.y = 0.5
		body.add_child(mi)
		var cs := CollisionShape3D.new()
		cs.name = "Shape"
		cs.shape = shared_shape
		cs.position.y = 0.5
		body.add_child(cs)
		group.add_child(body)
		count += 1
	print("barriers: %d" % count)


func _landmark_at(sample: int, side: float, offset: float) -> Vector3:
	return pts[sample] + _right(sample) * side * offset


func _landmarks() -> void:
	var n := pts.size()
	var group := Node3D.new()
	group.name = "Landmarks"
	track.add_child(group)

	# 1. Radio tower: tall, red, thin. Reads as a dot on the map, a needle in 3D.
	var tower := _box_body("RadioTower", Vector3(2, 26, 2), _mat("tower", Color(0.8, 0.15, 0.1)), "landmark")
	tower.position = _landmark_at(int(0.32 * n), 1.0, ROAD_HALF_WIDTH + 14)
	tower.add_to_group("track_landmark", true)
	tower.set_meta("label", "radio tower")
	var beacon := MeshInstance3D.new()
	beacon.name = "Beacon"
	var sp := SphereMesh.new()
	sp.radius = 1.6
	sp.height = 3.2
	sp.material = _mat("beacon", Color(1, 0.85, 0.2))
	beacon.mesh = sp
	beacon.position.y = 27
	tower.add_child(beacon)
	# Painted pad so the tower is more than a pixel on the map.
	var pad := MeshInstance3D.new()
	pad.name = "Pad"
	var pm := BoxMesh.new()
	pm.size = Vector3(10, 0.1, 10)
	pm.material = _mat("tower", Color.BLACK)
	pad.mesh = pm
	pad.position.y = 0.05
	tower.add_child(pad)
	group.add_child(tower)

	# 2. Blue barn: big, squat, blue roof. Unmissable from above.
	var barn := _box_body("BlueBarn", Vector3(16, 7, 11), _mat("barn_wall", Color(0.85, 0.82, 0.75)), "landmark")
	barn.position = _landmark_at(int(0.75 * n), -1.0, ROAD_HALF_WIDTH + 16)
	barn.rotation.y = 0.4
	barn.add_to_group("track_landmark", true)
	barn.set_meta("label", "blue barn")
	var roof := MeshInstance3D.new()
	roof.name = "Roof"
	var pr := PrismMesh.new()
	pr.size = Vector3(16.5, 4, 11.5)
	pr.material = _mat("barn", Color(0.2, 0.35, 0.85))
	roof.mesh = pr
	roof.position.y = 9
	barn.add_child(roof)
	group.add_child(barn)

	for lm in [tower, barn]:
		print("landmark %s at %s, %.1f m from road" % [lm.name, lm.position, _dist_to_road(lm.position)])


func _trees(bb: Rect2) -> void:
	var group := Node3D.new()
	group.name = "Trees"
	track.add_child(group)
	var rng := RandomNumberGenerator.new()
	rng.seed = SEED
	var trunk := CylinderMesh.new()
	trunk.top_radius = 0.3
	trunk.bottom_radius = 0.4
	trunk.height = 2.0
	trunk.radial_segments = 6
	trunk.rings = 0
	trunk.material = _mat("trunk", Color(0.4, 0.27, 0.15))
	var crown := CylinderMesh.new()
	crown.top_radius = 0.0
	crown.bottom_radius = 2.2
	crown.height = 5.0
	crown.radial_segments = 7
	crown.rings = 0
	crown.material = _mat("pine", Color(0.13, 0.33, 0.17))
	var shape := CylinderShape3D.new()
	shape.radius = 0.5
	shape.height = 4.0
	var placed: Array[Vector3] = []
	var landmarks := [track.get_node("Landmarks/RadioTower").position, track.get_node("Landmarks/BlueBarn").position]
	var tries := 0
	while placed.size() < 70 and tries < 5000:
		tries += 1
		var p := Vector3(rng.randf_range(bb.position.x, bb.end.x), 0, rng.randf_range(bb.position.y, bb.end.y))
		var d := _dist_to_road(p)
		# Mostly hug the road (that's where they're useful callouts), some scatter.
		if d < ROAD_HALF_WIDTH + 3.0 or d > ROAD_HALF_WIDTH + (14.0 if placed.size() < 50 else 35.0):
			continue
		if landmarks.any(func(l: Vector3) -> bool: return l.distance_to(p) < 14.0):
			continue
		if placed.any(func(q: Vector3) -> bool: return q.distance_to(p) < 4.0):
			continue
		placed.append(p)
		var s := rng.randf_range(0.8, 1.3)
		var body := StaticBody3D.new()
		body.name = "Tree%d" % placed.size()
		body.collision_layer = LAYER_WORLD
		body.add_to_group("track_obstacle", true)
		body.set_meta("kind", "tree")
		body.position = p
		var t := MeshInstance3D.new()
		t.name = "Trunk"
		t.mesh = trunk
		t.position.y = 1.0
		body.add_child(t)
		var c := MeshInstance3D.new()
		c.name = "Crown"
		c.mesh = crown
		c.position.y = 2.0 + 2.5 * s
		c.scale = Vector3(s, s, s)
		body.add_child(c)
		var cs := CollisionShape3D.new()
		cs.name = "Shape"
		cs.shape = shape
		cs.position.y = 2.0
		body.add_child(cs)
		group.add_child(body)
	print("trees: %d" % placed.size())


func _own(n: Node) -> void:
	for c in n.get_children():
		c.owner = track
		_own(c)
