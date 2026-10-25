class_name EasterEggs
extends Node3D
## Rare surprises along the stage: deer bounding across the road, birds
## bursting out of the canopy, a moose staring from a glade, campers who wave
## (and duck when the car slides at them), a very rare Bigfoot, and a sign at
## a junction to nowhere pointing the wrong way.
##
## Deterministic like the weather: make_schedule(seed) decides which spots
## are live and every creature's numbers, and windows run on this node's
## clock (physics time, as Weather's). Every team in a Fair Race gets the
## same surprises in the same places at the same moment of their run. What
## the car does still matters: deer cross when it's about 3 s away and bolt
## if it gets within SPOOK_R.
##
## Cheap on purpose: low-poly meshes on the palette material (so cloud shade
## and eye-level mist treat them like everything else), moved by transforms
## and nothing else. No physics, no colliders, no AnimationTree, no bones.
## Nothing here can touch the car. Hidden and idle when the car is far.
##
## Render layer 5 only: the 3D view sees them in every camera, the static
## map camera never does (MapController.CULL_MASK). They also never switch
## on or off within SHOW_R of the car, which is past the eye-level far plane
## and well outside the top-down frame, so nothing pops into view.
##
## The spots are markers the track bakes (group track_egg, meta kind; see
## build_pine_panic.gd EGG_SPOTS). A track without them just has no eggs.

const LAYER := 16 ## render layer 5
const SHOW_R := 125.0 ## metres from the car; visibility only ever changes further out than this
const SPOOK_R := 20.0
const DEER_PACE := Vector2(6.2, 7.6) ## m/s, trotting-bound across
const DEER_BOLT := 12.5 ## m/s once spooked
const DEER_WAIT := 11.0 ## metres off the centreline where they stand before crossing
const DEER_END := 34.0 ## ...and where they stop on the far side, deep in the trees
const DEER_LEAD := 3.0 ## seconds: crossing starts when the car is about this far off
const BIRD_TRIGGER := 26.0
const BIRD_TIME := 5.5
const CAMPER_WAVE_R := 55.0
const CAMPER_DUCK_R := 30.0
const DUCK_SLIP := 0.21 ## radians of slide (12 deg) that sends the campers diving
const BIGFOOT_WALK := 5.0 ## metres, once, when the car comes within 70 m

## Order the dice are thrown in; never reorder (it would change every seed's run).
const KINDS := ["deer", "birds", "moose", "camper", "bigfoot", "wrongway"]
## Chance a spot is live in a run. Rare by design: most runs see two or
## three things, Bigfoot about one run in seventeen.
const CHANCE := {"deer": 0.35, "birds": 0.5, "moose": 0.3, "camper": 0.75, "bigfoot": 0.06, "wrongway": 0.4}

const PALETTE := preload("res://assets/materials/vertex_color.tres")

var seed_value := 0
var time := 0.0 ## seconds of race clock, advanced in physics time
var car: CharacterBody3D
var track: Track
## Tools and tests: {"deer": true, "bigfoot": false, "all": true...} overrides
## the dice for that kind (live or not); windows open for the whole run.
var force := {}
var schedule: Array = []

var _spots := {} # kind -> Array[Node3D], in stage order
var _live: Array = [] # one record per live schedule entry
static var _mesh_cache := {}


func setup(t: Track, c: CharacterBody3D) -> void:
	track = t
	car = c
	_spots.clear()
	var all: Array = []
	for m in t.get_tree().get_nodes_in_group("track_egg"):
		if t.is_ancestor_of(m):
			all.append(m)
	all.sort_custom(func(a: Node, b: Node) -> bool:
		var da := float(a.get_meta("distance_m", 0.0))
		var db := float(b.get_meta("distance_m", 0.0))
		return da < db if da != db else String(a.name) < String(b.name))
	for m in all:
		var kind: String = m.get_meta("kind", "")
		if not _spots.has(kind):
			_spots[kind] = []
		_spots[kind].append(m)


## How many spots of each kind the track has. Campers come as one group.
func spot_counts() -> Dictionary:
	var out := {}
	for kind in KINDS:
		var n: int = _spots.get(kind, []).size()
		out[kind] = mini(n, 1) if kind == "camper" else n
	return out


## The whole run's surprises from the seed alone: pure, so a test (or the
## server) can ask what a seed holds. Every spot draws the same count of
## numbers whether it's live or not, so one kind's luck never shifts another's.
static func make_schedule(seed_in: int, counts: Dictionary) -> Array:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("blind-rally-eggs:%d" % seed_in)
	var out: Array = []
	for kind in KINDS:
		for k in int(counts.get(kind, 0)):
			var roll := rng.randf()
			var a := rng.randf()
			var b := rng.randf()
			var c := rng.randf()
			var d := rng.randf()
			var e := {"kind": kind, "spot": k, "live": roll < float(CHANCE[kind]), "open": 0.0, "close": INF,
				"seed": rng.randi(), "count": 1, "from": 1.0, "skew": 0.0, "pace": 0.0}
			match kind:
				"deer":
					e.count = 1 if a < 0.55 else (2 if a < 0.8 else 3) # sometimes a family
					e.from = -1.0 if b < 0.5 else 1.0
					e.skew = (c - 0.5) * 0.6
					e.pace = lerpf(DEER_PACE.x, DEER_PACE.y, d)
				"birds":
					e.count = 5 + int(a * 5.0)
				"moose":
					e.open = a * 60.0
					e.close = e.open + 70.0 + b * 90.0
				"bigfoot":
					e.open = a * 45.0
					e.close = e.open + 80.0 + b * 100.0
				"camper":
					e.count = 2
			out.append(e)
	return out


## Same seed, same surprises. Rebuilds the creatures for the live entries.
func configure(seed_in: int) -> void:
	seed_value = seed_in
	schedule = make_schedule(seed_in, spot_counts())
	for r in _live:
		for n in r.nodes:
			(n as Node).queue_free()
	_live.clear()
	for e in schedule:
		var live: bool = e.live
		if force.has("all"):
			live = bool(force["all"])
		if force.has(e.kind):
			live = bool(force[e.kind])
		if not live:
			continue
		var forced: bool = force.has("all") or force.has(e.kind)
		var spot: Node3D = null
		if e.kind != "camper":
			spot = _spots[e.kind][e.spot]
		var r := {"e": e, "spot": spot, "nodes": [], "state": "wait", "shown": false, "t0": 0.0,
			"open": 0.0 if forced else float(e.open), "close": INF if forced else float(e.close)}
		call("_make_" + String(e.kind), r)
		for n in r.nodes:
			_hide(n)
		# Birds are invisible until they burst out, so they can be armed anywhere.
		r.shown = e.kind == "birds"
		_live.append(r)


## Live entries of one kind (tests and tools).
func live(kind: String) -> Array:
	return _live.filter(func(r: Dictionary) -> bool: return r.e.kind == kind)


func _physics_process(dt: float) -> void:
	time += dt


func _process(dt: float) -> void:
	if car == null:
		return
	for r in _live:
		var want := time >= float(r.open) and time < float(r.close)
		var anchor: Vector3 = _anchor(r)
		var far := _flat(car.global_position).distance_to(_flat(anchor)) > SHOW_R
		# Appear and vanish only out of sight: past the far plane and fog,
		# and well beyond the top-down frame.
		if far:
			_set_shown(r, want and r.state != "done")
		if r.shown:
			call("_tick_" + String(r.e.kind), r, dt)


func _anchor(r: Dictionary) -> Vector3:
	if r.e.kind == "camper":
		return (r.nodes[0] as Node3D).global_position
	return (r.spot as Node3D).global_position


func _set_shown(r: Dictionary, on: bool) -> void:
	if r.shown == on:
		return
	r.shown = on
	for n in r.nodes:
		if n is Node3D:
			(n as Node3D).visible = on and not n.has_meta("hidden_until_used")


func _hide(n: Node) -> void:
	if n is Node3D:
		(n as Node3D).visible = false


static func _flat(p: Vector3) -> Vector2:
	return Vector2(p.x, p.z)


func _mi(mesh: Mesh, shadows := false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.layers = LAYER
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi


# --- deer ------------------------------------------------------------------------

func _make_deer(r: Dictionary) -> void:
	var e: Dictionary = r.e
	var spot: Node3D = r.spot
	r.deer = []
	r.edge = float(spot.get_meta("edge", 5.0))
	for k in int(e.count):
		var mi := _mi(_mesh("deer_stand"), true)
		# Bigger than life, a little: from the top-down camera a true-size
		# deer is a brown fleck on a brown road. The rest of a family are fawns.
		var s := 1.2 if k == 0 else 0.85
		r.deer.append({"node": mi, "lat": float(e.from) * (DEER_WAIT + k * 1.3), "along": (k - 0.5 * (e.count - 1)) * 2.4,
			"phase": k * 1.1, "delay": k * 0.45, "scale": s, "dir": -float(e.from), "speed": 0.0, "moving": false})
		r.nodes.append(mi)
		_place_deer(r, r.deer[k], 0.0)


func _tick_deer(r: Dictionary, dt: float) -> void:
	var spot: Node3D = r.spot
	var c := spot.global_position
	var to := c - car.global_position
	to.y = 0.0
	var gap := to.length()
	var speed := Vector2(car.velocity.x, car.velocity.z).length()
	if r.state == "wait" and gap < 95.0 and car.velocity.dot(to) > 0.0 and gap / maxf(speed, 6.0) < DEER_LEAD:
		r.state = "cross"
		r.t0 = time
	# Too close: everyone bolts. Mid-road or past it, they keep going;
	# still on their own side, they turn back into the trees.
	if r.state == "wait" or r.state == "cross":
		for d in r.deer:
			if _flat(car.global_position).distance_to(_flat((d.node as Node3D).global_position)) < SPOOK_R:
				r.state = "bolt"
				for dd in r.deer:
					var on_start_side: bool = signf(dd.lat) == float(r.e.from) and absf(dd.lat) > float(r.edge)
					dd.dir = float(r.e.from) if on_start_side else -float(r.e.from)
					dd.delay = 0.0
				break
	var all_done := true
	for d in r.deer:
		var go: bool = r.state == "bolt" or (r.state == "cross" and time - float(r.t0) >= float(d.delay))
		if go and absf(d.lat) < DEER_END:
			d.speed = DEER_BOLT if r.state == "bolt" else float(r.e.pace)
			d.lat += float(d.dir) * float(d.speed) * dt
			d.along += float(r.e.skew) * float(d.speed) * dt
			if not d.moving:
				d.moving = true
				(d.node as MeshInstance3D).mesh = _mesh("deer_leap")
		elif d.moving and absf(d.lat) >= DEER_END:
			d.moving = false
			d.speed = 0.0
			(d.node as MeshInstance3D).mesh = _mesh("deer_stand")
		all_done = all_done and absf(d.lat) >= DEER_END
		_place_deer(r, d, dt)
	if all_done and r.state != "wait":
		r.state = "gone" # standing deep in the trees; hidden once the car is far


## Puts one deer on the ground at its (lat, along) from the spot, bounding
## in arcs while it moves: a hop, a rock of the body, nothing skeletal.
func _place_deer(r: Dictionary, d: Dictionary, dt: float) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var right := Vector3(-fwd.z, 0, fwd.x)
	var p: Vector3 = spot.global_position + right * float(d.lat) + fwd * float(d.along)
	var hop := 0.0
	var pitch := 0.0
	var move := right * float(d.dir) + fwd * float(r.e.skew)
	if d.moving:
		var stride := 4.2 if r.state == "bolt" else 3.0
		d.phase += dt * float(d.speed) / stride * PI
		hop = (0.75 if r.state == "bolt" else 0.45) * absf(sin(d.phase)) * float(d.scale)
		pitch = -0.28 * cos(d.phase)
	elif r.state == "wait":
		move = -right * float(r.e.from) # watching the road
	p.y = track.height_at(p.x, p.z) + hop
	var basis := Basis.looking_at(move.normalized(), Vector3.UP) * Basis(Vector3.RIGHT, pitch)
	(d.node as Node3D).global_transform = Transform3D(basis.scaled(Vector3.ONE * float(d.scale)), p)


# --- birds -----------------------------------------------------------------------

func _make_birds(r: Dictionary) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = _mesh("bird")
	mm.instance_count = int(r.e.count)
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.layers = LAYER
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var spot: Node3D = r.spot
	mi.custom_aabb = AABB(Vector3(-60, -5, -60), Vector3(120, 60, 120))
	mi.global_position = spot.global_position
	mi.set_meta("hidden_until_used", true)
	r.nodes.append(mi)
	r.mm = mm
	var rng := RandomNumberGenerator.new()
	rng.seed = int(r.e.seed)
	var side := float(spot.get_meta("side", 1.0))
	var fwd := -spot.global_basis.z
	var away := Vector3(-fwd.z, 0, fwd.x) * side
	r.birds = []
	for k in int(r.e.count):
		var ang := rng.randf_range(-0.9, 0.9)
		r.birds.append({
			"p0": Vector3(rng.randf_range(-3, 3), rng.randf_range(9.0, 12.5), rng.randf_range(-3, 3)),
			"dir": away.rotated(Vector3.UP, ang), "speed": rng.randf_range(6.0, 9.0),
			"climb": rng.randf_range(2.0, 3.5), "flap": rng.randf_range(5.5, 7.0), "phase": rng.randf() * TAU,
			"delay": rng.randf_range(0.0, 0.5),
		})


func _tick_birds(r: Dictionary, _dt: float) -> void:
	var spot: Node3D = r.spot
	var mi: MultiMeshInstance3D = r.nodes[0]
	if r.state == "wait":
		if _flat(car.global_position).distance_to(_flat(spot.global_position)) < BIRD_TRIGGER:
			r.state = "fly"
			r.t0 = time
			mi.remove_meta("hidden_until_used")
			mi.visible = true
		return
	if r.state != "fly":
		return
	var t := time - float(r.t0)
	if t > BIRD_TIME:
		r.state = "done"
		mi.visible = false
		return
	var mm: MultiMesh = r.mm
	for k in r.birds.size():
		var b: Dictionary = r.birds[k]
		var tb := maxf(t - float(b.delay), 0.0)
		var p: Vector3 = b.p0 + b.dir * float(b.speed) * tb + Vector3(0, float(b.climb) * tb + 0.5 * tb * tb, 0)
		# Wingbeat: flip the V by scaling Y through zero (never quite zero).
		var flap := sin(tb * TAU * float(b.flap) + float(b.phase))
		var sy := signf(flap) * maxf(absf(flap), 0.15) if tb > 0.0 else 1.0
		var heading := (b.dir as Vector3) + Vector3(0, 0.3, 0)
		mm.set_instance_transform(k, Transform3D(Basis.looking_at(heading.normalized(), Vector3.UP).scaled(Vector3(1, sy, 1)), p))


# --- moose -----------------------------------------------------------------------

func _make_moose(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var body := _mi(_mesh("moose_body"), true)
	# Side-on to the road, front end angled toward it; the head does the rest.
	body.global_transform = spot.global_transform.rotated_local(Vector3.UP, PI - 1.0)
	body.global_position.y = track.height_at(body.global_position.x, body.global_position.z) - 0.05
	var head := MeshInstance3D.new()
	head.mesh = _mesh("moose_head")
	head.layers = LAYER
	head.position = Vector3(0, 2.05, -1.25)
	body.add_child(head)
	r.nodes.append(body)
	r.head = head


func _tick_moose(r: Dictionary, dt: float) -> void:
	# Stares: the head turns after the car, slowly, as far as a neck goes.
	var head: Node3D = r.head
	var body: Node3D = r.nodes[0]
	var local := body.global_transform.affine_inverse() * car.global_position
	var want := clampf(atan2(-local.x, -local.z), -1.1, 1.1)
	head.rotation.y = lerp_angle(head.rotation.y, want, 1.0 - exp(-2.5 * dt))


# --- campers ---------------------------------------------------------------------

func _make_camper(r: Dictionary) -> void:
	var jackets := [Color("2a6fd6"), Color("e8c21c")]
	var k := 0
	r.people = []
	for m in _spots.get("camper", []):
		var body := _mi(_mesh("camper_%d" % k))
		body.global_transform = (m as Node3D).global_transform
		body.global_position.y = track.height_at(body.global_position.x, body.global_position.z)
		var arm := MeshInstance3D.new()
		arm.mesh = _mesh("arm_%d" % k)
		arm.layers = LAYER
		arm.position = Vector3(0.31, 1.42, 0)
		body.add_child(arm)
		r.nodes.append(body)
		r.people.append({"body": body, "arm": arm, "duck": 0.0, "wave": 0.0, "phase": k * 1.7})
		k += 1
	r.duck_until = -1.0


func _tick_camper(r: Dictionary, dt: float) -> void:
	var near := _flat(car.global_position).distance_to(_flat(_anchor(r)))
	var speed := Vector2(car.velocity.x, car.velocity.z).length()
	var slip: float = absf(car.get("slip_angle")) if car.get("slip_angle") != null else 0.0
	if near < CAMPER_DUCK_R and slip > DUCK_SLIP and speed > 6.0:
		r.duck_until = time + 2.5
	var ducking: bool = time < float(r.duck_until)
	for p in r.people:
		var k := 1.0 - exp(-8.0 * dt)
		p.duck = lerpf(p.duck, 1.0 if ducking else 0.0, k)
		p.wave = lerpf(p.wave, 1.0 if (near < CAMPER_WAVE_R and not ducking) else 0.0, 1.0 - exp(-4.0 * dt))
		var body: Node3D = p.body
		body.scale = Vector3(1.0, lerpf(1.0, 0.58, p.duck), 1.0)
		# Arm: down by the side, up and waving, or over the head when ducking.
		var up := 2.55 + 0.45 * sin(time * TAU * 1.4 + float(p.phase))
		var angle := lerpf(0.12, up, p.wave)
		angle = lerpf(angle, 2.9, p.duck)
		(p.arm as Node3D).rotation = Vector3(0, 0, angle)


# --- bigfoot ---------------------------------------------------------------------

func _make_bigfoot(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var mi := _mi(_mesh("bigfoot"))
	r.from = spot.global_position
	r.to = spot.global_position + spot.global_basis.x * -BIGFOOT_WALK
	mi.global_transform = spot.global_transform
	mi.global_position.y = track.height_at(r.from.x, r.from.z)
	r.nodes.append(mi)


func _tick_bigfoot(r: Dictionary, _dt: float) -> void:
	var mi: Node3D = r.nodes[0]
	if r.state == "wait":
		if _flat(car.global_position).distance_to(_flat(r.from)) < 70.0:
			r.state = "walk"
			r.t0 = time
		return
	if r.state != "walk":
		return
	# Five unhurried metres, then still again: the famous footage.
	var t := clampf((time - float(r.t0)) / 4.5, 0.0, 1.0)
	var p: Vector3 = (r.from as Vector3).lerp(r.to, t)
	p.y = track.height_at(p.x, p.z) + absf(sin(t * PI * 6.0)) * 0.06
	var dir: Vector3 = (r.to - r.from).normalized()
	# Over the last stretch he turns to look back at the road.
	mi.global_transform = Transform3D(Basis.looking_at(dir, Vector3.UP).rotated(Vector3.UP, -1.0 * smoothstep(0.75, 1.0, t)), p)
	if t >= 1.0:
		r.state = "stood"


# --- wrong-way sign --------------------------------------------------------------

func _make_wrongway(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var side := float(spot.get_meta("side", 1.0))
	var mi := _mi(_mesh("sign_r" if side > 0 else "sign_l"))
	mi.global_transform = spot.global_transform
	var label := Label3D.new()
	label.text = "FINISH"
	label.font_size = 48
	label.pixel_size = 0.008
	label.outline_size = 0
	label.modulate = Color("1a1a1a")
	label.layers = LAYER
	label.position = Vector3(-0.12 * side, 1.75, 0.04)
	mi.add_child(label)
	r.nodes.append(mi)


func _tick_wrongway(_r: Dictionary, _dt: float) -> void:
	pass


# --- meshes ----------------------------------------------------------------------
# All front -Z, origin at the feet. Built once per process.

func _mesh(id: String) -> ArrayMesh:
	if not _mesh_cache.has(id):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		call("_build_" + id.get_slice("_", 0), st, id)
		var m := st.commit()
		m.surface_set_material(0, PALETTE)
		_mesh_cache[id] = m
	return _mesh_cache[id]


static func _box(st: SurfaceTool, xf: Transform3D, size: Vector3, col: Color) -> void:
	var b := BoxMesh.new()
	b.size = size
	var a := b.get_mesh_arrays()
	var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
	var nm: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
	var nb := xf.basis.inverse().transposed()
	for i in a[Mesh.ARRAY_INDEX]:
		st.set_color(col)
		st.set_normal((nb * nm[i]).normalized())
		st.add_vertex(xf * v[i])


static func _beam(st: SurfaceTool, a: Vector3, b: Vector3, w: float, col: Color) -> void:
	var d := b - a
	var up := Vector3.UP if absf(d.normalized().dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
	_box(st, Transform3D(Basis.looking_at(d, up), (a + b) * 0.5), Vector3(w, w, d.length()), col)


static func _at(p: Vector3) -> Transform3D:
	return Transform3D(Basis.IDENTITY, p)


func _build_deer(st: SurfaceTool, id: String) -> void:
	var coat := Color("7a4a2a")
	var dark := Color("553620")
	var white := Color("ece4d4")
	var leap := id == "deer_leap"
	var y := 0.0 if not leap else -0.25
	_box(st, _at(Vector3(0, 1.0 + y, 0.05)), Vector3(0.42, 0.44, 1.1), coat)
	_box(st, _at(Vector3(0, 1.05 + y, -0.42)), Vector3(0.46, 0.5, 0.36), coat)
	_box(st, _at(Vector3(0, 0.82 + y, 0.05)), Vector3(0.36, 0.08, 0.9), white.darkened(0.15)) # belly
	_beam(st, Vector3(0, 1.15 + y, -0.5), Vector3(0, 1.55 + y, -0.72), 0.18, coat)
	_box(st, Transform3D(Basis(Vector3.RIGHT, -0.35), Vector3(0, 1.6 + y, -0.86)), Vector3(0.2, 0.22, 0.42), coat)
	_box(st, _at(Vector3(0, 1.56 + y, -1.07)), Vector3(0.12, 0.1, 0.06), Color("2a2220")) # nose
	for x in [-0.11, 0.11]:
		_box(st, Transform3D(Basis(Vector3.BACK, x * 4.0), Vector3(x * 1.4, 1.78 + y, -0.76)), Vector3(0.07, 0.2, 0.05), dark)
	_box(st, _at(Vector3(0, 1.12 + y, 0.61)), Vector3(0.3, 0.26, 0.04), white) # rump
	_box(st, Transform3D(Basis(Vector3.RIGHT, 0.5 if leap else 0.2), Vector3(0, 1.2 + y, 0.66)), Vector3(0.12, 0.2, 0.07), white) # tail up
	for x in [-0.13, 0.13]:
		if leap:
			_beam(st, Vector3(x, 0.9 + y, -0.42), Vector3(x, 0.45 + y, -1.0), 0.09, dark)
			_beam(st, Vector3(x, 0.9 + y, 0.42), Vector3(x, 0.5 + y, 1.02), 0.1, dark)
		else:
			_beam(st, Vector3(x, 0.9, -0.4), Vector3(x, 0.0, -0.44), 0.09, dark)
			_beam(st, Vector3(x, 0.9, 0.42), Vector3(x, 0.0, 0.46), 0.1, dark)


func _build_bird(st: SurfaceTool, _id: String) -> void:
	# A V of two wings, both windings so it shows from above and below.
	var c := Color("2b2b2e")
	var nose := Vector3(0, 0, -0.18)
	var tail := Vector3(0, 0, 0.18)
	for wing in [Vector3(-0.45, 0.2, 0.08), Vector3(0.45, 0.2, 0.08)]:
		for tri in [[nose, wing, tail], [nose, tail, wing]]:
			var nrm: Vector3 = ((tri[2] - tri[0]) as Vector3).cross(tri[1] - tri[0]).normalized()
			for v in tri:
				st.set_color(c)
				st.set_normal(nrm)
				st.add_vertex(v)


func _build_moose(st: SurfaceTool, id: String) -> void:
	var coat := Color("3b2a1e")
	var legs := Color("5a4632")
	var antler := Color("b59a6a")
	if id == "moose_body":
		_box(st, _at(Vector3(0, 1.75, 0.1)), Vector3(0.9, 1.0, 2.2), coat)
		_box(st, _at(Vector3(0, 2.25, -0.55)), Vector3(0.8, 0.45, 0.9), coat) # shoulder hump
		_beam(st, Vector3(0, 1.9, -0.9), Vector3(0, 2.1, -1.25), 0.45, coat) # neck
		for x in [-0.3, 0.3]:
			_beam(st, Vector3(x, 1.4, -0.75), Vector3(x, 0.0, -0.8), 0.16, legs)
			_beam(st, Vector3(x, 1.4, 0.95), Vector3(x, 0.0, 0.98), 0.17, legs)
	else:
		# Head on its own node so it can turn to stare. Pivot at the neck.
		_box(st, Transform3D(Basis(Vector3.RIGHT, 0.5), Vector3(0, -0.15, -0.35)), Vector3(0.36, 0.4, 0.8), coat)
		_box(st, _at(Vector3(0, -0.45, -0.6)), Vector3(0.3, 0.12, 0.22), Color("2a1d15"))
		_box(st, _at(Vector3(0, -0.55, -0.1)), Vector3(0.1, 0.32, 0.1), coat) # bell
		for s in [-1.0, 1.0]:
			_beam(st, Vector3(s * 0.15, 0.1, -0.05), Vector3(s * 0.45, 0.3, -0.05), 0.08, antler)
			_box(st, Transform3D(Basis(Vector3.BACK, s * 0.35), Vector3(s * 0.75, 0.42, -0.05)), Vector3(0.7, 0.06, 0.45), antler)
			for t in 3:
				_beam(st, Vector3(s * (0.55 + t * 0.18), 0.45, -0.2 + t * 0.1), Vector3(s * (0.6 + t * 0.2), 0.75, -0.25 + t * 0.12), 0.05, antler)


func _build_camper(st: SurfaceTool, id: String) -> void:
	var jacket := Color("2a6fd6") if id.ends_with("0") else Color("e8c21c")
	_box(st, _at(Vector3(0, 0.43, 0)), Vector3(0.36, 0.86, 0.24), Color("2e3440"))
	_box(st, _at(Vector3(0, 1.16, 0)), Vector3(0.52, 0.64, 0.3), jacket)
	_box(st, _at(Vector3(0, 1.62, 0)), Vector3(0.26, 0.28, 0.26), Color("e0b48e"))
	_box(st, _at(Vector3(0, 1.8, 0)), Vector3(0.29, 0.12, 0.29), jacket.darkened(0.35)) # beanie
	_box(st, _at(Vector3(-0.31, 1.13, 0)), Vector3(0.12, 0.6, 0.13), jacket.darkened(0.1)) # other arm, down


func _build_arm(st: SurfaceTool, id: String) -> void:
	var jacket := Color("2a6fd6") if id.ends_with("0") else Color("e8c21c")
	_box(st, _at(Vector3(0, -0.3, 0)), Vector3(0.12, 0.6, 0.13), jacket.darkened(0.1))
	_box(st, _at(Vector3(0, -0.64, 0)), Vector3(0.11, 0.1, 0.11), Color("e0b48e")) # hand


func _build_bigfoot(st: SurfaceTool, _id: String) -> void:
	var fur := Color("2a2019")
	var face := Color("4a3a2e")
	for x in [-0.18, 0.18]:
		_beam(st, Vector3(x, 1.05, 0.02), Vector3(x * 1.1, 0.0, 0.05), 0.26, fur)
	_box(st, Transform3D(Basis(Vector3.RIGHT, -0.18), Vector3(0, 1.5, 0)), Vector3(0.82, 0.95, 0.5), fur)
	_box(st, _at(Vector3(0, 2.08, -0.12)), Vector3(0.38, 0.4, 0.38), fur)
	_box(st, _at(Vector3(0, 2.05, -0.3)), Vector3(0.24, 0.2, 0.04), face)
	for x in [-0.5, 0.5]:
		_beam(st, Vector3(x, 1.85, -0.05), Vector3(x * 1.15, 0.85, -0.2), 0.2, fur) # long arms


func _build_sign(st: SurfaceTool, id: String) -> void:
	# A yellow arrow board on a post; it points into the trees, down the spur.
	var s := 1.0 if id == "sign_r" else -1.0
	_box(st, _at(Vector3(0, 0.85, 0)), Vector3(0.1, 1.7, 0.1), Color("6b6660"))
	var pts := [Vector2(-0.9, -0.28), Vector2(0.45, -0.28), Vector2(0.45, -0.48), Vector2(1.05, 0.0),
		Vector2(0.45, 0.48), Vector2(0.45, 0.28), Vector2(-0.9, 0.28)]
	var poly := PackedVector2Array()
	for p in pts:
		poly.append(Vector2(p.x * s, p.y))
	var tris := Geometry2D.triangulate_polygon(poly)
	# Both windings on each face (the material culls backs): yellow in front,
	# bare grey board behind.
	for face in [[0.03, Color("f2c21b"), 1.0], [-0.03, Color("6b6660"), -1.0]]:
		for t in range(0, tris.size(), 3):
			for tri in [[tris[t], tris[t + 1], tris[t + 2]], [tris[t], tris[t + 2], tris[t + 1]]]:
				for k in tri:
					st.set_color(face[1])
					st.set_normal(Vector3(0, 0, face[2]))
					st.add_vertex(Vector3(poly[k].x, 1.75 + poly[k].y, face[0]))
