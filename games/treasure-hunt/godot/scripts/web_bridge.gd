class_name WebBridge
extends Node
## Godot side of the iframe bridge, copied from Blind Rally's and cut down to
## what the hunt needs.
##
## The parent page puts `treasureHuntHost = {emitStatus, emitPos, emitClaim,
## ready}` on the iframe's window. We find it, hang our callbacks on the same
## object, and only then call `ready()` (the page answers at once):
##   host.initSession({layout})            TS -> Godot
##   host.revealCache({id, x, z, dy})      idempotent by id
##   host.cacheFound({id, mine})           mine: false when another team took it
##   host.setPhase({phase})                input is on only in "hunting"
##   host.roster({me, players: [{id, name, color, team}]})   full list, every update
##   host.remotePos({id, x, y, z, yaw, foot, v})             another player, as relayed
##   host.vehicles({me, list: [{id, x, y, z, yaw, driver, passenger}]})  full list, every update
##   host.pins({list: [{id, x, z, color, mine}]})   my team's pins, full list, every update
##   host.skyClock({min, running})          game minutes after midnight; DayClock carries it on
##   host.photos({list: [{id, x, z, yaw, pitch, fov}]})  my team's photo clue poses; Photos renders new ones
##   host.sound({muted, volume})            the page's sound settings; volume 0..1
##   host.hotCold({level})                  the hot/cold meter, -1 (none) to 3 (hottest)
## and from our side:
##   host.emitStatus({kind: "world-ready", ms, chunks, seed})   seed: the one built
##   host.emitPos({x, y, z, yaw, foot, v})  POS_HZ, in countdown and hunting
##   host.emitClaim({id})                  E by a cache
##   host.emitSeat({vehicleId, seat})      E by a buggy: "driver" or "passenger"
##   host.emitUnseat({x, y, z, yaw})       got out; the buggy's pose
##   host.emitPin({x, z})                  P: where the camera looks at the ground
##   host.emitPhoto({id, x, z, yaw, pitch, fov, data})  a photo clue, rendered at that pose: base64 JPEG
##
## Not on web, or no host: the JS half is a quiet no-op. Every inbound call
## has a receive_*_json seam and every outbound one a *_sent signal, so
## tests run the same path headless.

signal session_started(config: Dictionary)
## Every status Godot raises, sent to the host or not (tests listen here).
signal status_sent(status: Dictionary)
signal cache_revealed(reveal: Dictionary) ## {id: String, x, z, dy: float}
signal cache_found(id: String)
## Alongside cache_found: whether my team found it (false: another team took it).
signal cache_found_by(id: String, mine: bool)
signal phase_set(phase: StringName)
## Who to draw (`me` among them, to skip): [{id, name, color, team}].
signal roster_set(players: Array, me: String)
## Another player's snapshot: {x, y, z, yaw, foot, v}.
signal remote_moved(id: String, snap: Dictionary)
## The server's buggies (Fleet checks each one): [{id, x, y, z, yaw, driver, passenger}].
signal vehicles_set(list: Array, me: String)
## My team's pins: [{id, x, z, color, mine}]. Pins checks each one.
signal pins_set(list: Array)
## The day clock: minutes after midnight, and whether it's moving.
signal sky_clock_set(min: float, running: bool)
## Photo clue poses: [{id, x, z, yaw, pitch, fov}]. Photos checks each one.
signal photos_set(list: Array)
## The page's sound settings: muted, and 0..1 volume.
signal sound_set(muted: bool, volume: float)
## The hot/cold meter level, -1..3.
signal hot_cold_set(level: int)
## Outbound, sent to the host or not (tests listen here).
signal pos_sent(pos: Dictionary)
signal claim_sent(claim: Dictionary)
signal seat_sent(seat: Dictionary)
signal unseat_sent(pose: Dictionary)
signal pin_sent(pin: Dictionary)
signal photo_sent(photo: Dictionary)

const HOST_POLL_S := 0.25
const HOST_POLL_GIVE_UP_S := 20.0

var connected := false

var _host: JavaScriptObject
var _json: JavaScriptObject
# Held so the JS side's reference stays valid; drop it and the callback gets
# collected out from under the parent page.
var _cb_init: JavaScriptObject
var _cb_reveal: JavaScriptObject
var _cb_found: JavaScriptObject
var _cb_phase: JavaScriptObject
var _cb_roster: JavaScriptObject
var _cb_remote: JavaScriptObject
var _cb_vehicles: JavaScriptObject
var _cb_pins: JavaScriptObject
var _cb_sky_clock: JavaScriptObject
var _cb_photos: JavaScriptObject
var _cb_sound: JavaScriptObject
var _cb_hot_cold: JavaScriptObject
var _poll_accum := 0.0
var _poll_total := 0.0


func _ready() -> void:
	if not OS.has_feature("web"):
		set_process(false)
		return
	_json = JavaScriptBridge.get_interface("JSON")
	# Deferred: attaching calls host.ready(), and the page answers with
	# initSession on the spot. This node is readied before main.gd, so an
	# attach here would emit session_started before anyone listens.
	_try_attach.call_deferred()


func _process(dt: float) -> void:
	if connected:
		return
	# The parent may set the host after our first frame (the iframe's window
	# object can be swapped when its document loads), so keep looking a while.
	_poll_accum += dt
	_poll_total += dt
	if _poll_accum >= HOST_POLL_S:
		_poll_accum = 0.0
		_try_attach()
	if _poll_total > HOST_POLL_GIVE_UP_S:
		push_warning("treasureHuntHost never showed up; running standalone")
		set_process(false)


func _try_attach() -> void:
	_host = JavaScriptBridge.get_interface("treasureHuntHost")
	if _host == null:
		return
	_cb_init = JavaScriptBridge.create_callback(_on_init)
	_host.initSession = _cb_init
	_cb_reveal = JavaScriptBridge.create_callback(_on_js.bind(receive_reveal_json))
	_host.revealCache = _cb_reveal
	_cb_found = JavaScriptBridge.create_callback(_on_js.bind(receive_found_json))
	_host.cacheFound = _cb_found
	_cb_phase = JavaScriptBridge.create_callback(_on_js.bind(receive_phase_json))
	_host.setPhase = _cb_phase
	_cb_roster = JavaScriptBridge.create_callback(_on_js.bind(receive_roster_json))
	_host.roster = _cb_roster
	_cb_remote = JavaScriptBridge.create_callback(_on_js.bind(receive_remote_json))
	_host.remotePos = _cb_remote
	_cb_vehicles = JavaScriptBridge.create_callback(_on_js.bind(receive_vehicles_json))
	_host.vehicles = _cb_vehicles
	_cb_pins = JavaScriptBridge.create_callback(_on_js.bind(receive_pins_json))
	_host.pins = _cb_pins
	_cb_sky_clock = JavaScriptBridge.create_callback(_on_js.bind(receive_sky_clock_json))
	_host.skyClock = _cb_sky_clock
	_cb_photos = JavaScriptBridge.create_callback(_on_js.bind(receive_photos_json))
	_host.photos = _cb_photos
	_cb_sound = JavaScriptBridge.create_callback(_on_js.bind(receive_sound_json))
	_host.sound = _cb_sound
	_cb_hot_cold = JavaScriptBridge.create_callback(_on_js.bind(receive_hot_cold_json))
	_host.hotCold = _cb_hot_cold
	connected = true
	set_process(false)
	if _host.ready:
		_host.ready()


func emit_status(status: Dictionary) -> void:
	status_sent.emit(status)
	if connected:
		# Round-trip through JSON so the parent gets a real object, not a proxy.
		_host.emitStatus(_json.parse(JSON.stringify(status)))


func emit_pos(pos: Dictionary) -> void:
	pos_sent.emit(pos)
	if connected and _host.emitPos:
		_host.emitPos(_json.parse(JSON.stringify(pos)))


func emit_claim(id: String) -> void:
	var claim := {"id": id}
	claim_sent.emit(claim)
	if connected and _host.emitClaim:
		_host.emitClaim(_json.parse(JSON.stringify(claim)))


func emit_seat(vehicle_id: String, seat: String) -> void:
	var d := {"vehicleId": vehicle_id, "seat": seat}
	seat_sent.emit(d)
	if connected and _host.emitSeat:
		_host.emitSeat(_json.parse(JSON.stringify(d)))


## {x, y, z, yaw}
func emit_unseat(pose: Dictionary) -> void:
	unseat_sent.emit(pose)
	if connected and _host.emitUnseat:
		_host.emitUnseat(_json.parse(JSON.stringify(pose)))


## {x, z}: where a pin should go.
func emit_pin(at: Dictionary) -> void:
	pin_sent.emit(at)
	if connected and _host.emitPin:
		_host.emitPin(_json.parse(JSON.stringify(at)))


## A rendered photo clue: {id, x, z, yaw, pitch, fov, data}. The pose is the
## one it was rendered at (the page keys on all of it); data: base64 JPEG.
func emit_photo(id: String, pose: Dictionary, data: String) -> void:
	var d := {"id": id, "x": pose.x, "z": pose.z, "yaw": pose.yaw, "pitch": pose.pitch, "fov": pose.fov, "data": data}
	photo_sent.emit(d)
	if connected and _host.emitPhoto:
		_host.emitPhoto(_json.parse(JSON.stringify(d)))


## The session as JSON text. Every number in it is a float now (JSON has no
## ints); start_world and TerrainField cast what they need.
func receive_session_json(text: String) -> void:
	var parsed: Variant = JSON.parse_string(text)
	if parsed is Dictionary:
		session_started.emit(parsed)


## {id, x, z, dy}. Anything without a string id and numeric x, z is dropped.
func receive_reveal_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("id") is String and _num(d.get("x")) and _num(d.get("z")):
		cache_revealed.emit({"id": d.id, "x": float(d.x), "z": float(d.z), "dy": float(d.dy) if _num(d.get("dy")) else 0.0})


## {id, mine}. mine is a bool and defaults to true when missing.
func receive_found_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("id") is String:
		cache_found.emit(d.id)
		cache_found_by.emit(d.id, d.mine if d.get("mine") is bool else true)


## {phase}: "generating", "countdown", "hunting" or "finished".
func receive_phase_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("phase") is String:
		phase_set.emit(StringName(d.phase))


## {me, players}. Remotes checks each player; this only checks the shape.
func receive_roster_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("me") is String and d.get("players") is Array:
		roster_set.emit(d.players, d.me)


## {id, x, y, z, yaw, foot, v}. A missing yaw reads as 0; v is a string or null.
func receive_remote_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if not (d is Dictionary and d.get("id") is String and _num(d.get("x")) and _num(d.get("y")) and _num(d.get("z")) and d.get("foot") is bool):
		return
	var v: Variant = d.get("v")
	remote_moved.emit(d.id, {"x": float(d.x), "y": float(d.y), "z": float(d.z), "yaw": float(d.yaw) if _num(d.get("yaw")) else 0.0, "foot": d.foot, "v": v if v is String else null})


## {me, list}. Fleet checks each vehicle; this only checks the shape.
func receive_vehicles_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("me") is String and d.get("list") is Array:
		vehicles_set.emit(d.list, d.me)


## {list}. Pins checks each pin; this only checks the shape.
func receive_pins_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("list") is Array:
		pins_set.emit(d.list)


## {min, running}. A non-numeric min or a missing running is dropped.
func receive_sky_clock_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and _num(d.get("min")) and d.get("running") is bool:
		sky_clock_set.emit(float(d.min), d.running)


## {list}. Photos checks each pose; this only checks the shape.
func receive_photos_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("list") is Array:
		photos_set.emit(d.list)


## {muted, volume}. A non-bool muted or a non-numeric volume is dropped;
## volume is clamped to 0..1.
func receive_sound_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("muted") is bool and _num(d.get("volume")):
		sound_set.emit(d.muted, clampf(float(d.volume), 0.0, 1.0))


## {level}. A non-number, or a level outside -1..3, is dropped. JSON numbers
## arrive as floats, so 2.0 counts; 2.5 does not.
func receive_hot_cold_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and _num(d.get("level")):
		var f := float(d.level)
		if f == floorf(f) and f >= -1.0 and f <= 3.0:
			hot_cold_set.emit(int(f))


static func _num(v: Variant) -> bool:
	return v is float or v is int


## Every inbound JS call but initSession: stringify the argument and hand it
## to its receive_*_json seam.
func _on_js(args: Array, seam: Callable) -> void:
	if args.size() > 0 and args[0] is JavaScriptObject:
		seam.call(String(_json.stringify(args[0])))


func _on_init(args: Array) -> void:
	# Stringified on our side: a JavaScriptObject's array fields (the heights)
	# don't come over as Arrays.
	if args.size() > 0 and args[0] is JavaScriptObject:
		receive_session_json(String(_json.stringify(args[0])))
