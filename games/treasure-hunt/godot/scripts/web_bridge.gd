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
##   host.cacheFound({id})
##   host.setPhase({phase})                input is on only in "hunting"
## and from our side:
##   host.emitStatus({kind: "world-ready", ms, chunks, seed})   seed: the one built
##   host.emitPos({x, y, z, foot})         POS_HZ, in countdown and hunting
##   host.emitClaim({id})                  E by a cache
##
## Not on web, or no host: the JS half is a quiet no-op. Every inbound call
## has a receive_*_json seam and every outbound one a *_sent signal, so
## tests run the same path headless.

signal session_started(config: Dictionary)
## Every status Godot raises, sent to the host or not (tests listen here).
signal status_sent(status: Dictionary)
signal cache_revealed(reveal: Dictionary) ## {id: String, x, z, dy: float}
signal cache_found(id: String)
signal phase_set(phase: StringName)
## Outbound, sent to the host or not (tests listen here).
signal pos_sent(pos: Dictionary)
signal claim_sent(claim: Dictionary)

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


## {id}
func receive_found_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("id") is String:
		cache_found.emit(d.id)


## {phase}: "generating", "countdown", "hunting" or "finished".
func receive_phase_json(text: String) -> void:
	var d: Variant = JSON.parse_string(text)
	if d is Dictionary and d.get("phase") is String:
		phase_set.emit(StringName(d.phase))


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
