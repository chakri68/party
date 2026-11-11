class_name Remotes
extends Node3D
## The other players: a team-tinted Kenney Mini Character with a name tag
## each (spec §7.5). The view sends the roster on every update and
## each pos relay as it lands; both are idempotent, so a repeat changes
## nothing and a model is only built once.
##
## A model shows up on its player's first snapshot, eases from where it
## was drawn to the latest one over LERP_S, and goes when a roster drops
## its player or after STALE_S with no snapshot. In a vehicle (v set) it
## still shows: the server relays a seated player's pos as their seat, and
## the buggy draws nobody. No physics anywhere: players pass through each
## other (§13.3).

## Mirrors NAME_RANGE in shared/world.ts.
const NAME_RANGE := 50.0
## One snapshot gap at POS_HZ.
const LERP_S := 0.1
const STALE_S := 5.0
## The streamed y is the walker's origin, which is its feet; the model
## stands on it and the tag floats this far over its head.
const TAG_UP := CharacterModel.HEIGHT + 0.4
## Past this many metres from the viewer a model stops animating.
const ANIMATE_RANGE := 150.0
## No snapshot for this long and a remote has stopped.
const STILL_AFTER_S := 0.35

## Off in tests, which drive tick() with their own clock.
var auto_tick := true

## Where the viewer is, for the animate range: returns a Vector3. Unset, everyone animates.
var viewer := Callable()
## Where the seated sit: a seated remote rides its buggy from here. main sets it.
var fleet: Fleet

var _me := ""
## id -> {name, color: Color, team: int}
var _roster: Dictionary = {}
## id -> Remote
var _remotes: Dictionary = {}
## player id -> {v: vehicle id, seat: &"driver" or &"passenger"}, from the vehicles list.
var _seats: Dictionary = {}


class Remote:
	var body: Node3D
	var model: CharacterModel
	var label: Label3D
	var from_pos: Vector3
	var from_yaw: float
	var to_pos: Vector3
	var to_yaw: float
	var t0: float ## when the latest snapshot came
	var speed := 0.0 ## m/s on the ground between the last two snapshots
	var v: Variant = null ## the vehicle id the latest snapshot says, or null

	func pose_at(now_s: float) -> Array:
		var a := clampf((now_s - t0) / LERP_S, 0.0, 1.0)
		return [from_pos.lerp(to_pos, a), lerp_angle(from_yaw, to_yaw, a)]


## Seconds, on the clock upsert and tick use when nobody passes one.
static func now() -> float:
	return Time.get_ticks_usec() / 1e6


func _process(_dt: float) -> void:
	if auto_tick:
		tick(now())


## Everyone to draw, `me` included (skipped). [{id, name, color: "#rrggbb", team, character}]
## Anyone not in it goes now; anyone still in it keeps their model, with
## its colour, character and name brought up to date. An unknown character
## is the model's fallback.
func set_roster(list: Array, me: String) -> void:
	_me = me
	var next := {}
	for p in list:
		if not (p is Dictionary and p.get("id") is String and p.get("color") is String and Color.html_is_valid(p.color)):
			continue
		var ch: String = p.character if p.get("character") is String and CharacterModel.IDS.has(p.character) else CharacterModel.IDS[0]
		next[p.id] = {"character": ch, "name": String(p.get("name", "")) if p.get("name") is String else "", "color": Color.html(p.color), "team": int(p.team) if (p.get("team") is float or p.get("team") is int) else 0}
	_roster = next
	for id in _remotes.keys():
		if id == _me or not _roster.has(id):
			_remove(id)
			continue
		var r: Remote = _remotes[id]
		var want: Dictionary = _roster[id]
		if r.model.id != want.character:
			r.model.setup(want.character, want.color)
		else:
			r.model.set_color(want.color)
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
		r.speed = 0.0
		r.body.position = at
		r.body.rotation.y = yaw
	else:
		# From wherever it's drawn now, so a late snapshot doesn't make it jump back.
		var pose := r.pose_at(now_s)
		r.from_pos = pose[0]
		r.from_yaw = pose[1]
		r.speed = Vector2(at.x - r.to_pos.x, at.z - r.to_pos.z).length() / maxf(now_s - r.t0, 0.01)
	r.to_pos = at
	r.to_yaw = yaw
	r.v = snap.get("v") if snap.get("v") is String else null
	r.t0 = now_s


## The vehicles list [{id, driver, passenger, ...}]: who sits where. A remote
## sits only when this names them in the vehicle their snapshot says (v), and
## the fleet has that buggy. Anyone else keeps the relayed pos.
func set_seats(list: Array) -> void:
	_seats = {}
	for e in list:
		if not (e is Dictionary and e.get("id") is String):
			continue
		for seat in [&"driver", &"passenger"]:
			var who: Variant = e.get(String(seat))
			if who is String:
				_seats[who] = {"v": e.id, "seat": seat}


## Moves everyone to where they are at `now_s`, and drops the stale.
func tick(now_s: float) -> void:
	for id in _remotes.keys():
		var r: Remote = _remotes[id]
		if now_s - r.t0 > STALE_S:
			_remove(id)
			continue
		var seat := &""
		var b: Buggy = null
		var s: Dictionary = _seats.get(id, {})
		if fleet != null and r.v is String and s.get("v") == r.v:
			b = fleet.get_buggy(r.v)
			if b != null:
				seat = s.seat
		if b != null:
			# Rides the buggy as it is now, not as the last snapshot had it.
			var basis := b.global_basis.orthonormalized()
			r.body.global_transform = Transform3D(basis, b.global_transform * (PlayerAvatar.SEAT if seat == &"driver" else PlayerAvatar.RIDE_SEAT))
		else:
			var pose := r.pose_at(now_s)
			r.body.position = pose[0]
			r.body.rotation = Vector3(0, pose[1], 0)
		var near := not viewer.is_valid() or r.body.global_position.distance_to(viewer.call()) <= ANIMATE_RANGE
		r.model.set_animating(near)
		r.model.play(CharacterModel.state_for(r.speed if now_s - r.t0 <= STILL_AFTER_S else 0.0, true, 0.0, seat))


func count() -> int:
	return _remotes.size()


func body(id: String) -> Node3D:
	var r: Remote = _remotes.get(id)
	return r.body if r else null


func model(id: String) -> CharacterModel:
	var r: Remote = _remotes.get(id)
	return r.model if r else null


func label(id: String) -> Label3D:
	var r: Remote = _remotes.get(id)
	return r.label if r else null


func _build(id: String) -> Remote:
	var want: Dictionary = _roster[id]
	var r := Remote.new()
	r.body = Node3D.new()
	r.body.name = "Remote_" + id.validate_node_name()
	r.model = CharacterModel.new()
	r.model.setup(want.character, want.color)
	r.body.add_child(r.model)
	r.label = Label3D.new()
	r.label.text = want.name
	r.label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	r.label.visibility_range_end = NAME_RANGE
	r.label.font_size = 48
	r.label.outline_size = 12
	r.label.position.y = TAG_UP
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
