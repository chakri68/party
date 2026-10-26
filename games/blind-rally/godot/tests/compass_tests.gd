extends RefCounted
## The Navigator's compass (nav_compass.gd, spec §4.2): readout text, the
## card against the car's heading in each camera, the 359 -> 0 wrap,
## where it sits, and that it stays off the map and out of map-only mode.
## Run from run_tests.gd, with its helpers and its pass/fail count.

var t ## the runner (run_tests.gd)
var main: Node3D
var car: CarController
var compass: NavCompass

const TOL := 0.02 ## radians, ~1 degree


func _init(runner) -> void:
	t = runner


func run() -> void:
	main = t.main
	car = t.car
	compass = main.compass
	t._probe_session()
	test_text()
	test_wrap()
	await test_cameras()
	await test_rotate_with_car()
	await test_respawn_snaps()
	await test_placement()
	await test_maponly_and_map()
	main.set_camera_mode(FollowCamera.Mode.TOP_DOWN)
	t._probe_session()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func _near(a: float, b: float, tol := TOL) -> bool:
	return absf(angle_difference(a, b)) < tol


## Compass heading in degrees -> Godot yaw.
func _yaw(deg: float) -> float:
	return -deg_to_rad(deg)


func test_text() -> void:
	print("compass: readout")
	var cases := {0.0: "000° N", 42.0: "042° NE", 90.0: "090° E", 135.0: "135° SE", 180.0: "180° S",
		225.0: "225° SW", 270.0: "270° W", 315.0: "315° NW", 22.4: "022° N", 22.6: "023° NE",
		359.4: "359° N", 359.7: "000° N", 360.0: "000° N"}
	var bad := []
	for d in cases:
		if NavCompass.heading_text(d) != cases[d]:
			bad.append("%s -> %s" % [d, NavCompass.heading_text(d)])
	check(bad.is_empty(), "three-digit degrees, degree sign, cardinal (the Driver dash's format); 359.7 is 000° not 360° %s" % [bad])
	check(is_equal_approx(NavCompass.heading_deg(_yaw(90.0)), 90.0) and is_equal_approx(NavCompass.heading_deg(0.0), 0.0)
		and is_equal_approx(NavCompass.heading_deg(_yaw(-10.0)), 350.0), "yaw to compass degrees: -Z is north, east is clockwise")
	var f := ThemeDB.fallback_font
	var widths := []
	for c in "0123456789":
		widths.append(f.get_string_size(c, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x)
	check(f.has_char(0xB0) and widths.min() == widths.max(), "the HUD font has a ° glyph and equal-width digits (%s)" % f.get_font_name())


## Smoothing across north takes the short way: every frame from 359 to 001
## stays within a degree of north, and it gets there.
func test_wrap() -> void:
	print("compass: 359 -> 0 wrap")
	compass.car_yaw = _yaw(359.0)
	var worst := 0.0
	for i in 60:
		compass.step(_yaw(1.0), 1.0 / 60.0)
		worst = maxf(worst, absf(angle_difference(compass.car_yaw, 0.0)))
	check(rad_to_deg(worst) <= 1.01, "359 -> 001 never strays further than %.2f deg from N (not a lap round S)" % rad_to_deg(worst))
	check(compass.text() == "001° N", "and settles on 001° N (%s)" % compass.text())
	compass.car_yaw = _yaw(1.0)
	var worst_back := 0.0
	for i in 60:
		compass.step(_yaw(357.0), 1.0 / 60.0)
		worst_back = maxf(worst_back, absf(angle_difference(compass.car_yaw, _yaw(359.0))))
	check(rad_to_deg(worst_back) <= 2.01 and compass.text() == "357° N", "and back the other way, 001 -> 357 through 000 (%s)" % compass.text())
	check(absf(compass.card_rotation()) <= PI, "card angle stays wrapped to +-180")


## Parks the car facing `deg`, switches to camera `m`, settles a frame.
func _park(deg: float, m: int) -> void:
	var sp: Transform3D = t.track.get_spawn().global_transform
	await t.place(Transform3D(Basis(Vector3.UP, _yaw(deg)), sp.origin))
	compass.snap() # place() teleports behind main's back; its own respawns snap (test_respawn_snaps)
	main.set_camera_mode(m)
	car.frozen = true
	await t.process_frame
	await t.process_frame


func test_cameras() -> void:
	print("compass: three cameras")
	var deg := 123.0
	var want := NavCompass.heading_text(NavCompass.heading_deg(NavCompass.yaw_of(car.global_basis)))
	for m in [FollowCamera.Mode.TOP_DOWN, FollowCamera.Mode.CHASE, FollowCamera.Mode.BONNET]:
		await _park(deg, m)
		var name: String = main.CAMERA_MODES[m]
		var cy := NavCompass.yaw_of(car.global_basis)
		want = NavCompass.heading_text(NavCompass.heading_deg(cy))
		check(compass.is_visible_in_tree() and compass.size.x > 0.0, "%s: compass shown" % name)
		check(compass.text() == want and absf(NavCompass.heading_deg(cy) - deg) < 2.0, "%s: reads the car's heading, %s" % [name, compass.text()])
		check(_near(compass.card_rotation(), -deg_to_rad(deg)), "%s: card turned %.0f° anticlockwise, so 123° sits under the lubber line" % [name, -rad_to_deg(compass.card_rotation())])
	# A turn while driving: the card follows it, smoothed.
	await _park(10.0, FollowCamera.Mode.TOP_DOWN)
	car.frozen = false
	await t.drive(1.2, 1.0, 0.8)
	car.frozen = true # brakes; the car still yaws a little as it stops
	await t.idle(1.5)
	await t.wait_s(0.5)
	var now := NavCompass.heading_deg(NavCompass.yaw_of(car.global_basis))
	check(absf(angle_difference(deg_to_rad(NavCompass.heading_deg(compass.car_yaw)), deg_to_rad(now))) < deg_to_rad(3.0) and absf(now - 10.0) > 15.0,
		"driving: the card keeps up with a turn (car %.0f, compass %.0f)" % [now, NavCompass.heading_deg(compass.car_yaw)])


## C: the top-down camera turning with the car changes nothing on the dial:
## it's the car's heading, whatever the camera does.
func test_rotate_with_car() -> void:
	print("compass: top-down rotating with the car")
	main.cam.rotate_with_car = true
	await _park(200.0, FollowCamera.Mode.TOP_DOWN)
	check(_near(compass.card_rotation(), _yaw(200.0)) and compass.text() == "200° S", "same card, same readout (%s)" % compass.text())
	main.cam.rotate_with_car = false
	main.cam.snap()
	compass.snap()


## A reset (R locally, the server's `reset` in the room) puts the car down
## facing somewhere new: the dial jumps there, no swing round.
func test_respawn_snaps() -> void:
	print("compass: respawn")
	await _park(300.0, FollowCamera.Mode.TOP_DOWN)
	main.recover()
	var want := NavCompass.heading_text(NavCompass.heading_deg(NavCompass.yaw_of(car.global_basis)))
	check(compass.text() == want and want != "300° NW", "after a reset the readout is already the anchor's heading (%s)" % want)
	t._probe_session()


func test_placement() -> void:
	print("compass: placement")
	var vs: Vector2 = main.get_viewport().get_visible_rect().size
	var r := compass.get_global_rect()
	var mr: Rect2 = main.map.get_global_rect()
	check(Rect2(Vector2.ZERO, vs).encloses(r) and r.position.x < vs.x * 0.2 and r.position.y < vs.y * 0.2, "top-left corner, on screen (%s)" % r)
	check(not r.intersects(mr), "clear of the minimap")
	check(r.size.x <= vs.y * 0.2 and r.size.x >= 90.0, "compact but readable: %.0f units across, under a fifth of the screen's height" % r.size.x)
	var centre := vs * 0.5
	check(not r.grow(40.0).has_point(centre), "well clear of the car in the middle")
	await t.process_frame
	await t.process_frame
	check(main.hud.get_global_rect().position.y >= r.end.y, "the probe's debug HUD moves down under it")
	main._on_session({"room": true}, "")
	await t.process_frame
	check(not main.hud.visible and compass.is_visible_in_tree(), "room: debug HUD gone, compass stays")
	t._probe_session()


## Not on the map, not in map-only mode, under the big map's scrim; and with
## the live marker off, nothing it does reaches the map.
func test_maponly_and_map() -> void:
	print("compass: map rules")
	check(not main.map.is_ancestor_of(compass) and compass.get_parent() == main.map.get_parent(), "a sibling of the map, never on it")
	main._on_session({"assists": {"liveMarker": false, "camera3d": false}}, "")
	await t.process_frame
	check(not compass.is_visible_in_tree(), "map only (no 3D camera): no compass")
	main._on_race_event({"kind": "assists", "camera3d": true})
	await t.process_frame
	check(compass.is_visible_in_tree(), "3D back: compass back")
	main.set_map_expanded(true, false)
	var scrim := main.get_node("UI/MapScrim") as Control
	check(scrim.visible and compass.get_index() < scrim.get_index(), "big map open: the scrim dims the compass with the 3D view")
	main.set_map_expanded(false, false)
	await t.process_frame
	var before: Array = t._map_tree_state()
	compass.car_yaw = 1.0
	compass.step(-2.0, 0.1)
	await t.process_frame
	check(t._map_tree_state() == before, "marker off: turning the compass moves nothing on the map")
