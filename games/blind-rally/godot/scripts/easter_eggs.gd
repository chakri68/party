class_name EasterEggs
extends Node3D
## Rare surprises along the stage. Pine Panic: deer bounding across the
## road, birds bursting out of the canopy, a moose staring from a glade,
## campers who wave (and duck when the car slides at them), a very rare
## Bigfoot, and a sign at a junction to nowhere pointing the wrong way.
## Dust Devil: tumbleweeds rolling across in front of the car, a roadrunner
## that races it down the road and peels off, vultures circling over some
## bones, a cow skull nailed to a LOST COW sign, and (one run in twenty) a
## flying saucer nose-down in a fresh crater, its pilot watching you go by.
## Snowblind: snowmen by the road (pass one fast and its head comes off),
## skiers schussing across down the piste under the lift, an elk watching
## from a clearing, a snowmobile that races the car along its trail, and
## (one run in twenty) a yeti, who has been practising the Bigfoot walk.
## Cliffhanger: gulls on the guard rail that lift off as the car comes by,
## a whale breaching offshore, a fishing boat working along the coast, a
## seal on the rocks who watches you go, and (one run in twenty) something
## in the water: a sea serpent's coils, or a kraken's arm.
## A kind only happens on a track that has spots for it.
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
const KINDS := ["deer", "birds", "moose", "camper", "bigfoot", "wrongway",
	"tumbleweed", "roadrunner", "vultures", "skull", "ufo",
	"snowman", "skier", "elk", "snowmobile", "yeti",
	"gulls", "whale", "boat", "seal", "serpent"]
## Chance a spot is live in a run. Rare by design: most runs see two or
## three things, Bigfoot about one run in seventeen.
const CHANCE := {"deer": 0.35, "birds": 0.5, "moose": 0.3, "camper": 0.75, "bigfoot": 0.06, "wrongway": 0.4,
	"tumbleweed": 0.55, "roadrunner": 0.35, "vultures": 0.5, "skull": 0.5, "ufo": 0.05,
	"snowman": 0.5, "skier": 0.4, "elk": 0.35, "snowmobile": 0.35, "yeti": 0.05,
	"gulls": 0.55, "whale": 0.35, "boat": 0.5, "seal": 0.45, "serpent": 0.05}
const WEED_LEAD := 2.6 ## seconds: a tumbleweed sets off when the car is about this far away
const WEED_FROM := 9.0 ## metres off the centreline it starts
const WEED_END := 32.0
const RUNNER_TRIGGER := 48.0 ## metres: the roadrunner sets off when the car is this close
const RUNNER_TIME := 3.6 ## seconds racing down the road before it peels off
const VULTURE_HEIGHT := Vector2(26.0, 38.0)
const SNOWMAN_KNOCK := Vector2(9.0, 14.0) ## within 9 m of it at 14 m/s or more, the head comes off
const SKIER_LEAD := 4.6 ## seconds: a skier pushes off when the car is about this far away (and is across first)
const SKIER_FROM := 22.0 ## metres up the slope from the centreline
const SKIER_END := 34.0 ## ...and how far down the other side they stop
const SLED_TRIGGER := 50.0
const SLED_TIME := 5.0 ## seconds alongside before it peels off
const GULL_TRIGGER := 30.0 ## metres: the gulls on the rail lift off when the car is this close
const GULL_TIME := 8.0 ## seconds flying before they're gone
const GULL_SCALE := 1.7
const BREACH_TIME := 3.6 ## seconds from the whale breaking the surface to the splash
const BOAT_RANGE := 70.0 ## metres the boat works up and down the coast from its spot (spot meta "range" if shorter)
const MESH_DIR := "res://assets/meshes/"

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
				"tumbleweed":
					e.count = 1 if a < 0.6 else (2 if a < 0.9 else 3)
					e.from = -1.0 if b < 0.5 else 1.0
					e.skew = (c - 0.5) * 0.5
					e.pace = lerpf(4.5, 7.5, d)
				"roadrunner":
					e.from = -1.0 if b < 0.5 else 1.0
				"vultures":
					e.count = 3 + int(a * 3.0)
				"skier":
					e.count = 1 if a < 0.65 else 2
					e.skew = (c - 0.5) * 0.3
					e.pace = lerpf(8.0, 11.0, d)
				"yeti":
					e.open = a * 45.0
					e.close = e.open + 80.0 + b * 100.0
				"gulls":
					e.count = 4 + int(a * 4.0)
				"whale":
					e.pace = lerpf(9.0, 15.0, a) # seconds between breaches
					e.skew = b # where in that cycle the run starts
					e.from = -1.0 if c < 0.5 else 1.0 # which way it rolls
				"boat":
					e.from = -1.0 if a < 0.5 else 1.0
					e.skew = b
					e.pace = lerpf(1.6, 2.6, c)
				"seal":
					e.count = 1 if a < 0.7 else 2
				"serpent":
					e["variant"] = "kraken" if b < 0.45 else "serpent"
					e.open = c * 45.0
					e.close = e.open + 90.0 + d * 100.0
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


# --- tumbleweed -------------------------------------------------------------------

func _make_tumbleweed(r: Dictionary) -> void:
	var e: Dictionary = r.e
	var spot: Node3D = r.spot
	r.edge = float(spot.get_meta("edge", 5.0))
	r.weeds = []
	for k in int(e.count):
		var mi := _mi(_mesh("weed_%d" % (k % 2)), true)
		var s := 1.0 - k * 0.18
		r.weeds.append({"node": mi, "lat": float(e.from) * (WEED_FROM + k * 2.5), "along": (k - 0.5 * (e.count - 1)) * 4.0,
			"delay": k * 0.6, "scale": s, "roll": k * 1.3, "phase": k * 0.9})
		r.nodes.append(mi)
		_place_weed(r, r.weeds[k], 0.0, false)


func _tick_tumbleweed(r: Dictionary, dt: float) -> void:
	var spot: Node3D = r.spot
	var to := spot.global_position - car.global_position
	to.y = 0.0
	var gap := to.length()
	var speed := Vector2(car.velocity.x, car.velocity.z).length()
	if r.state == "wait" and gap < 110.0 and car.velocity.dot(to) > 0.0 and gap / maxf(speed, 6.0) < WEED_LEAD:
		r.state = "roll"
		r.t0 = time
	var done := true
	for w in r.weeds:
		var go: bool = r.state == "roll" and time - float(r.t0) >= float(w.delay) and absf(w.lat) < WEED_END
		if go:
			w.lat -= float(r.e.from) * float(r.e.pace) * dt
			w.along += float(r.e.skew) * float(r.e.pace) * dt
			if signf(w.lat) != float(r.e.from) and absf(w.lat) >= WEED_END:
				w.lat = -float(r.e.from) * WEED_END
		done = done and r.state == "roll" and absf(w.lat) >= WEED_END and signf(w.lat) != float(r.e.from)
		_place_weed(r, w, dt, go)
	if done:
		r.state = "gone"


## Bounces along in low hops and rolls the way it's going: a ball of twigs.
func _place_weed(r: Dictionary, w: Dictionary, dt: float, moving: bool) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var right := Vector3(-fwd.z, 0, fwd.x)
	var p: Vector3 = spot.global_position + right * float(w.lat) + fwd * float(w.along)
	var s: float = w.scale
	var hop := 0.0
	if moving:
		w.phase += dt * float(r.e.pace) / 2.6 * PI
		w.roll += dt * float(r.e.pace) / (0.55 * s)
		hop = 0.55 * absf(sin(w.phase)) * s
	var move := (-right * float(r.e.from) + fwd * float(r.e.skew)).normalized()
	var axis := move.cross(Vector3.UP).normalized()
	p.y = track.height_at(p.x, p.z) + 0.55 * s + hop
	(w.node as Node3D).global_transform = Transform3D(Basis(axis, -float(w.roll)).scaled(Vector3.ONE * s), p)


# --- roadrunner --------------------------------------------------------------------

func _make_roadrunner(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var mi := _mi(_mesh("runner_a"))
	r.edge = float(spot.get_meta("edge", 5.0))
	r.lat = float(r.e.from) * (r.edge + 1.5)
	r.along = 0.0
	r.speed = 0.0
	r.step = 0.0
	r.bi = _nearest_sample(spot.global_position)
	var meep := Label3D.new()
	meep.text = "meep meep"
	meep.font_size = 40
	meep.pixel_size = 0.01
	meep.outline_size = 8
	meep.modulate = Color("fff4d6")
	meep.outline_modulate = Color("3a2a1a")
	meep.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	meep.layers = LAYER
	meep.position = Vector3(0, 1.6, 0)
	meep.visible = false
	mi.add_child(meep)
	r.meep = meep
	r.nodes.append(mi)
	_place_runner(r)


func _tick_roadrunner(r: Dictionary, dt: float) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var mi: MeshInstance3D = r.nodes[0]
	var rel := mi.global_position - car.global_position
	rel.y = 0.0
	if r.state == "wait":
		# Only from behind: a car coming the other way gets ignored.
		if rel.length() < RUNNER_TRIGGER and car.velocity.dot(fwd) > 4.0 and rel.dot(fwd) > 0.0:
			r.state = "run"
			r.t0 = time
			(r.meep as Label3D).visible = true
		return
	if r.state == "gone":
		return
	var t := time - float(r.t0)
	var car_v := maxf(car.velocity.dot(fwd), 0.0)
	if r.state == "run":
		# Onto the crown, then just ahead of the car, a little faster than it.
		r.speed = clampf(car_v + 3.5, 9.0, 34.0)
		r.along += float(r.speed) * dt
		r.lat = move_toward(float(r.lat), 0.0, 6.0 * dt)
		if t > 1.4:
			(r.meep as Label3D).visible = false
		if t > RUNNER_TIME:
			r.state = "veer"
	elif r.state == "veer":
		r.speed = move_toward(float(r.speed), 8.0, 10.0 * dt)
		r.along += float(r.speed) * dt * 0.6
		r.lat += -float(r.e.from) * float(r.speed) * dt
		if absf(float(r.lat)) > 28.0:
			r.state = "gone"
	r.step += dt * float(r.speed) / 0.9
	mi.mesh = _mesh("runner_a" if int(r.step) % 2 == 0 else "runner_b")
	_place_runner(r)


## On the road at (lat, along) from the spot, on the ground, facing its way.
## Bigger than life (a real one is a fleck from the top-down camera).
func _place_runner(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var right := Vector3(-fwd.z, 0, fwd.x)
	var p: Vector3 = spot.global_position + right * float(r.lat) + fwd * float(r.along)
	# The road isn't straight for long: follow the centreline sideways.
	if r.along > 0.0 and track.centerline.size() > 1:
		p = _along_road(int(r.bi), float(r.along), float(r.lat))
	p.y = track.height_at(p.x, p.z)
	var dir := fwd
	if r.state == "veer":
		dir = (fwd * 0.6 - right * float(r.e.from)).normalized()
	elif r.state == "wait":
		dir = -right * float(r.e.from)
	(r.nodes[0] as Node3D).global_transform = Transform3D(Basis.looking_at(dir, Vector3.UP).scaled(Vector3.ONE * 1.8), p)


func _nearest_sample(from: Vector3) -> int:
	var line := track.centerline
	var best := INF
	var bi := 0
	for i in line.size():
		var d := Vector2(line[i].x - from.x, line[i].z - from.z).length_squared()
		if d < best:
			best = d
			bi = i
	return bi


## The point `along` metres down the centreline from sample bi, `lat`
## metres to its right.
func _along_road(bi: int, along: float, lat: float) -> Vector3:
	var line := track.centerline
	var step := track.length_m / maxf(line.size() - 1, 1)
	var f := bi + along / step
	var i0 := clampi(int(f), 0, line.size() - 2)
	var p := line[i0].lerp(line[i0 + 1], clampf(f - i0, 0.0, 1.0))
	var tan := (line[i0 + 1] - line[i0]).normalized()
	return p + Vector3(-tan.z, 0, tan.x) * lat


# --- vultures ----------------------------------------------------------------------

func _make_vultures(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var rng := RandomNumberGenerator.new()
	rng.seed = int(r.e.seed)
	r.birds = []
	for k in int(r.e.count):
		var mi := _mi(_mesh("vulture"))
		r.birds.append({"node": mi, "radius": rng.randf_range(10.0, 19.0), "h": rng.randf_range(VULTURE_HEIGHT.x, VULTURE_HEIGHT.y),
			"phase": rng.randf() * TAU, "rate": rng.randf_range(0.16, 0.24) * (1.0 if k % 3 else -1.0)})
		r.nodes.append(mi)
	# What they're circling.
	var bones := _mi(_baked("bones"))
	bones.global_transform = Transform3D(Basis(Vector3.UP, rng.randf() * TAU), spot.global_position)
	bones.global_position.y = track.height_at(spot.global_position.x, spot.global_position.z) - 0.05
	r.nodes.append(bones)
	_tick_vultures(r, 0.0)


func _tick_vultures(r: Dictionary, _dt: float) -> void:
	var c: Vector3 = (r.spot as Node3D).global_position
	var g := track.height_at(c.x, c.z)
	for b in r.birds:
		var a: float = float(b.phase) + time * float(b.rate)
		var p := c + Vector3(cos(a), 0, sin(a)) * float(b.radius)
		p.y = g + float(b.h) + sin(time * 0.4 + float(b.phase)) * 1.2
		var tangent := Vector3(-sin(a), 0, cos(a)) * signf(float(b.rate))
		# Banked into the circle, wings near level: soaring, not flapping.
		var basis := Basis.looking_at(tangent, Vector3.UP) * Basis(Vector3.FORWARD, -0.32 * signf(float(b.rate)))
		(b.node as Node3D).global_transform = Transform3D(basis.scaled(Vector3.ONE * 1.6), p)


# --- cow skull sign ----------------------------------------------------------------

func _make_skull(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var post := _mi(_baked("signpost"))
	post.global_transform = spot.global_transform
	post.global_position.y = track.height_at(post.global_position.x, post.global_position.z) - 0.05
	var skull := MeshInstance3D.new()
	skull.mesh = _mesh("skull")
	skull.layers = LAYER
	skull.position = Vector3(0, 2.2, 0.08)
	post.add_child(skull)
	var label := Label3D.new()
	label.text = "LOST COW\nREWARD"
	label.font_size = 40
	label.pixel_size = 0.0075
	label.outline_size = 0
	label.modulate = Color("2a1a12")
	label.layers = LAYER
	label.position = Vector3(0, 1.62, 0.12)
	post.add_child(label)
	r.nodes.append(post)


func _tick_skull(_r: Dictionary, _dt: float) -> void:
	pass


# --- UFO -----------------------------------------------------------------------------

func _make_ufo(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var base := spot.global_position
	base.y = track.height_at(base.x, base.z)
	var crater := _mi(_baked("crater"))
	crater.global_transform = Transform3D(spot.global_basis, base + Vector3(0, -1.2, 0))
	r.nodes.append(crater)
	var saucer := _mi(_mesh("saucer"), true)
	# Nose-down in the crater, a good 35 degrees over.
	saucer.global_transform = Transform3D(spot.global_basis * Basis(Vector3.RIGHT, 0.6) * Basis(Vector3.FORWARD, 0.25), base + Vector3(0, 0.6, 0))
	r.nodes.append(saucer)
	# Its lights still going (slow, never flashing), and a wisp over it.
	for k in 4:
		var a := TAU * k / 4.0
		var q := QuadMesh.new()
		q.size = Vector2(1.6, 1.6)
		var g := MeshInstance3D.new()
		g.mesh = q
		g.layers = LAYER
		g.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		g.material_override = _glow_mat(Color(0.45, 1.0, 0.7) if k % 2 == 0 else Color(1.0, 0.45, 0.85), 1.2, 2.4 + k * 0.7)
		g.position = Vector3(cos(a) * 4.1, 0.25, sin(a) * 4.1)
		saucer.add_child(g)
	var alien := _mi(_baked("alien"), true)
	var side := spot.global_basis.x
	alien.global_position = base + side * 7.5
	alien.global_position.y = track.height_at(alien.global_position.x, alien.global_position.z)
	r.nodes.append(alien)
	r.alien = alien


func _tick_ufo(r: Dictionary, dt: float) -> void:
	# The pilot turns to watch the car go by, like the moose.
	var alien: Node3D = r.alien
	var to := car.global_position - alien.global_position
	to.y = 0.0
	if to.length() < 1.0:
		return
	var want := atan2(-to.x, -to.z) + PI
	alien.rotation.y = lerp_angle(alien.rotation.y, want, 1.0 - exp(-2.0 * dt))



# --- snowman ---------------------------------------------------------------------

func _make_snowman(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var body := _mi(_mesh("snowman_body"), true)
	body.global_transform = spot.global_transform
	body.global_position.y = track.height_at(body.global_position.x, body.global_position.z) - 0.05
	body.scale = Vector3.ONE * 1.5 # life size is a white dot on white from the top-down camera
	var head := MeshInstance3D.new()
	head.mesh = _mesh("snowman_head")
	head.layers = LAYER
	head.position = Vector3(0, 1.38, 0)
	body.add_child(head)
	r.nodes.append(body)
	r.head = head


func _tick_snowman(r: Dictionary, _dt: float) -> void:
	var body: Node3D = r.nodes[0]
	var head: Node3D = r.head
	if r.state == "wait":
		var gap := _flat(car.global_position).distance_to(_flat(body.global_position))
		var speed := Vector2(car.velocity.x, car.velocity.z).length()
		if gap < SNOWMAN_KNOCK.x and speed > SNOWMAN_KNOCK.y:
			r.state = "fall"
			r.t0 = time
			# Off the back, away from the road: the wind of a car going past.
			var away := body.global_position - car.global_position
			away.y = 0.0
			r.away = body.global_basis.inverse() * away.normalized()
		return
	if r.state != "fall":
		return
	var t := minf(time - float(r.t0), 0.62)
	var away: Vector3 = r.away
	var y := 1.38 + 1.2 * t - 4.9 * t * t * 2.0
	head.position = Vector3(0, maxf(y, 0.22), 0) + away * 2.2 * t
	head.rotation = Vector3(away.z, 0, -away.x) * t * 4.0
	if t >= 0.62:
		r.state = "fallen"


# --- skiers ----------------------------------------------------------------------

func _make_skier(r: Dictionary) -> void:
	var e: Dictionary = r.e
	var spot: Node3D = r.spot
	var up := float(spot.get_meta("uphill", spot.get_meta("side", 1.0)))
	r.up = up
	r.skiers = []
	for k in int(e.count):
		var mi := _mi(_mesh("skier_%d" % k), true)
		r.skiers.append({"node": mi, "lat": up * (SKIER_FROM + k * 6.0), "along": k * 1.5, "delay": k * 0.8, "phase": k * 1.3})
		r.nodes.append(mi)
		_place_skier(r, r.skiers[k], 0.0, false)


func _tick_skier(r: Dictionary, dt: float) -> void:
	var spot: Node3D = r.spot
	var to := spot.global_position - car.global_position
	to.y = 0.0
	var gap := to.length()
	var speed := Vector2(car.velocity.x, car.velocity.z).length()
	if r.state == "wait" and gap < 100.0 and car.velocity.dot(to) > 0.0 and gap / maxf(speed, 6.0) < SKIER_LEAD:
		r.state = "ski"
		r.t0 = time
	var done := true
	for sk in r.skiers:
		var go: bool = r.state == "ski" and time - float(r.t0) >= float(sk.delay) and float(sk.lat) * float(r.up) > -SKIER_END
		if go:
			sk.lat -= float(r.up) * float(r.e.pace) * dt
			sk.along += float(r.e.skew) * float(r.e.pace) * dt
		done = done and float(sk.lat) * float(r.up) <= -SKIER_END
		_place_skier(r, sk, dt, go)
	if done and r.state == "ski":
		r.state = "gone"


## Down the fall line in a tuck, carving a little side to side.
func _place_skier(r: Dictionary, sk: Dictionary, dt: float, moving: bool) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var right := Vector3(-fwd.z, 0, fwd.x)
	var carve := 0.0
	if moving:
		sk.phase += dt * 2.4
		carve = sin(float(sk.phase)) * 0.35
	var p: Vector3 = spot.global_position + right * float(sk.lat) + fwd * (float(sk.along) + carve * 1.2)
	p.y = track.height_at(p.x, p.z)
	var down := (-right * float(r.up) + fwd * (float(r.e.skew) + carve * 0.4)).normalized()
	var basis := Basis.looking_at(down, Vector3.UP) * Basis(Vector3.FORWARD, -carve * 0.6)
	(sk.node as Node3D).global_transform = Transform3D(basis.scaled(Vector3.ONE * 1.3), p)


# --- elk -------------------------------------------------------------------------

func _make_elk(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var body := _mi(_mesh("elk_body"), true)
	body.global_transform = spot.global_transform.rotated_local(Vector3.UP, PI - 1.1)
	body.global_position.y = track.height_at(body.global_position.x, body.global_position.z) - 0.05
	var head := MeshInstance3D.new()
	head.mesh = _mesh("elk_head")
	head.layers = LAYER
	head.position = Vector3(0, 1.95, -1.15)
	body.add_child(head)
	r.nodes.append(body)
	r.head = head


func _tick_elk(r: Dictionary, dt: float) -> void:
	var head: Node3D = r.head
	var body: Node3D = r.nodes[0]
	var local := body.global_transform.affine_inverse() * car.global_position
	var want := clampf(atan2(-local.x, -local.z), -1.2, 1.2)
	head.rotation.y = lerp_angle(head.rotation.y, want, 1.0 - exp(-3.0 * dt))


# --- snowmobile --------------------------------------------------------------------

func _make_snowmobile(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var mi := _mi(_mesh("sled"), true)
	r.side = float(spot.get_meta("side", 1.0))
	r.lat = r.side * float(spot.get_meta("lat", 11.0))
	r.along = 0.0
	r.speed = 0.0
	r.bi = _nearest_sample(spot.global_position)
	r.nodes.append(mi)
	_place_sled(r, 0.0)


func _tick_snowmobile(r: Dictionary, dt: float) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var mi: Node3D = r.nodes[0]
	var rel := mi.global_position - car.global_position
	rel.y = 0.0
	if r.state == "wait":
		if rel.length() < SLED_TRIGGER and car.velocity.dot(fwd) > 4.0 and rel.dot(fwd) > -4.0:
			r.state = "run"
			r.t0 = time
		_place_sled(r, dt)
		return
	if r.state == "gone":
		return
	var t := time - float(r.t0)
	# Level with the car and a nose ahead: it's racing you.
	var car_along := (car.global_position - spot.global_position).dot(fwd)
	if r.state == "run":
		var want := clampf(car.velocity.dot(fwd) + (2.0 if float(r.along) < car_along + 4.0 else -1.0), 6.0, 30.0)
		r.speed = move_toward(float(r.speed), want, 9.0 * dt)
		r.along += float(r.speed) * dt
		if t > SLED_TIME:
			r.state = "veer"
	elif r.state == "veer":
		r.speed = move_toward(float(r.speed), 9.0, 6.0 * dt)
		r.along += float(r.speed) * dt * 0.7
		r.lat += float(r.side) * float(r.speed) * dt * 0.7
		if absf(float(r.lat)) > 40.0:
			r.state = "gone"
	_place_sled(r, dt)


func _place_sled(r: Dictionary, _dt: float) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var right := Vector3(-fwd.z, 0, fwd.x)
	var p: Vector3 = spot.global_position + right * (float(r.lat) - float(r.side) * float(spot.get_meta("lat", 11.0)))
	var dir := fwd
	if float(r.along) > 0.0 and track.centerline.size() > 1:
		p = _along_road(int(r.bi), float(r.along), float(r.lat))
		dir = (_along_road(int(r.bi), float(r.along) + 2.0, 0.0) - _along_road(int(r.bi), float(r.along), 0.0)).normalized()
	if r.state == "veer":
		dir = (dir + right * float(r.side) * 0.8).normalized()
	var bounce := sin(time * 9.0) * 0.05 if r.state == "run" else 0.0
	p.y = track.height_at(p.x, p.z) + bounce
	(r.nodes[0] as Node3D).global_transform = Transform3D(Basis.looking_at(Vector3(dir.x, 0, dir.z).normalized(), Vector3.UP), p)


# --- yeti ------------------------------------------------------------------------

func _make_yeti(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var mi := _mi(_mesh("yeti"))
	r.from = spot.global_position
	r.to = spot.global_position + spot.global_basis.x * -BIGFOOT_WALK
	mi.global_transform = spot.global_transform
	mi.global_position.y = track.height_at(r.from.x, r.from.z)
	r.nodes.append(mi)


## The same unhurried five metres as Bigfoot. Different coat.
func _tick_yeti(r: Dictionary, dt: float) -> void:
	_tick_bigfoot(r, dt)

# --- gulls -------------------------------------------------------------------------

func _make_gulls(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var rng := RandomNumberGenerator.new()
	rng.seed = int(r.e.seed)
	var side := float(spot.get_meta("side", 1.0))
	var edge := float(spot.get_meta("edge", 3.5))
	var gap := float(spot.get_meta("along", 1.6))
	var bi := _nearest_sample(spot.global_position)
	var fwd := -spot.global_basis.z
	var away := Vector3(-fwd.z, 0, fwd.x) * side
	r.gulls = []
	for k in int(r.e.count):
		var along := (k - 0.5 * (int(r.e.count) - 1)) * gap + rng.randf_range(-0.35, 0.35)
		var p := _along_road(bi, along, side * edge)
		p.y = spot.global_position.y
		var mi := _mi(_mesh("gull_sit"))
		# Bigger than life, like the deer: a true-size gull is a white dot.
		mi.global_transform = Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * GULL_SCALE), p)
		r.nodes.append(mi)
		# Out over the drop and on up the road, so the car sees them go.
		r.gulls.append({"node": mi, "p0": p, "dir": (away + fwd * 0.7).normalized().rotated(Vector3.UP, rng.randf_range(-0.5, 0.5)),
			"speed": rng.randf_range(4.0, 6.5), "climb": rng.randf_range(1.2, 2.2), "flap": rng.randf_range(3.2, 4.4),
			"phase": rng.randf() * TAU, "delay": rng.randf_range(0.0, 0.7), "up": false})


func _tick_gulls(r: Dictionary, _dt: float) -> void:
	var spot: Node3D = r.spot
	if r.state == "wait":
		if _flat(car.global_position).distance_to(_flat(spot.global_position)) < GULL_TRIGGER:
			r.state = "fly"
			r.t0 = time
		return
	if r.state != "fly":
		return
	var t := time - float(r.t0)
	if t > GULL_TIME:
		r.state = "done"
		for g in r.gulls:
			(g.node as Node3D).visible = false
		return
	for g in r.gulls:
		var tb := t - float(g.delay)
		if tb <= 0.0:
			continue
		if not g.up:
			g.up = true
			(g.node as MeshInstance3D).mesh = _mesh("gull_fly")
		# A hop off the rail, then out over the drop, climbing, wings beating
		# slower than the forest birds: they're gulls, they've got all day.
		var p: Vector3 = g.p0 + (g.dir as Vector3) * float(g.speed) * tb + Vector3(0, float(g.climb) * tb + 0.15 * tb * tb + 0.8 * minf(tb * 3.0, 1.0), 0)
		var flap := sin(tb * TAU * float(g.flap) + float(g.phase))
		var sy := signf(flap) * maxf(absf(flap), 0.2)
		var heading := (g.dir as Vector3) + Vector3(0, 0.25, 0)
		(g.node as Node3D).global_transform = Transform3D(Basis.looking_at(heading.normalized(), Vector3.UP).scaled(Vector3(1.0, sy, 1.0) * GULL_SCALE), p)


# --- whale -------------------------------------------------------------------------

func _make_whale(r: Dictionary) -> void:
	var body := _mi(_mesh("whale"))
	var splash := _mi(_mesh("splash"))
	r.nodes.append(body)
	r.nodes.append(splash)
	_tick_whale(r, 0.0)


## A breach every e.pace seconds, on the clock: up out of the water nose
## first, over onto its side at the top, down with a splash. Between
## breaches it's under (and not drawn).
func _tick_whale(r: Dictionary, _dt: float) -> void:
	var spot: Node3D = r.spot
	var body: Node3D = r.nodes[0]
	var splash: Node3D = r.nodes[1]
	var sea := float(spot.get_meta("sea_y", 0.0))
	var period := float(r.e.pace)
	var tt := fposmod(time + float(r.e.skew) * period, period)
	var fwd := -spot.global_basis.z
	var base := spot.global_position
	base.y = sea
	var u := tt / BREACH_TIME
	body.visible = u < 1.0
	if u < 1.0:
		var lift := sin(PI * u)
		var p := base + fwd * (u - 0.5) * 9.0 + Vector3(0, -5.0 + 11.5 * lift, 0)
		# Out of the water nearly upright, over at the top, falling back flat.
		var pitch := lerpf(1.35, -0.55, smoothstep(0.12, 1.0, u))
		var roll := float(r.e.from) * 1.6 * smoothstep(0.3, 0.75, u)
		body.global_transform = Transform3D(Basis.looking_at(fwd, Vector3.UP) * Basis(Vector3.RIGHT, pitch) * Basis(Vector3.FORWARD, roll), p)
	# The splash: where it broke the surface, then a bigger one where it came down.
	var s := -1.0
	if u < 0.3:
		s = u / 0.3
	elif u > 0.78 and tt < BREACH_TIME + 1.4:
		s = 1.0 + (tt - BREACH_TIME * 0.78) / 1.4 * 0.8
	splash.visible = s > 0.0
	if s > 0.0:
		var rise := sin(clampf(s, 0.0, 1.0) * PI) if s <= 1.0 else maxf(1.0 - (s - 1.0) * 1.25, 0.0)
		splash.global_transform = Transform3D(Basis.IDENTITY.scaled(Vector3(0.6 + s * 0.5, 0.1 + rise * 1.1, 0.6 + s * 0.5)), base + fwd * ((u - 0.5) * 9.0 if u > 0.5 else -4.5))


# --- fishing boat --------------------------------------------------------------------

func _make_boat(r: Dictionary) -> void:
	var mi := _mi(_mesh("boat"), true)
	r.nodes.append(mi)
	r.yaw = 0.0
	r.yaw_set = false
	_tick_boat(r, 0.0)


## Up and down its stretch of coast on a slow sine, so it eases to a stop
## and comes about at the ends; bobbing and rolling on the swell.
func _tick_boat(r: Dictionary, dt: float) -> void:
	var spot: Node3D = r.spot
	var mi: Node3D = r.nodes[0]
	var fwd := -spot.global_basis.z
	var reach := float(spot.get_meta("range", BOAT_RANGE))
	var w := float(r.e.pace) / reach
	var ph := float(r.e.skew) * TAU
	var along := reach * sin(time * w + ph) * float(r.e.from)
	var v := cos(time * w + ph) * float(r.e.from)
	var p := spot.global_position + fwd * along
	p.y = float(spot.get_meta("sea_y", 0.0)) + 0.12 * sin(time * 1.3 + ph)
	var want := atan2(fwd.x, fwd.z) + (PI if v > 0.0 else 0.0)
	if not r.yaw_set:
		r.yaw = want
		r.yaw_set = true
	r.yaw = lerp_angle(float(r.yaw), want, 1.0 - exp(-0.6 * dt))
	var basis := Basis(Vector3.UP, float(r.yaw)) * Basis(Vector3.FORWARD, 0.07 * sin(time * 0.9 + ph)) * Basis(Vector3.RIGHT, 0.04 * sin(time * 1.7))
	mi.global_transform = Transform3D(basis, p)


# --- seal ----------------------------------------------------------------------------

func _make_seal(r: Dictionary) -> void:
	var spot: Node3D = r.spot
	var rng := RandomNumberGenerator.new()
	rng.seed = int(r.e.seed)
	r.heads = []
	for k in int(r.e.count):
		var body := _mi(_mesh("seal_body"), true)
		var xf := spot.global_transform.rotated_local(Vector3.UP, rng.randf_range(-0.8, 0.8))
		xf.origin += spot.global_basis.x * (k * 2.2 - 0.6 * (int(r.e.count) - 1)) + spot.global_basis.z * rng.randf_range(-0.6, 0.6)
		# Half as big again as life, like the gulls: from the road it's a
		# grey lump on grey rock otherwise.
		body.global_transform = xf.scaled_local(Vector3.ONE * (1.5 if k == 0 else 1.1))
		var head := MeshInstance3D.new()
		head.mesh = _mesh("seal_head")
		head.layers = LAYER
		head.position = Vector3(0, 0.42, -0.72)
		body.add_child(head)
		r.nodes.append(body)
		r.heads.append(head)


## Lies there. Lifts its head and follows the car when it's close.
func _tick_seal(r: Dictionary, dt: float) -> void:
	for head: Node3D in r.heads:
		var body := head.get_parent() as Node3D
		var local := body.global_transform.affine_inverse() * car.global_position
		var near := local.length() < 60.0
		var want := clampf(atan2(-local.x, -local.z), -1.3, 1.3) if near else 0.0
		head.rotation.y = lerp_angle(head.rotation.y, want, 1.0 - exp(-2.5 * dt))
		head.rotation.x = lerpf(head.rotation.x, 0.45 if near else 0.0, 1.0 - exp(-2.0 * dt))


# --- serpent / kraken ----------------------------------------------------------------

func _make_serpent(r: Dictionary) -> void:
	var n := 4 if r.e.get("variant", "serpent") == "serpent" else 9
	r.parts = []
	for k in n:
		var id := "serpent_hump"
		if r.e.get("variant", "serpent") == "serpent":
			id = "serpent_head" if k == n - 1 else "serpent_hump"
		else:
			id = "tentacle_%d" % k
		var mi := _mi(_mesh(id), true)
		r.nodes.append(mi)
		r.parts.append(mi)
	_tick_serpent(r, 0.0)


## The serpent: three coils and a head, gliding slowly up and down offshore,
## the coils rolling through the water. The kraken: one arm out of the
## water, curling and uncurling. Either way, transforms on a clock.
func _tick_serpent(r: Dictionary, _dt: float) -> void:
	var spot: Node3D = r.spot
	var fwd := -spot.global_basis.z
	var right := spot.global_basis.x
	var sea := float(spot.get_meta("sea_y", 0.0))
	var c := spot.global_position
	c.y = sea
	var parts: Array = r.parts
	if r.e.get("variant", "serpent") == "serpent":
		var glide := sin(time * 0.06) * 18.0
		for k in parts.size():
			var head: bool = k == parts.size() - 1
			var along := glide + (k - 1.5) * 4.2
			var bob := sin(time * 1.1 - k * 0.9)
			var p := c + fwd * along + right * sin(time * 0.3 + k * 0.7) * 1.2
			var basis := Basis.looking_at(fwd, Vector3.UP)
			if head:
				p.y = sea + 1.6 + bob * 0.3
				# The head turns to look at the car.
				var to := car.global_position - p
				to.y = 0.0
				if to.length() > 1.0:
					basis = Basis.looking_at(fwd.lerp(to.normalized(), 0.6).normalized(), Vector3.UP)
			else:
				p.y = sea - 0.9 + bob * 0.55
			(parts[k] as Node3D).global_transform = Transform3D(basis, p)
		return
	# Kraken: a chain of segments, each turned a little more than the last;
	# the curl breathes, so the tip coils in and lashes out.
	var t := time * 0.7
	var p := c
	var dir := Vector3.UP
	var bend_axis := right
	var curl := 0.16 + 0.12 * sin(t)
	for k in parts.size():
		var seg := 1.5 * (1.0 - k * 0.06)
		var basis := Basis.looking_at(dir, fwd if absf(dir.dot(fwd)) < 0.95 else right)
		(parts[k] as Node3D).global_transform = Transform3D(basis, p)
		p += dir * seg
		var a := curl * (0.6 + k * 0.18) + 0.08 * sin(t * 1.7 + k * 0.6)
		dir = dir.rotated(bend_axis, a).rotated(Vector3.UP, 0.05 * sin(t * 0.8 + k)).normalized()


static func _glow_mat(col: Color, energy: float, pulse: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = preload("res://shaders/glow.gdshader")
	m.set_shader_parameter("color", col)
	m.set_shader_parameter("energy", energy)
	m.set_shader_parameter("pulse_period", pulse)
	m.set_shader_parameter("fade", Vector2(70.0, 125.0))
	return m


# --- meshes ----------------------------------------------------------------------
# All front -Z, origin at the feet. Built once per process.

## One of the baked Kenney meshes (tools/bake_assets.gd), loaded the first
## time a live egg needs it.
func _baked(id: String) -> Mesh:
	var key := "baked:" + id
	if not _mesh_cache.has(key):
		_mesh_cache[key] = load(MESH_DIR + id + ".res")
	return _mesh_cache[key]

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



## Three snowballs: body here, the head (carrot, coal, hat) its own mesh so
## it can come off. Origin at the bottom / the head's centre.
func _build_snowman(st: SurfaceTool, id: String) -> void:
	var snow := Color("eef2f5")
	if id == "snowman_body":
		for b in [[0.55, 0.45], [0.4, 1.05]]:
			var sp := SphereMesh.new()
			sp.radius = b[0]
			sp.height = b[0] * 2.0
			sp.radial_segments = 9
			sp.rings = 5
			_prim(st, sp, _at(Vector3(0, b[1], 0)), snow)
		for y in [0.95, 1.15]:
			_box(st, _at(Vector3(0, y, -0.39)), Vector3(0.07, 0.07, 0.05), Color("1d1d1d")) # buttons
		_box(st, _at(Vector3(0, 1.3, 0)), Vector3(0.62, 0.1, 0.62), Color("c0392b")) # scarf
		for s in [-1.0, 1.0]:
			_beam(st, Vector3(s * 0.35, 1.1, 0), Vector3(s * 0.85, 1.45, 0.05), 0.04, Color("5a3d28")) # stick arms
	else:
		var sp := SphereMesh.new()
		sp.radius = 0.27
		sp.height = 0.54
		sp.radial_segments = 8
		sp.rings = 4
		_prim(st, sp, _at(Vector3(0, 0.0, 0)), snow)
		_beam(st, Vector3(0, 0.0, -0.24), Vector3(0, -0.03, -0.5), 0.06, Color("e67e22")) # carrot
		for s in [-1.0, 1.0]:
			_box(st, _at(Vector3(s * 0.09, 0.08, -0.24)), Vector3(0.05, 0.05, 0.04), Color("1d1d1d"))
		_box(st, _at(Vector3(0, 0.27, 0)), Vector3(0.42, 0.04, 0.42), Color("222222"))
		_box(st, _at(Vector3(0, 0.42, 0)), Vector3(0.26, 0.28, 0.26), Color("222222")) # top hat


## A skier in a tuck: skis, poles tucked back, bright suit. Two suits.
func _build_skier(st: SurfaceTool, id: String) -> void:
	var suit := Color("d8322a") if id.ends_with("0") else Color("2a6fd6")
	var ski := Color("f1c40f")
	for x in [-0.14, 0.14]:
		_box(st, _at(Vector3(x, 0.03, -0.1)), Vector3(0.09, 0.03, 1.7), ski)
		_beam(st, Vector3(x, 0.08, 0.0), Vector3(x, 0.5, -0.25), 0.13, Color("2e3440")) # shins
		_beam(st, Vector3(x, 0.5, -0.25), Vector3(x * 0.8, 0.78, 0.18), 0.15, Color("2e3440")) # thighs
	_box(st, Transform3D(Basis(Vector3.RIGHT, -1.0), Vector3(0, 0.95, -0.05)), Vector3(0.42, 0.62, 0.28), suit)
	_box(st, _at(Vector3(0, 1.18, -0.38)), Vector3(0.24, 0.24, 0.26), suit.darkened(0.3)) # helmet
	_box(st, _at(Vector3(0, 1.17, -0.52)), Vector3(0.2, 0.08, 0.02), Color("f39c12")) # goggles
	for s in [-1.0, 1.0]:
		_beam(st, Vector3(s * 0.22, 0.95, -0.25), Vector3(s * 0.25, 0.55, 0.85), 0.03, Color("3a3a3a")) # poles


## An elk: a moose's lighter, rangier cousin, swept-back antlers.
func _build_elk(st: SurfaceTool, id: String) -> void:
	var coat := Color("8a6440")
	var mane := Color("4e3824")
	var legs := Color("5a4632")
	var antler := Color("c9b48a")
	if id == "elk_body":
		_box(st, _at(Vector3(0, 1.45, 0.1)), Vector3(0.75, 0.8, 1.9), coat)
		_box(st, _at(Vector3(0, 1.55, -0.6)), Vector3(0.72, 0.85, 0.6), mane)
		_box(st, _at(Vector3(0, 1.5, 1.0)), Vector3(0.6, 0.5, 0.2), Color("d9c49a")) # rump patch
		_beam(st, Vector3(0, 1.7, -0.8), Vector3(0, 2.0, -1.15), 0.38, mane)
		for x in [-0.25, 0.25]:
			_beam(st, Vector3(x, 1.15, -0.65), Vector3(x, 0.0, -0.68), 0.13, legs)
			_beam(st, Vector3(x, 1.15, 0.8), Vector3(x, 0.0, 0.84), 0.14, legs)
	else:
		_box(st, Transform3D(Basis(Vector3.RIGHT, 0.6), Vector3(0, -0.05, -0.3)), Vector3(0.28, 0.32, 0.66), coat)
		_box(st, _at(Vector3(0, -0.28, -0.56)), Vector3(0.22, 0.1, 0.16), Color("2a1d15"))
		for s in [-1.0, 1.0]:
			_beam(st, Vector3(s * 0.1, 0.15, -0.1), Vector3(s * 0.4, 0.75, 0.25), 0.06, antler)
			_beam(st, Vector3(s * 0.4, 0.75, 0.25), Vector3(s * 0.45, 1.15, 0.65), 0.05, antler)
			for t in 3:
				var a := Vector3(s * (0.22 + t * 0.08), 0.4 + t * 0.25, 0.0 + t * 0.2)
				_beam(st, a, a + Vector3(s * 0.05, 0.3, -0.18), 0.04, antler)


## Snowmobile and rider: red cowling, skis in front, the track behind.
func _build_sled(st: SurfaceTool, _id: String) -> void:
	var red := Color("c0392b")
	var dark := Color("1d1d1d")
	for x in [-0.42, 0.42]:
		_box(st, _at(Vector3(x, 0.08, -0.9)), Vector3(0.14, 0.06, 1.0), dark) # skis
		_beam(st, Vector3(x, 0.1, -0.8), Vector3(x * 0.7, 0.45, -0.7), 0.06, dark)
	_box(st, _at(Vector3(0, 0.28, 0.45)), Vector3(0.6, 0.35, 1.5), dark) # track
	_box(st, Transform3D(Basis(Vector3.RIGHT, 0.35), Vector3(0, 0.62, -0.55)), Vector3(0.9, 0.42, 1.1), red) # cowl
	_box(st, Transform3D(Basis(Vector3.RIGHT, -0.6), Vector3(0, 0.95, -0.75)), Vector3(0.6, 0.3, 0.04), Color("6fa8c8")) # screen
	_box(st, _at(Vector3(0, 0.62, 0.4)), Vector3(0.55, 0.16, 1.0), Color("2e3440")) # seat
	# Rider.
	_box(st, _at(Vector3(0, 1.05, 0.25)), Vector3(0.5, 0.62, 0.32), Color("e8c21c"))
	_box(st, _at(Vector3(0, 1.48, 0.2)), Vector3(0.3, 0.3, 0.32), Color("1d1d1d"))
	for s in [-1.0, 1.0]:
		_beam(st, Vector3(s * 0.25, 1.2, 0.2), Vector3(s * 0.32, 0.95, -0.35), 0.11, Color("e8c21c"))
		_beam(st, Vector3(s * 0.18, 0.7, 0.35), Vector3(s * 0.28, 0.5, -0.05), 0.15, Color("2e3440"))


## Bigfoot's build in a white coat, blue-grey face.
func _build_yeti(st: SurfaceTool, _id: String) -> void:
	var fur := Color("e6ebee")
	var face := Color("7d8fa0")
	for x in [-0.2, 0.2]:
		_beam(st, Vector3(x, 1.1, 0.02), Vector3(x * 1.1, 0.0, 0.05), 0.3, fur)
	_box(st, Transform3D(Basis(Vector3.RIGHT, -0.18), Vector3(0, 1.6, 0)), Vector3(0.95, 1.05, 0.58), fur)
	_box(st, _at(Vector3(0, 2.22, -0.12)), Vector3(0.42, 0.44, 0.42), fur)
	_box(st, _at(Vector3(0, 2.18, -0.32)), Vector3(0.26, 0.22, 0.04), face)
	for x in [-0.56, 0.56]:
		_beam(st, Vector3(x, 1.95, -0.05), Vector3(x * 1.15, 0.85, -0.2), 0.24, fur)


## A ball of tangled twigs: a few dozen thin sticks round a sphere, two
## variants. Origin at the centre (it rolls about it).
func _build_weed(st: SurfaceTool, id: String) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 41 if id.ends_with("0") else 97
	var cols := [Color("a7864f"), Color("8c6b3d"), Color("bf9d63")]
	for k in 34:
		var a := Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)).normalized() * rng.randf_range(0.35, 0.6)
		var b := Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)).normalized() * rng.randf_range(0.35, 0.6)
		_beam(st, a, b, 0.045, cols[k % 3])


## Roadrunner: long tail, crest, legs in two strides (a and b).
func _build_runner(st: SurfaceTool, id: String) -> void:
	var body := Color("6e5a42")
	var light := Color("cbb994")
	var dark := Color("2f2620")
	_box(st, Transform3D(Basis(Vector3.RIGHT, 0.25), Vector3(0, 0.42, 0)), Vector3(0.16, 0.16, 0.4), body)
	_box(st, _at(Vector3(0, 0.36, 0.0)), Vector3(0.13, 0.08, 0.3), light)
	_beam(st, Vector3(0, 0.48, -0.16), Vector3(0, 0.62, -0.26), 0.08, body) # neck
	_box(st, _at(Vector3(0, 0.66, -0.29)), Vector3(0.1, 0.1, 0.14), body)
	_box(st, _at(Vector3(0, 0.65, -0.42)), Vector3(0.04, 0.04, 0.14), dark) # beak
	_box(st, Transform3D(Basis(Vector3.RIGHT, -0.5), Vector3(0, 0.74, -0.26)), Vector3(0.04, 0.12, 0.08), dark) # crest
	_box(st, Transform3D(Basis(Vector3.RIGHT, -0.35), Vector3(0, 0.55, 0.42)), Vector3(0.07, 0.04, 0.42), dark) # tail, up
	var stride := 0.2 if id == "runner_a" else -0.2
	for s: float in [-1.0, 1.0]:
		var swing := stride * s
		_beam(st, Vector3(s * 0.04, 0.36, 0.02), Vector3(s * 0.05, 0.0, swing), 0.03, Color("8a7a52"))


## A soaring vulture: a broad, slightly bowed wing, fingered tips, a pale neck.
func _build_vulture(st: SurfaceTool, _id: String) -> void:
	var c := Color("231e1c")
	_box(st, _at(Vector3(0, 0, 0)), Vector3(0.22, 0.14, 0.62), c)
	_box(st, _at(Vector3(0, 0.02, -0.38)), Vector3(0.09, 0.08, 0.16), Color("b65a4a")) # bare red head
	for s in [-1.0, 1.0]:
		_box(st, Transform3D(Basis(Vector3.FORWARD, s * 0.08), Vector3(s * 0.55, 0.03, 0.0)), Vector3(0.95, 0.03, 0.34), c)
		_box(st, Transform3D(Basis(Vector3.FORWARD, s * 0.2), Vector3(s * 1.15, 0.08, 0.03)), Vector3(0.35, 0.025, 0.26), c.lightened(0.08))
	_box(st, _at(Vector3(0, 0, 0.42)), Vector3(0.26, 0.03, 0.2), c) # tail


## Cow skull: a bleached box of a head, eye holes, and the horns.
func _build_skull(st: SurfaceTool, _id: String) -> void:
	var bone := Color("ece2cc")
	var hole := Color("2a2420")
	_box(st, _at(Vector3(0, 0, 0)), Vector3(0.34, 0.26, 0.16), bone)
	_box(st, _at(Vector3(0, -0.22, 0.02)), Vector3(0.2, 0.26, 0.12), bone) # muzzle
	for s in [-1.0, 1.0]:
		_box(st, _at(Vector3(s * 0.09, 0.02, 0.08)), Vector3(0.08, 0.07, 0.02), hole)
		_beam(st, Vector3(s * 0.16, 0.08, 0), Vector3(s * 0.42, 0.14, 0), 0.06, bone)
		_beam(st, Vector3(s * 0.42, 0.14, 0), Vector3(s * 0.5, 0.32, -0.02), 0.045, Color("d8cdb2"))


## The flying saucer: a wide disc, a rim band, a glass dome. Origin at its centre.
func _build_saucer(st: SurfaceTool, _id: String) -> void:
	var hull := Color("aab3ba")
	var rim := Color("6b737a")
	var disc := CylinderMesh.new()
	disc.top_radius = 2.6
	disc.bottom_radius = 4.4
	disc.height = 0.8
	disc.radial_segments = 16
	disc.rings = 1
	_prim(st, disc, _at(Vector3(0, 0.4, 0)), hull)
	var under := CylinderMesh.new()
	under.top_radius = 4.4
	under.bottom_radius = 2.0
	under.height = 0.6
	under.radial_segments = 16
	under.rings = 1
	_prim(st, under, _at(Vector3(0, -0.3, 0)), rim)
	var dome := SphereMesh.new()
	dome.radius = 1.6
	dome.height = 2.0
	dome.radial_segments = 12
	dome.rings = 5
	dome.is_hemisphere = true
	_prim(st, dome, _at(Vector3(0, 0.75, 0)), Color("4fbfa8"))


static func _prim(st: SurfaceTool, prim: PrimitiveMesh, xf: Transform3D, col: Color) -> void:
	var a := prim.get_mesh_arrays()
	var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
	var nm: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
	var nb := xf.basis.inverse().transposed()
	for i in a[Mesh.ARRAY_INDEX]:
		st.set_color(col)
		st.set_normal((nb * nm[i]).normalized())
		st.add_vertex(xf * v[i])


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


func _build_gull(st: SurfaceTool, id: String) -> void:
	var white := Color("eef0ee")
	var grey := Color("9aa3a8")
	var tip := Color("2a2a2c")
	var beak := Color("e8b43a")
	if id == "gull_sit":
		_box(st, _at(Vector3(0, 0.17, 0.02)), Vector3(0.17, 0.17, 0.4), white)
		_box(st, _at(Vector3(0, 0.29, -0.15)), Vector3(0.12, 0.12, 0.13), white)
		_box(st, _at(Vector3(0, 0.28, -0.25)), Vector3(0.04, 0.035, 0.08), beak)
		for x in [-0.095, 0.095]:
			_box(st, _at(Vector3(x, 0.2, 0.06)), Vector3(0.03, 0.11, 0.36), grey) # folded wings
		_box(st, _at(Vector3(0, 0.2, 0.26)), Vector3(0.12, 0.04, 0.12), tip)
		for x in [-0.04, 0.04]:
			_box(st, _at(Vector3(x, 0.04, 0.0)), Vector3(0.02, 0.08, 0.02), beak)
		return
	# Flying: a body and two long wings in a shallow V, both windings.
	_box(st, _at(Vector3(0, 0, 0)), Vector3(0.15, 0.13, 0.42), white)
	_box(st, _at(Vector3(0, 0.04, -0.25)), Vector3(0.1, 0.1, 0.11), white)
	_box(st, _at(Vector3(0, 0.03, -0.33)), Vector3(0.035, 0.03, 0.07), beak)
	for sx in [-1.0, 1.0]:
		var root := Vector3(sx * 0.06, 0.02, -0.06)
		var elbow := Vector3(sx * 0.42, 0.14, -0.02)
		var tipp := Vector3(sx * 0.78, 0.2, 0.08)
		for tri in [[root, elbow, root + Vector3(0, 0, 0.18)], [elbow, tipp, elbow + Vector3(0, 0, 0.14)]]:
			var col := grey if tri[0] == root else tip
			for order in [[0, 1, 2], [0, 2, 1]]:
				var a: Vector3 = tri[order[0]]
				var b: Vector3 = tri[order[1]]
				var c: Vector3 = tri[order[2]]
				var nrm := (c - a).cross(b - a).normalized()
				for v in [a, b, c]:
					st.set_color(col)
					st.set_normal(nrm)
					st.add_vertex(v)


## A humpback-ish whale, 12 m: a long tapering body (front -Z), a white
## throat, long white flippers and the flukes. Origin mid-body.
func _build_whale(st: SurfaceTool, _id: String) -> void:
	var back := Color("2f3a44")
	var belly := Color("c9cfd2")
	_box(st, _at(Vector3(0, 0, -2.2)), Vector3(2.6, 2.4, 5.0), back)
	_box(st, _at(Vector3(0, -0.1, 1.6)), Vector3(2.1, 2.0, 3.2), back)
	_box(st, _at(Vector3(0, -0.15, 4.1)), Vector3(1.2, 1.2, 2.2), back)
	_box(st, _at(Vector3(0, -0.2, 5.7)), Vector3(0.6, 0.6, 1.4), back)
	_box(st, Transform3D(Basis(Vector3.RIGHT, 0.12), Vector3(0, 0.1, -5.2)), Vector3(2.0, 1.6, 1.6), back) # head
	_box(st, _at(Vector3(0, -1.1, -3.2)), Vector3(2.0, 0.4, 4.2), belly) # throat
	_box(st, _at(Vector3(0, 1.22, 2.6)), Vector3(0.18, 0.4, 0.9), back) # the little dorsal
	for sx in [-1.0, 1.0]:
		_box(st, Transform3D(Basis(Vector3.FORWARD, sx * 0.5) * Basis(Vector3.UP, sx * 0.5), Vector3(sx * 2.4, -0.7, -2.6)), Vector3(3.6, 0.18, 0.9), belly)
		_box(st, Transform3D(Basis(Vector3.UP, sx * 0.35), Vector3(sx * 1.25, -0.2, 6.6)), Vector3(2.4, 0.16, 1.0), back) # flukes


## White water: a ring of tilted slabs and a column, unit size (scaled).
func _build_splash(st: SurfaceTool, _id: String) -> void:
	var foam := Color("eef3f3")
	for k in 8:
		var a := TAU * k / 8.0
		var o := Vector3(cos(a), 0, sin(a))
		_box(st, Transform3D(Basis(Vector3.UP, -a) * Basis(Vector3.FORWARD, 0.35), o * 2.2 + Vector3(0, 0.9, 0)), Vector3(0.5, 2.0, 1.6), foam)
	_box(st, _at(Vector3(0, 1.6, 0)), Vector3(1.8, 3.2, 1.8), foam)


## An inshore fishing boat, about 9 m: a red hull with a white rubbing
## strake, a wheelhouse aft of midships, a mast and a boom for the nets.
func _build_boat(st: SurfaceTool, _id: String) -> void:
	var hull := Color("a8322c")
	var white := Color("ece9e2")
	var dark := Color("2b2f33")
	var wood := Color("8a6a46")
	_box(st, _at(Vector3(0, 0.1, 0.5)), Vector3(2.8, 1.1, 6.0), hull)
	_box(st, Transform3D(Basis(Vector3.UP, 0.0), Vector3(0, 0.25, -3.2)), Vector3(2.2, 1.3, 1.6), hull)
	_box(st, _at(Vector3(0, 0.45, -4.25)), Vector3(1.0, 1.1, 0.8), hull) # bow
	_box(st, _at(Vector3(0, 0.62, 0.0)), Vector3(2.9, 0.14, 8.0), white) # strake
	_box(st, _at(Vector3(0, -0.5, 0.0)), Vector3(2.4, 0.3, 7.4), dark) # boot top
	_box(st, _at(Vector3(0, 0.72, 0.4)), Vector3(2.5, 0.08, 6.8), wood) # deck
	_box(st, _at(Vector3(0, 1.55, 1.2)), Vector3(1.7, 1.6, 1.8), white) # wheelhouse
	_box(st, _at(Vector3(0, 2.4, 1.2)), Vector3(1.9, 0.12, 2.0), dark)
	_box(st, _at(Vector3(0, 1.75, 0.3)), Vector3(1.5, 0.5, 0.04), Color("2e4a5e")) # windows
	_beam(st, Vector3(0, 0.7, -1.6), Vector3(0, 5.2, -1.6), 0.14, white) # mast
	_beam(st, Vector3(0, 3.6, -1.6), Vector3(0, 1.4, 3.6), 0.1, white) # boom
	_box(st, _at(Vector3(0, 1.0, 3.2)), Vector3(1.6, 0.5, 0.9), Color("e07b2a")) # buoys and nets in a heap


## A harbour seal lying on the rocks, front -Z, ~1.6 m. Head separate.
func _build_seal(st: SurfaceTool, id: String) -> void:
	var coat := Color("7c7a74")
	var dark := Color("55534e")
	if id == "seal_head":
		_box(st, _at(Vector3(0, 0.08, -0.12)), Vector3(0.36, 0.32, 0.38), coat)
		_box(st, _at(Vector3(0, 0.02, -0.33)), Vector3(0.22, 0.16, 0.12), dark)
		for x in [-0.1, 0.1]:
			_box(st, _at(Vector3(x, 0.15, -0.31)), Vector3(0.05, 0.05, 0.03), Color("151515"))
		return
	_box(st, _at(Vector3(0, 0.24, -0.25)), Vector3(0.62, 0.48, 0.9), coat)
	_box(st, _at(Vector3(0, 0.2, 0.45)), Vector3(0.5, 0.38, 0.7), coat)
	_box(st, _at(Vector3(0, 0.12, 0.95)), Vector3(0.3, 0.2, 0.45), dark)
	_box(st, Transform3D(Basis(Vector3.UP, 0.4), Vector3(0, 0.08, 1.22)), Vector3(0.5, 0.06, 0.22), dark) # tail flippers
	for sx in [-1.0, 1.0]:
		_box(st, Transform3D(Basis(Vector3.UP, sx * 0.5), Vector3(sx * 0.36, 0.06, -0.3)), Vector3(0.12, 0.05, 0.34), dark)
	_box(st, _at(Vector3(0, 0.49, -0.1)), Vector3(0.4, 0.04, 0.5), dark) # mottled back


## Sea serpent: a coil (an arch out of the water) and the head on its neck.
func _build_serpent(st: SurfaceTool, id: String) -> void:
	var skin := Color("2f5a4a")
	var belly := Color("a9b48a")
	var fin := Color("b0452c")
	if id == "serpent_head":
		_beam(st, Vector3(0, -2.2, 1.2), Vector3(0, 0.2, 0.0), 0.75, skin) # neck out of the water
		_box(st, Transform3D(Basis(Vector3.RIGHT, -0.15), Vector3(0, 0.4, -0.6)), Vector3(0.9, 0.7, 1.6), skin)
		_box(st, _at(Vector3(0, 0.18, -0.95)), Vector3(0.7, 0.22, 1.0), belly) # jaw
		for x in [-0.32, 0.32]:
			_box(st, _at(Vector3(x, 0.66, -0.9)), Vector3(0.12, 0.12, 0.12), Color("e8d24a"))
		_box(st, Transform3D(Basis(Vector3.RIGHT, 0.5), Vector3(0, 0.95, -0.1)), Vector3(0.08, 0.6, 1.0), fin)
		return
	# A coil: five beams bent in an arch, ~4 m long, 2 m tall, fin on top.
	var pts := []
	for k in 6:
		var a := PI * k / 5.0
		pts.append(Vector3(0, sin(a) * 2.0, -cos(a) * 2.1))
	for k in 5:
		_beam(st, pts[k], pts[k + 1], 0.75 - absf(k - 2.0) * 0.04, skin)
	for k in range(1, 4):
		_box(st, Transform3D(Basis.IDENTITY, (pts[k] + pts[k + 1]) * 0.5 + Vector3(0, 0.55, 0)), Vector3(0.08, 0.5, 0.5), fin)


## Kraken: one arm segment per id (tentacle_0 the thickest), from the
## origin down -Z (the tick points -Z along the arm), suckers on +Y.
func _build_tentacle(st: SurfaceTool, id: String) -> void:
	var k := int(id.get_slice("_", 1))
	var w := 0.95 * (1.0 - k * 0.085)
	var len := 1.5 * (1.0 - k * 0.06) + 0.12
	var skin := Color("7a2f3c")
	var sucker := Color("e3b8a8")
	_box(st, _at(Vector3(0, 0, -len * 0.5)), Vector3(w, w, len), skin)
	# Suckers down the inside of the curl (+Y side of each segment).
	_box(st, _at(Vector3(0, w * 0.5 + 0.02, -len * 0.3)), Vector3(w * 0.35, 0.06, w * 0.35), sucker)
	_box(st, _at(Vector3(0, w * 0.5 + 0.02, -len * 0.75)), Vector3(w * 0.3, 0.06, w * 0.3), sucker)
