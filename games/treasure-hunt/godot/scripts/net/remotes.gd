class_name Remotes
extends Node3D
## The other players: a team-tinted capsule with a name tag each (spec §7.5;
## the character pack is M5). The view sends the roster on every update and
## each pos relay as it lands; both are idempotent, so a repeat changes
## nothing and a capsule is only built once.
##
## A capsule shows up on its player's first snapshot, eases from where it
## was drawn to the latest one over LERP_S, and goes when a roster drops
## its player or after STALE_S with no snapshot. In a vehicle (v set) it
## hides: the buggy draws them. No physics anywhere: players pass through
## each other (§13.3).

## Mirrors NAME_RANGE in shared/world.ts.
const NAME_RANGE := 50.0
## One snapshot gap at POS_HZ.
const LERP_S := 0.1
const STALE_S := 5.0
const RADIUS := 0.35
const HEIGHT := 1.8
## The streamed y is the walker's origin, which is its feet.
const CENTRE_Y := HEIGHT * 0.5
const TAG_UP := 1.2

## Off in tests, which drive tick() with their own clock.
var auto_tick := true

var _me := ""
## id -> {name, color: Color, team: int}
var _roster: Dictionary = {}
## id -> Remote
var _remotes: Dictionary = {}


class Remote:
	var body: Node3D
	var capsule: MeshInstance3D
	var label: Label3D
	var from_pos: Vector3
	var from_yaw: float
	var to_pos: Vector3
	var to_yaw: float
	var t0: float ## when the latest snapshot came
	var in_vehicle: bool

	func pose_at(now_s: float) -> Array:
		var a := clampf((now_s - t0) / LERP_S, 0.0, 1.0)
		return [from_pos.lerp(to_pos, a), lerp_angle(from_yaw, to_yaw, a)]


## Seconds, on the clock upsert and tick use when nobody passes one.
static func now() -> float:
	return Time.get_ticks_usec() / 1e6


func _process(_dt: float) -> void:
	if auto_tick:
		tick(now())


## Everyone to draw, `me` included (skipped). [{id, name, color: "#rrggbb", team}]
## Anyone not in it goes now; anyone still in it keeps their capsule, with
## its colour and name brought up to date.
func set_roster(list: Array, me: String) -> void:
	_me = me
	var next := {}
	for p in list:
		if not (p is Dictionary and p.get("id") is String and p.get("color") is String and Color.html_is_valid(p.color)):
			continue
		next[p.id] = {"name": String(p.get("name", "")) if p.get("name") is String else "", "color": Color.html(p.color), "team": int(p.team) if (p.get("team") is float or p.get("team") is int) else 0}
	_roster = next
	for id in _remotes.keys():
		if id == _me or not _roster.has(id):
			_remove(id)
			continue
		var r: Remote = _remotes[id]
		var want: Dictionary = _roster[id]
		var mat := r.capsule.material_override as StandardMaterial3D
		if not mat.albedo_color.is_equal_approx(want.color):
			mat.albedo_color = want.color
		if r.label.text != want.name:
			r.label.text = want.name


## {x, y, z, yaw, foot, v} for `id`, heard at `now_s`. Ignored for us and
## for anyone the roster doesn't have.
func upsert(id: String, snap: Dictionary, now_s: float) -> void:
	if id == _me or not _roster.has(id):
		return
	var at := Vector3(float(snap.get("x", 0.0)), float(snap.get("y", 0.0)), float(snap.get("z", 0.0)))
	var yaw := float(snap.get("yaw", 0.0)) if (snap.get("yaw") is float or snap.get("yaw") is int) else 0.0
	var r: Remote = _remotes.get(id)
	if r == null:
		r = _build(id)
		r.from_pos = at
		r.from_yaw = yaw
		r.body.position = at
		r.body.rotation.y = yaw
	else:
		# From wherever it's drawn now, so a late snapshot doesn't make it jump back.
		var pose := r.pose_at(now_s)
		r.from_pos = pose[0]
		r.from_yaw = pose[1]
	r.to_pos = at
	r.to_yaw = yaw
	r.t0 = now_s
	r.in_vehicle = snap.get("v") != null
	r.body.visible = not r.in_vehicle


## Moves everyone to where they are at `now_s`, and drops the stale.
func tick(now_s: float) -> void:
	for id in _remotes.keys():
		var r: Remote = _remotes[id]
		if now_s - r.t0 > STALE_S:
			_remove(id)
			continue
		var pose := r.pose_at(now_s)
		r.body.position = pose[0]
		r.body.rotation.y = pose[1]
		r.body.visible = not r.in_vehicle


func count() -> int:
	return _remotes.size()


func body(id: String) -> Node3D:
	var r: Remote = _remotes.get(id)
	return r.body if r else null


func capsule(id: String) -> MeshInstance3D:
	var r: Remote = _remotes.get(id)
	return r.capsule if r else null


func label(id: String) -> Label3D:
	var r: Remote = _remotes.get(id)
	return r.label if r else null


func _build(id: String) -> Remote:
	var want: Dictionary = _roster[id]
	var r := Remote.new()
	r.body = Node3D.new()
	r.body.name = "Remote_" + id.validate_node_name()
	var cm := CapsuleMesh.new()
	cm.radius = RADIUS
	cm.height = HEIGHT
	var mat := StandardMaterial3D.new()
	mat.albedo_color = want.color
	r.capsule = MeshInstance3D.new()
	r.capsule.mesh = cm
	r.capsule.material_override = mat
	r.capsule.position.y = CENTRE_Y
	r.body.add_child(r.capsule)
	r.label = Label3D.new()
	r.label.text = want.name
	r.label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	r.label.visibility_range_end = NAME_RANGE
	r.label.font_size = 48
	r.label.outline_size = 12
	r.label.position.y = CENTRE_Y + TAG_UP
	r.body.add_child(r.label)
	add_child(r.body)
	_remotes[id] = r
	return r


func _remove(id: String) -> void:
	var r: Remote = _remotes.get(id)
	_remotes.erase(id)
	if r:
		remove_child(r.body)
		r.body.queue_free()
