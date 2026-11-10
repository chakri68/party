class_name Fleet
extends Node3D
## Every buggy on the map, keyed by vehicle id (spec §7.2). The server's list
## is the truth: the view sends it whole on every update (`vehicles`), and
## apply() makes the buggies match it. Who drives sets each one's mode:
##   me            local: M2's physics and keys
##   someone else  puppet: no collider, posed from that driver's stream
##   nobody        parked: a collider, frozen at the list's pose
##
## Until the first list there is one buggy, id "", local, where main parks
## it (buggy_spawn). That's M2 standalone play, and every test before M3.
## Lists only come over a connected bridge, so `seen` also means "online":
## the avatar asks for seats instead of getting straight in.

## After every apply(), with the buggies already in their new modes and the
## gone ones still there: the avatar gets in, or out, here.
signal applied

const SCENE := preload("res://scenes/buggy.tscn")
## One snapshot gap at POS_HZ, as Remotes.
const LERP_S := 0.1
## Wheel corners in buggy space, for a puppet's pitch and roll.
const WHEEL_X := 1.0
const WHEEL_Z := 1.6

var field: TerrainField
## main.seaward bound to the drive depth; every buggy gets it.
var seaward := Callable()
var locked := false
## A vehicles list has come.
var seen := false
var me := ""
## The sky's darkness, from main (dark_changed). Headlights follow it.
var dark := 0.0

## id -> Buggy
var _buggies: Dictionary = {}
## id -> the vehicle dict from the latest list
var _list: Dictionary = {}
## id -> {from: Transform3D, to: Vector3, yaw, t0}, a puppet's latest snapshot
var _snaps: Dictionary = {}
## Physics seconds: puppets ease on the physics clock, so a fixed-fps run
## (the tests) and the camera's interpolation both see it move smoothly.
var _clock := 0.0
## Ids apply() removes once the avatar has heard the new list.
var _drop_later: Array[String] = []


func _ready() -> void:
	if _buggies.is_empty() and not seen:
		_add("")


## Headlights on for every buggy with a driver, once it is dark enough.
func set_dark(d: float) -> void:
	dark = d
	_refresh_lights()


func _refresh_lights() -> void:
	for id in _buggies:
		var b: Buggy = _buggies[id]
		var on := dark >= DayClock.LAMP_ON and (b.driver != null or vehicle(id).get("driver") != null)
		if on != b.lights_on:
			b.set_lights(on)


func _physics_process(dt: float) -> void:
	_clock += dt
	# A local driver gets in and out without a list, so look every tick.
	_refresh_lights()
	if field == null:
		return
	for id in _snaps:
		var b: Buggy = _buggies.get(id)
		if b != null and b.mode == &"puppet":
			_pose_puppet(b, _snaps[id])


func count() -> int:
	return _buggies.size()


func get_buggy(id: String) -> Buggy:
	return _buggies.get(id)


func all() -> Array[Buggy]:
	var out: Array[Buggy] = []
	for b in _buggies.values():
		out.append(b)
	return out


## The list's entry for `id`, or {} (always {} for the standalone buggy).
func vehicle(id: String) -> Dictionary:
	return _list.get(id, {})


## The buggies whose physics are ours: the fall check and the reset only
## touch these.
func local_buggies() -> Array[Buggy]:
	var out: Array[Buggy] = []
	for b in _buggies.values():
		if (b as Buggy).mode == &"local":
			out.append(b)
	return out


func set_locked(on: bool) -> void:
	locked = on
	for b in _buggies.values():
		(b as Buggy).locked = on


## New ground (or none, between worlds). With none, everything is hidden
## and still; with some, listed buggies go back on their poses and show.
## main places the standalone buggy itself.
func set_field(f: TerrainField) -> void:
	field = f
	for id in _buggies:
		var b: Buggy = _buggies[id]
		if f == null:
			b.process_mode = Node.PROCESS_MODE_DISABLED
			b.visible = false
			continue
		b.process_mode = Node.PROCESS_MODE_INHERIT
		b.visible = true
		if _list.has(id):
			_place_listed(b, _list[id])


## The server's full list, and who we are. Idempotent: an unchanged entry
## leaves its buggy alone.
func apply(list: Array, my_id: String) -> void:
	me = my_id
	var next := {}
	for v in list:
		var c := _clean(v)
		if not c.is_empty():
			next[c.id] = c
	if not seen:
		seen = true
		_drop_later.append("")
	for id in next:
		var v: Dictionary = next[id]
		var b: Buggy = _buggies.get(id)
		if b == null:
			b = _add(id)
			_set_mode(b, v)
			_place_listed(b, v)
		elif _list.get(id, {}) != v:
			var was := b.mode
			_set_mode(b, v)
			# A local buggy is where its physics put it; anything else is
			# where the list (or its driver's stream) says.
			if b.mode == &"parked" or (b.mode == &"puppet" and was != &"puppet"):
				_place_listed(b, v)
	for id in _buggies:
		if not next.has(id) and id != "":
			_drop_later.append(id)
	_list = next
	_refresh_lights()
	applied.emit()
	for id in _drop_later:
		_remove(id)
	_drop_later.clear()


## A remote snapshot with v == `id`, from player `who`. Only the vehicle's
## driver in the latest list moves it: a passenger streams the seat, which
## isn't where the buggy is.
func puppet_pose(id: String, snap: Dictionary, who: String) -> void:
	var b: Buggy = _buggies.get(id)
	if b == null or b.mode != &"puppet" or vehicle(id).get("driver") != who:
		return
	_snaps[id] = {
		"from": b.global_transform,
		"to": Vector3(float(snap.get("x", 0.0)), float(snap.get("y", 0.0)), float(snap.get("z", 0.0))),
		"yaw": float(snap.get("yaw", 0.0)),
		"from_yaw": yaw_of(b),
		"t0": _clock,
	}


## A body's heading as a yaw: from its forward vector, not global_rotation.y,
## which a pitched and rolled body's Euler split bends.
static func yaw_of(n: Node3D) -> float:
	var f := Buggy.flat_forward(n.global_basis)
	return atan2(-f.x, -f.z)


## The highest ground under the buggy's box at (x, z) facing `yaw`, so
## neither end starts buried on a slope (as main.buggy_spawn).
static func highest_corner(f: TerrainField, x: float, z: float, yaw: float) -> float:
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(-fwd.z, 0, fwd.x)
	var at := Vector3(x, 0, z)
	var hi := -INF
	for sx in [-0.5, 0.5]:
		for sz in [-0.5, 0.5]:
			var c: Vector3 = at + right * sx * Buggy.BOX.x + fwd * sz * Buggy.BOX.z
			hi = maxf(hi, f.height_at(c.x, c.z))
	return hi


## The ground's lean at (x, z) facing `yaw`: the plane through the heights
## at the four wheels, turned to that heading.
static func ground_basis(f: TerrainField, x: float, z: float, yaw: float) -> Basis:
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(-fwd.z, 0, fwd.x)
	var c: Array[Vector3] = []
	for s in [[-WHEEL_X, -WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, WHEEL_Z], [WHEEL_X, WHEEL_Z]]:
		var q: Vector3 = Vector3(x, 0, z) + right * s[0] - fwd * s[1]
		c.append(Vector3(q.x, f.height_at(q.x, q.z), q.z))
	var n := (c[3] - c[0]).cross(c[1] - c[2]).normalized()
	if n.y < 0:
		n = -n
	if n.y < 0.05:
		n = Vector3.UP
	return Buggy._lean(n, fwd)


func _add(id: String) -> Buggy:
	var b: Buggy = SCENE.instantiate()
	b.id = id
	b.name = "Buggy" if id == "" else "Buggy_" + id.validate_node_name()
	b.seaward = seaward
	b.locked = locked
	add_child(b)
	if field == null:
		b.process_mode = Node.PROCESS_MODE_DISABLED
		b.visible = false
	_buggies[id] = b
	return b


func _remove(id: String) -> void:
	var b: Buggy = _buggies.get(id)
	_buggies.erase(id)
	_snaps.erase(id)
	if b:
		remove_child(b)
		b.queue_free()


func _set_mode(b: Buggy, v: Dictionary) -> void:
	var d: Variant = v.driver
	b.set_mode(&"local" if d == me else (&"parked" if d == null else &"puppet"))
	if b.mode != &"puppet":
		_snaps.erase(b.id)


## A parked (or not yet streamed) buggy at the list's pose. No y yet: on
## the highest corner, upright. A y: where its driver left it, leaning
## with the ground.
func _place_listed(b: Buggy, v: Dictionary) -> void:
	if field == null:
		return
	var yaw: float = v.yaw
	var basis := Basis(Vector3.UP, yaw)
	var y: float
	if v.y == null:
		y = highest_corner(field, v.x, v.z, yaw) + 0.05
	else:
		y = v.y
		basis = ground_basis(field, v.x, v.z, yaw)
	b.global_transform = Transform3D(basis, Vector3(v.x, y, v.z))
	b.velocity = Vector3.ZERO
	b.reset_physics_interpolation()


func _pose_puppet(b: Buggy, s: Dictionary) -> void:
	var a := clampf((_clock - float(s.t0)) / LERP_S, 0.0, 1.0)
	var from: Transform3D = s.from
	var at: Vector3 = from.origin.lerp(s.to, a)
	var yaw := lerp_angle(float(s.from_yaw), float(s.yaw), a)
	b.global_transform = Transform3D(ground_basis(field, at.x, at.z, yaw), at)


## A list entry, checked: {id, x, y (float or null), z, yaw, driver, passenger}, or {}.
static func _clean(v: Variant) -> Dictionary:
	if not (v is Dictionary and v.get("id") is String and v.id != ""):
		return {}
	for k in ["x", "z", "yaw"]:
		if not (v.get(k) is float or v.get(k) is int):
			return {}
	var y: Variant = v.get("y")
	if not (y == null or y is float or y is int):
		return {}
	var d: Variant = v.get("driver")
	var p: Variant = v.get("passenger")
	return {
		"id": v.id, "x": float(v.x), "y": null if y == null else float(y), "z": float(v.z), "yaw": float(v.yaw),
		"driver": d if d is String else null, "passenger": p if p is String else null,
	}
