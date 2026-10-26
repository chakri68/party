extends RefCounted
## Guess pins (spec §4.4, map_controller.gd): placed on the big map or the
## map-only map, moved, cleared by long press or the chip, a trail of three,
## both maps, never on the 3D side, never moving for the car. Run from
## run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd), untyped: its helpers are its own
var main: Node3D
var map: MapController
var pin_events: Array = []


func _init(runner) -> void:
	t = runner


func run() -> void:
	main = t.main
	map = t.map
	if not main.bridge.physics_event.is_connected(_on_event):
		main.bridge.physics_event.connect(_on_event)
	await test_place_and_move()
	await test_clear()
	await test_both_maps()
	await test_static_and_2d_only()
	await test_closing_still_works()
	await test_map_only()
	await test_marker_on()
	test_restore()
	map.restore_pins({})
	main.bridge.physics_event.disconnect(_on_event)


func _on_event(ev: Dictionary) -> void:
	if ev.get("kind") == "pin":
		pin_events.append(ev)


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


## A point on the map image, as a fraction of the map control's rect, in canvas units.
func _at(fx: float, fy: float) -> Vector2:
	var r := map.get_global_rect()
	return r.position + r.size * Vector2(fx, fy)


## Where the pin is drawn, canvas units (null without one).
func _pin_global() -> Variant:
	var p: Variant = map.pin_points().pin
	return map.get_global_rect().position + p if p != null else null


## A press now, a release `held` game seconds later, through the root viewport.
func press_hold(at: Vector2, held: float) -> void:
	for down in [true, false]:
		var e := InputEventMouseButton.new()
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = down
		e.position = at
		e.global_position = at
		t.root.push_input(e, true)
		if down:
			await t.wait_s(held)
	await t.process_frame


func _open() -> void:
	main.set_map_expanded(true, false)
	await t.process_frame


func test_place_and_move() -> void:
	print("pins: place and move")
	t._probe_session()
	map.restore_pins({})
	await _open()
	check(map.pinnable(), "the big map, open, takes pins")
	pin_events.clear()
	var a := _at(0.4, 0.5)
	await t.click(a)
	check(main.map_expanded, "a click on the big map leaves it open")
	var g: Variant = _pin_global()
	check(map.pin != null and g != null and (g as Vector2).distance_to(a) < 1.0, "and puts the pin's point where it landed (%s vs %s)" % [g, a])
	var w: Vector2 = map.pin
	check(pin_events.size() == 1 and is_equal_approx(pin_events[0].x, snappedf(w.x, 0.1)) and is_equal_approx(pin_events[0].z, snappedf(w.y, 0.1)),
		"the bridge hears {kind: pin, x, z} in world metres (%s)" % [pin_events])
	check(map.track.bounds.has_point(w), "inside the track's bounds")
	var b := _at(0.6, 0.45)
	await t.tap(b)
	check(map.pin != null and (_pin_global() as Vector2).distance_to(b) < 1.0 and map.trail == [w], "a finger tap moves it; the old one joins the trail")
	for f in [0.3, 0.35, 0.5, 0.55]:
		await t.click(_at(f, 0.6))
	check(map.trail.size() == MapController.TRAIL, "the trail keeps the last %d (%d)" % [MapController.TRAIL, map.trail.size()])
	check(map.trail[2].is_equal_approx(map.local_to_world(_at(0.5, 0.6) - map.get_global_rect().position)), "newest last, the one just replaced")
	check(pin_events.size() == 6, "one event per placement (%d)" % pin_events.size())
	main.set_map_expanded(false, false)


func test_clear() -> void:
	print("pins: clear")
	map.restore_pins({})
	await _open()
	var chip: Control = map.get_node("ClearPin")
	check(not chip.visible, "no pin, no clear chip")
	await t.click(_at(0.5, 0.5))
	await t.click(_at(0.45, 0.55))
	check(chip.visible and map.get_global_rect().encloses(chip.get_global_rect()), "a pin: the chip shows, on the map")
	var x: Control = map.get_node("Corner")
	check(not chip.get_global_rect().intersects(x.get_global_rect()), "and clear of the X")
	pin_events.clear()
	var trail := map.trail.duplicate()
	await t.click(chip.get_global_rect().get_center())
	check(map.pin == null and map.trail == trail and main.map_expanded, "the chip clears the pin, keeps the trail, and the map stays open")
	check(pin_events == [{"kind": "pin", "clear": true}], "and says so: {kind: pin, clear: true}")
	check(not chip.visible, "no pin, no chip")
	# Long press.
	await t.click(_at(0.5, 0.5))
	pin_events.clear()
	await press_hold(_at(0.3, 0.3), MapController.LONG_PRESS_S + 0.15)
	check(map.pin == null and pin_events == [{"kind": "pin", "clear": true}], "a long press clears it, and its release places nothing")
	await press_hold(_at(0.3, 0.3), 0.1)
	check(map.pin != null, "a short press is a tap: it places one")
	pin_events.clear()
	await press_hold(_at(0.3, 0.3), MapController.LONG_PRESS_S + 0.15)
	await press_hold(_at(0.3, 0.3), MapController.LONG_PRESS_S + 0.15)
	check(pin_events.size() == 1, "a long press with no pin: nothing to clear, no event")
	main.set_map_expanded(false, false)


func test_both_maps() -> void:
	print("pins: both maps")
	map.restore_pins({})
	await _open()
	await t.click(_at(0.4, 0.4))
	await t.click(_at(0.6, 0.6))
	var w: Vector2 = map.pin
	var big_h := map._pin_h()
	main.set_map_expanded(false, false)
	await t.process_frame
	var small := map.get_global_rect()
	var g: Variant = _pin_global()
	check(map.pin == w and g != null and small.has_point(g), "closed: the same pin, drawn on the corner map (%s in %s)" % [g, small])
	check(map.local_to_world(map.pin_points().pin).distance_to(w) < 0.5, "at the same world spot")
	check(map.trail.size() == 1 and small.has_point(map.get_global_rect().position + map.pin_points().trail[0]), "and its trail")
	check(map._pin_h() < big_h, "smaller on the corner map (%.0f vs %.0f)" % [map._pin_h(), big_h])
	check(not (map.get_node("ClearPin") as Control).visible, "no chip on the corner map")
	pin_events.clear()
	await t.click(g)
	check(main.map_expanded and map.pin == w and pin_events.is_empty(), "a tap on the corner map, even on the pin, opens the big map; the pin stays put")
	main.set_map_expanded(false, false)


## With the live marker off, a placed pin is as still as the rest of the map.
func test_static_and_2d_only() -> void:
	print("pins: static, 2D only")
	map.gps_enabled = false
	var n3d: int = t.root.find_children("*", "Node3D", true, false).size()
	await _open()
	await t.click(_at(0.5, 0.5))
	await t.click(_at(0.52, 0.48))
	var pins: Control = map.image_rect.get_node("Pins")
	check(pins is CanvasItem and map.is_ancestor_of(pins), "pins are drawn by a 2D node under the map")
	check(t.root.find_children("*", "Node3D", true, false).size() == n3d, "and placing them adds nothing to the 3D world, on any layer")
	var before: Array = t._map_tree_state()
	var w: Vector2 = map.pin
	await t.place(map.track.get_spawn().global_transform)
	await t.drive(1.5, 0.3, 1.0)
	for f in 3:
		await t.process_frame
	check(map.pin == w and t._map_tree_state() == before, "driving with the big map open: the pin and everything else under the map stay put")
	main.set_map_expanded(false, false)
	await t.process_frame
	var corner: Array = t._map_tree_state()
	await t.drive(1.0, -0.3, 1.0)
	check(map.pin == w and t._map_tree_state() == corner, "and on the corner map")
	check(map.render_count == 1, "the map image is still the one render")


## The new taps didn't eat the old ways out.
func test_closing_still_works() -> void:
	print("pins: closing the big map")
	var vs := main.get_viewport().get_visible_rect().size
	await t.click(t._map_centre())
	await t.settle()
	await t.click(t._map_centre())
	check(main.map_expanded, "with a pin down, a tap on the big map still doesn't close it")
	await t.click(Vector2(map.get_global_rect().position.x * 0.5, vs.y * 0.5))
	await t.settle()
	check(not main.map_expanded, "a tap outside does")
	await t.key(KEY_M)
	await t.settle()
	await t.click((map.get_node("Corner") as Control).get_global_rect().get_center())
	await t.settle()
	check(not main.map_expanded, "the X does")
	await t.key(KEY_M)
	await t.settle()
	await t.key(KEY_M)
	await t.settle()
	check(not main.map_expanded, "M does")
	await t.key(KEY_M)
	await t.settle()
	await t.key(KEY_ESCAPE)
	await t.settle()
	check(not main.map_expanded, "Esc does")


func test_map_only() -> void:
	print("pins: map-only")
	t._probe_session()
	map.restore_pins({})
	main._on_race_event({"kind": "assists", "camera3d": false})
	await t.process_frame
	var r := map.get_global_rect()
	check(map.pinnable(), "the map-only map takes pins")
	pin_events.clear()
	var a := _at(0.5, 0.5)
	await t.tap(a)
	check(map.pin != null and (_pin_global() as Vector2).distance_to(a) < 1.0 and pin_events.size() == 1, "a tap puts the pin there")
	await t.click(_at(0.45, 0.5))
	check(map.trail.size() == 1, "a click moves it")
	var chip: Control = map.get_node("ClearPin")
	check(chip.visible and r.encloses(chip.get_global_rect()), "the clear chip's on the map, top right")
	check(not main.map_expanded and map.get_global_rect() == r and main.get_viewport().disable_3d, "and nothing else changed: no big map, no 3D")
	await press_hold(_at(0.5, 0.5), MapController.LONG_PRESS_S + 0.15)
	check(map.pin == null, "a long press clears it")
	await t.click(_at(0.5, 0.5))
	await t.click(chip.get_global_rect().get_center())
	check(map.pin == null and not chip.visible, "so does the chip")
	await t.click(_at(0.5, 0.5))
	await t.key(KEY_M)
	await t.key(KEY_ESCAPE)
	await t.settle()
	check(map.pin != null and not main.map_expanded and map.get_global_rect() == r, "M and Esc still do nothing, and leave the pin")
	main._on_race_event({"kind": "assists", "camera3d": true})
	await t.process_frame
	check(map.pin != null and not map.pinnable() and not chip.visible, "3D back: the pin stays, the corner map opens on a tap again")
	await t.click(t._map_centre())
	await t.settle()
	check(main.map_expanded, "and it does")
	main.set_map_expanded(false, false)
	map.restore_pins({})


func test_marker_on() -> void:
	print("pins: live marker on")
	t._probe_session()
	main._on_race_event({"kind": "assists", "liveMarker": true})
	await _open()
	await t.click(_at(0.3, 0.6))
	var marker: Polygon2D = map.image_rect.get_node("GpsMarker")
	check(map.pin != null and marker.visible, "pins work with the marker on; both show")
	var w: Vector2 = map.pin
	await t.drive(1.0, 0.0, 1.0)
	check(map.pin == w, "the marker moves, the pin doesn't")
	main.set_map_expanded(false, false)
	t._probe_session()


func test_restore() -> void:
	print("pins: restore")
	map.restore_pins({})
	main._on_session({"teamColor": "#56b4e9", "teamNumber": 2, "pins": {"pin": [10.0, -20.0], "trail": [[1, 2], [3, 4], [5, 6], [7, 8]]}}, "")
	check(map.pin == Vector2(10, -20), "a reloaded Navigator's initSession puts their pin back")
	check(map.trail == [Vector2(3, 4), Vector2(5, 6), Vector2(7, 8)], "and the trail, at most three")
	check(map.pin_color.is_equal_approx(Color("56b4e9")), "in the team's colour")
	pin_events.clear()
	main._on_session({}, "")
	check(map.pin == Vector2(10, -20) and pin_events.is_empty(), "a session without pins leaves them, and nothing's echoed back")
	main._on_race_event({"kind": "pins", "pin": null, "trail": []})
	check(map.pin == null and map.trail.is_empty(), "a pins event (a new race) wipes them")
	main._on_session({"pins": {"pin": "nonsense", "trail": [[1], "x", [1, 2]]}}, "")
	check(map.pin == null and map.trail == [Vector2(1, 2)], "junk in, nothing silly out")
	check(map.local_to_world(Vector2(-1000, -1000)) == null, "a point off the map isn't a pin")
	t._probe_session()
