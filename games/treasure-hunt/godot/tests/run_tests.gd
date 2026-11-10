extends SceneTree
## Headless tests for the Treasure Hunt client. Nothing is instantiated up
## front: each suite builds what it needs from the fixtures.
## Run: godot --headless --path . --fixed-fps 60 --script res://tests/run_tests.gd
## Exit code 0 = all passed and nothing crashed: a SCRIPT ERROR or SHADER
## ERROR anywhere in the run (see Crashes) is a failure too.

const FIXTURES := 5

var failures := 0
var passes := 0
var crashes := Crashes.new()


## A GDScript runtime error aborts the function it's in, and the await
## chain carries on as if it had returned, so a test that died mid-way
## printed its SCRIPT ERROR and the run still said "0 failed". This hears
## every script and shader error the engine logs; each one is a failure.
class Crashes extends Logger:
	var _lock := Mutex.new()
	var _seen: PackedStringArray = []

	func _log_message(_message: String, _error: bool) -> void:
		pass

	func _log_error(function: String, file: String, line: int, code: String, rationale: String, _editor_notify: bool, error_type: int, _backtraces: Array[ScriptBacktrace]) -> void:
		if error_type != ERROR_TYPE_SCRIPT and error_type != ERROR_TYPE_SHADER:
			return
		_lock.lock()
		_seen.append("%s ERROR: %s (%s:%d %s)" % ["SHADER" if error_type == ERROR_TYPE_SHADER else "SCRIPT", rationale if rationale else code, file, line, function])
		_lock.unlock()

	func seen() -> PackedStringArray:
		_lock.lock()
		var out := _seen.duplicate()
		_lock.unlock()
		return out


func _initialize() -> void:
	OS.add_logger(crashes)
	_run.call_deferred()


func _run() -> void:
	for path in ["res://tests/terrain_tests.gd", "res://tests/stream_tests.gd"]:
		# load(), not preload: a suite that doesn't compile fails the run
		# here instead of killing _run and leaving the tree up for ever.
		var suite: GDScript = load(path)
		if suite == null or not suite.can_instantiate():
			check(false, "suite compiles: " + path)
			continue
		await suite.new(self).run()

	for c in crashes.seen():
		check(false, "crashed: " + c)
	print("\n%d passed, %d failed" % [passes, failures])
	quit(1 if failures else 0)


# --- helpers -------------------------------------------------------------------

func check(ok: bool, what: String) -> void:
	if ok:
		passes += 1
		print("  ok   ", what)
	else:
		failures += 1
		print("  FAIL ", what)


## The parsed layout_<n>.json fixture (written by the TS generator's tests).
func layout(n: int) -> Dictionary:
	var text := FileAccess.get_file_as_string("res://tests/fixtures/layout_%d.json" % n)
	var parsed: Variant = JSON.parse_string(text)
	return parsed if parsed is Dictionary else {}


func ground_material() -> Material:
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/ground.gdshader")
	return m
