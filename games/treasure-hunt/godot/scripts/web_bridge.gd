class_name WebBridge
extends Node
## Godot side of the iframe bridge, copied from Blind Rally's and cut down to
## what M1 needs.
##
## The parent page puts `treasureHuntHost = {emitStatus, ready}` on the
## iframe's window. We find it, hang our callback on the same object, and
## call `ready()`:
##   host.initSession({layout})            TS -> Godot
## and from our side:
##   host.emitStatus({kind: "world-ready", ms, chunks})
##
## Not on web, or no host: the JS half is a quiet no-op. Sessions can still
## come in through receive_session_json, and statuses still go out on
## status_sent, so tests run the same path headless.

signal session_started(config: Dictionary)
## Every status Godot raises, sent to the host or not (tests listen here).
signal status_sent(status: Dictionary)

const HOST_POLL_S := 0.25
const HOST_POLL_GIVE_UP_S := 20.0

var connected := false

var _host: JavaScriptObject
var _json: JavaScriptObject
# Held so the JS side's reference stays valid; drop it and the callback gets
# collected out from under the parent page.
var _cb_init: JavaScriptObject
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
	connected = true
	set_process(false)
	if _host.ready:
		_host.ready()


func emit_status(status: Dictionary) -> void:
	status_sent.emit(status)
	if connected:
		# Round-trip through JSON so the parent gets a real object, not a proxy.
		_host.emitStatus(_json.parse(JSON.stringify(status)))


## The session as JSON text. Every number in it is a float now (JSON has no
## ints); start_world and TerrainField cast what they need.
func receive_session_json(text: String) -> void:
	var parsed: Variant = JSON.parse_string(text)
	if parsed is Dictionary:
		session_started.emit(parsed)


func _on_init(args: Array) -> void:
	# Stringified on our side: a JavaScriptObject's array fields (the heights)
	# don't come over as Arrays.
	if args.size() > 0 and args[0] is JavaScriptObject:
		receive_session_json(String(_json.stringify(args[0])))
