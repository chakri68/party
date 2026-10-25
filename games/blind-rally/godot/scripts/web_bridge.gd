class_name WebBridge
extends Node
## Godot side of the iframe bridge (repo map §3.4, spec §8.4).
##
## The parent page puts `blindRallyHost = {emitSnapshot, emitPhysicsEvent,
## ready}` on the iframe's window. We find it, hang our three callbacks on the
## same object, and call `ready()`:
##   host.receiveControl({steer, throttle, brake, seq?})
##   host.initSession(roomConfig, seatToken)
##   host.receiveAuthoritativeRaceEvent(event)
##   host.receiveGhostSnapshot(teamId, ghost)   shared stage: a rival's car
## and from our side:
##   host.emitSnapshot({tick, position, heading, velocity, speed, distance, checkpointHint, surface})
##   host.emitPhysicsEvent({kind, ...})
##
## Not on web, or no host: everything here is a quiet no-op.

signal control_received(steer: float, throttle: float, brake: float)
signal session_started(config: Dictionary, seat_token: String)
signal race_event(event: Dictionary)
signal ghost_received(team_id: int, ghost: Dictionary)
## Every physics event Godot raises, sent to the host or not (tests listen here).
signal physics_event(event: Dictionary)

const SNAPSHOT_HZ := 10.0
const HOST_POLL_S := 0.25
const HOST_POLL_GIVE_UP_S := 20.0

var car: CarController
var checkpoint_hint := 0
var connected := false
## Off while the debug autopilot drives: controls still arrive (and still
## emit control_received) but don't reach the car.
var forward_control := true

var _host: JavaScriptObject
var _json: JavaScriptObject
# Held so the JS side's references stay valid; drop these and the callbacks
# get collected out from under the parent page.
var _cb_control: JavaScriptObject
var _cb_init: JavaScriptObject
var _cb_event: JavaScriptObject
var _cb_ghost: JavaScriptObject
var _snap_accum := 0.0
var _poll_accum := 0.0
var _poll_total := 0.0
var _tick := 0
var _seat_token := ""


func _ready() -> void:
	if not OS.has_feature("web"):
		set_process(false)
		set_physics_process(false)
		return
	_json = JavaScriptBridge.get_interface("JSON")
	# Deferred: attaching calls host.ready(), and the room answers with
	# initSession on the spot. This node is readied before main.gd, so an
	# attach here would emit session_started before anyone listens, and the
	# session (livery, assists, room, checkpoints) would be lost.
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
		push_warning("blindRallyHost never showed up; running standalone")
		set_process(false)


func _physics_process(dt: float) -> void:
	_tick += 1
	if not connected or car == null:
		return
	_snap_accum += dt
	if _snap_accum >= 1.0 / SNAPSHOT_HZ:
		_snap_accum -= 1.0 / SNAPSHOT_HZ
		_emit("emitSnapshot", snapshot())


func _try_attach() -> void:
	_host = JavaScriptBridge.get_interface("blindRallyHost")
	if _host == null:
		return
	_cb_control = JavaScriptBridge.create_callback(_on_control)
	_cb_init = JavaScriptBridge.create_callback(_on_init)
	_cb_event = JavaScriptBridge.create_callback(_on_event)
	_cb_ghost = JavaScriptBridge.create_callback(_on_ghost)
	_host.receiveControl = _cb_control
	_host.initSession = _cb_init
	_host.receiveAuthoritativeRaceEvent = _cb_event
	_host.receiveGhostSnapshot = _cb_ghost
	connected = true
	set_process(false)
	if _host.ready:
		_host.ready()


## Plain dictionary so tests (and a future WebSocket path) can use it too.
func snapshot() -> Dictionary:
	var p := car.global_position
	var v := car.velocity
	return {
		"tick": _tick,
		"position": [snappedf(p.x, 0.01), snappedf(p.y, 0.01), snappedf(p.z, 0.01)],
		"heading": snappedf(car.global_rotation.y, 0.001),
		"velocity": [snappedf(v.x, 0.01), snappedf(v.y, 0.01), snappedf(v.z, 0.01)],
		"speed": snappedf(car.forward_speed, 0.01),
		"distance": snappedf(car.distance_travelled, 0.1),
		"checkpointHint": checkpoint_hint,
		"surface": car.surface,
	}


func emit_physics_event(ev: Dictionary) -> void:
	physics_event.emit(ev)
	if connected:
		_emit("emitPhysicsEvent", ev)


func _emit(method: String, payload: Dictionary) -> void:
	# Round-trip through JSON so the parent gets a real object, not a proxy.
	var obj: Variant = _json.parse(JSON.stringify(payload))
	if method == "emitSnapshot":
		_host.emitSnapshot(obj)
	else:
		_host.emitPhysicsEvent(obj)


func _on_control(args: Array) -> void:
	if args.is_empty() or not (args[0] is JavaScriptObject):
		return
	var o: JavaScriptObject = args[0]
	var steer := _num(o.steer)
	var throttle := _num(o.throttle)
	var brake := _num(o.brake)
	if car and forward_control:
		car.set_control(steer, throttle, brake)
	control_received.emit(steer, throttle, brake)


func _on_init(args: Array) -> void:
	var cfg := {}
	if args.size() > 0 and args[0] is JavaScriptObject:
		var parsed: Variant = JSON.parse_string(String(_json.stringify(args[0])))
		if parsed is Dictionary:
			cfg = parsed
	_seat_token = String(args[1]) if args.size() > 1 else ""
	session_started.emit(cfg, _seat_token)


func _on_event(args: Array) -> void:
	if args.is_empty() or not (args[0] is JavaScriptObject):
		return
	var parsed: Variant = JSON.parse_string(String(_json.stringify(args[0])))
	if parsed is Dictionary:
		race_event.emit(parsed)


## (teamId, ghost). At up to 10 Hz per rival: still the JSON round trip,
## since a JavaScriptObject's array fields don't come over as Arrays.
func _on_ghost(args: Array) -> void:
	if args.size() < 2 or not (args[1] is JavaScriptObject):
		return
	var parsed: Variant = JSON.parse_string(String(_json.stringify(args[1])))
	if parsed is Dictionary:
		ghost_received.emit(int(_num(args[0])), parsed)


func _num(v: Variant) -> float:
	return float(v) if (v is float or v is int) else 0.0
