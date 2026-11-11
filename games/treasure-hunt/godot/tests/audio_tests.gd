extends RefCounted
## HuntAudio's pure rules, the Synth loops, the mute/volume path, and the
## bridge's sound call. Run from run_tests.gd.

var t ## the runner (run_tests.gd)


func _init(runner) -> void:
	t = runner


func run() -> void:
	print("audio")
	test_step_interval()
	test_ambient_mix()
	test_beep_interval()
	test_synth()
	test_silent_until_start()
	test_sound_settings()
	test_bridge()
	test_tick_drives_players()
	test_hot_cold_bridge()
	test_beep()
	test_one_shots()
	await test_main_wiring()


func check(ok: bool, what: String) -> void:
	t.check(ok, what)


func near(a: float, b: float, eps := 0.01) -> bool:
	return absf(a - b) <= eps


func test_step_interval() -> void:
	check(HuntAudio.step_interval(0.0) == INF and HuntAudio.step_interval(0.49) == INF, "no steps below 0.5 m/s")
	check(near(HuntAudio.step_interval(3.0), 0.5), "walking at 3 m/s steps every 0.5 s")
	check(near(HuntAudio.step_interval(6.0), 0.333), "running at 6 m/s steps every 0.33 s")
	check(HuntAudio.step_interval(0.6) > HuntAudio.step_interval(3.0), "slower steps are further apart")


func test_ambient_mix() -> void:
	var day := HuntAudio.ambient_mix(0.0)
	var night := HuntAudio.ambient_mix(1.0)
	check(day.x > 0.0 and day.y == 1.0 and day.z == 0.0, "day: wind and birds, no crickets")
	check(night.x > 0.0 and night.y == 0.0 and night.z == 1.0, "night: wind and crickets, no birds")
	check(HuntAudio.ambient_mix(0.3).y == 1.0 and HuntAudio.ambient_mix(0.7).y == 0.0, "birds fade out between dark 0.3 and 0.7")
	var mid := HuntAudio.ambient_mix(0.5)
	check(near(mid.y, 0.5) and near(mid.z, 0.5), "halfway at dark 0.5")
	var ok := true
	for i in 21:
		var m := HuntAudio.ambient_mix(i / 20.0)
		ok = ok and m.x >= 0.0 and m.x <= 1.0 and m.y >= 0.0 and m.y <= 1.0 and m.z >= 0.0 and m.z <= 1.0
	check(ok, "every channel stays in 0..1")


func test_beep_interval() -> void:
	check(HuntAudio.beep_interval(-1) == INF, "no beep with no meter")
	check(near(HuntAudio.beep_interval(0), 2.0) and near(HuntAudio.beep_interval(1), 1.2) and near(HuntAudio.beep_interval(2), 0.6) and near(HuntAudio.beep_interval(3), 0.25), "beep gets faster as it gets hotter")


func test_synth() -> void:
	var loops := {
		"engine": Synth.engine(480, 24, [0.55, 0.35, 0.22, 0.14, 0.07], 0.06, 1),
		"noise": Synth.noise(1.2, 0.9, 0.0, 2),
		"wind": Synth.wind(3),
		"birds": Synth.birds(4),
		"crickets": Synth.crickets(5),
	}
	for k in loops:
		var w := loops[k] as AudioStreamWAV
		var secs := float(w.data.size() / 2) / w.mix_rate
		check(w != null and w.loop_mode == AudioStreamWAV.LOOP_FORWARD and w.mix_rate == 22050 and secs < 2.0 and secs > 0.1, "%s loops forward at 22050 Hz, under 2 s" % k)
	check(Synth.step(6).loop_mode == AudioStreamWAV.LOOP_DISABLED, "a step is one shot")
	check(Synth.birds(4).data == Synth.birds(4).data and Synth.wind(3).data == Synth.wind(3).data, "same seed, same bytes")
	check(Synth.birds(4).data != Synth.birds(9).data, "another seed, other bytes")


func _audio() -> HuntAudio:
	var a := HuntAudio.new()
	t.root.add_child(a)
	return a


func _playing(a: HuntAudio) -> int:
	var n := 0
	for c in a.get_children():
		if c is AudioStreamPlayer and (c as AudioStreamPlayer).playing:
			n += 1
	return n


func test_silent_until_start() -> void:
	var a := _audio()
	a.prepare()
	a.tick(0.1, 10.0, true, 3.0, true, 0.0)
	check(a.get_child_count() > 0 and _playing(a) == 0, "prepared, nothing plays before start()")
	a.start()
	a.tick(0.1, 0.0, false, 0.0, true, 0.0)
	check(_playing(a) > 0, "start() brings the ambient up")
	a.queue_free()


func test_sound_settings() -> void:
	var a := _audio()
	a.prepare()
	a.set_sound(true, 0.5)
	check(AudioServer.is_bus_mute(0), "set_sound(true) mutes the master bus")
	a.set_sound(false, 0.5)
	check(not AudioServer.is_bus_mute(0), "set_sound(false) unmutes it")
	check(near(AudioServer.get_bus_volume_db(0), linear_to_db(0.5), 0.001), "volume goes through linear_to_db")
	a.set_sound(false, 0.0)
	check(AudioServer.get_bus_volume_db(0) < -60.0, "volume 0 is near silent, not -inf")
	a.set_sound(false, 1.0)
	a.queue_free()


func test_bridge() -> void:
	var b := WebBridge.new()
	var got: Array = []
	b.sound_set.connect(func(m: bool, v: float) -> void: got.append([m, v]))
	b.receive_sound_json('{"muted":true,"volume":0.4}')
	check(got == [[true, 0.4]], "sound call emits sound_set")
	b.receive_sound_json('{"muted":false,"volume":7}')
	b.receive_sound_json('{"muted":false,"volume":-2}')
	check(got.size() == 3 and got[1][1] == 1.0 and got[2][1] == 0.0, "volume is clamped to 0..1")
	b.receive_sound_json("junk")
	b.receive_sound_json('{"muted":"yes","volume":0.5}')
	b.receive_sound_json('{"muted":true}')
	b.receive_sound_json("[1]")
	check(got.size() == 3, "junk is dropped")
	b.free()


func test_tick_drives_players() -> void:
	var a := _audio()
	a.prepare()
	a.start()
	a.tick(0.1, 15.3, true, 0.0, true, 0.0)
	var eng := a.get_node("Engine") as AudioStreamPlayer
	var grav := a.get_node("Gravel") as AudioStreamPlayer
	check(eng.playing and grav.playing, "driving: engine and gravel play")
	var hi := eng.pitch_scale
	a.tick(0.1, 3.0, true, 0.0, true, 0.0)
	for i in 30:
		a.tick(0.1, 3.0, true, 0.0, true, 0.0)
	check(eng.pitch_scale < hi, "pitch follows speed")
	a.tick(0.1, 0.0, false, 0.0, true, 0.0)
	check(not eng.playing and not grav.playing, "on foot: engine and gravel stop")
	var steps := a.get_node("Steps") as AudioStreamPlayer
	a.tick(0.6, 0.0, false, 3.0, true, 0.0)
	check(steps.playing, "walking on the floor steps")
	steps.stop()
	a.tick(0.6, 0.0, false, 3.0, false, 0.0)
	check(not steps.playing, "no steps in the air")
	a.tick(0.1, 0.0, false, 0.0, true, 1.0)
	check((a.get_node("Crickets") as AudioStreamPlayer).playing and not (a.get_node("Birds") as AudioStreamPlayer).playing, "night: crickets, no birds")
	a.queue_free()


func test_hot_cold_bridge() -> void:
	var b := WebBridge.new()
	var got: Array = []
	b.hot_cold_set.connect(func(l: int) -> void: got.append(l))
	b.receive_hot_cold_json('{"level":2}')
	b.receive_hot_cold_json('{"level":2.0}')
	b.receive_hot_cold_json('{"level":-1}')
	b.receive_hot_cold_json('{"level":0}')
	check(got == [2, 2, -1, 0], "hotCold emits ints for -1..3, floats like 2.0 included")
	for bad in ['{"level":4}', '{"level":-2}', '{"level":"2"}', '{"level":2.5}', '{"level":null}', '{}', 'junk', '[2]']:
		b.receive_hot_cold_json(bad)
	check(got.size() == 4, "out of range, non-number and junk are dropped")
	b.free()


func test_beep() -> void:
	var a := _audio()
	a.prepare()
	a.start()
	var n := [0]
	a.beeped.connect(func(_l: int) -> void: n[0] += 1)
	a.set_hot_cold(3)
	a.tick(1.0, 0.0, false, 0.0, true, 0.0)
	check(n[0] == 4, "level 3 beeps 4 times in 1 s (got %d)" % n[0])
	a.set_hot_cold(-1)
	n[0] = 0
	a.tick(5.0, 0.0, false, 0.0, true, 0.0)
	check(n[0] == 0, "no meter, no beep")
	a.set_hot_cold(0)
	a.tick(1.9, 0.0, false, 0.0, true, 0.0)
	check(n[0] == 0, "level 0 waits its 2 s")
	a.tick(0.2, 0.0, false, 0.0, true, 0.0)
	check(n[0] == 1, "then beeps")
	var bp := a.get_node("Beep") as AudioStreamPlayer
	a.set_hot_cold(3)
	a.tick(0.25, 0.0, false, 0.0, true, 0.0)
	check(near(bp.pitch_scale, pow(2.0, 3.0 / 12.0), 0.001), "level 3 is three semitones up")
	var cold := _audio()
	cold.prepare()
	var m := [0]
	cold.beeped.connect(func(_l: int) -> void: m[0] += 1)
	cold.set_hot_cold(3)
	cold.tick(1.0, 0.0, false, 0.0, true, 0.0)
	check(m[0] == 0, "no beep before start()")
	a.queue_free()
	cold.queue_free()


func test_one_shots() -> void:
	var a := _audio()
	a.prepare()
	var got: Array = []
	a.pinged.connect(func(k: StringName) -> void: got.append(k))
	a.ping(&"reveal")
	check((a.get_node("Reveal") as AudioStreamPlayer).stream is AudioStreamWAV and not (a.get_node("Reveal") as AudioStreamPlayer).playing, "built silent")
	a.start()
	a.ping(&"reveal")
	a.ping(&"claim")
	check((a.get_node("Reveal") as AudioStreamPlayer).playing and (a.get_node("Claim") as AudioStreamPlayer).playing, "started: both play")
	check(got == [&"reveal", &"reveal", &"claim"], "pings are reported")
	a.queue_free()


func test_main_wiring() -> void:
	var main: Node3D = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	t.root.add_child(main)
	var a: HuntAudio = main.hunt_audio
	check(a != null and a.built and not a.started, "main prepares the audio but does not start it")
	var k := InputEventKey.new()
	k.pressed = true
	k.keycode = KEY_W
	main._unhandled_input(k)
	check(a.started, "the first key press starts it")
	main.bridge.receive_sound_json('{"muted":true,"volume":0.5}')
	check(AudioServer.is_bus_mute(0), "the bridge's sound call reaches the audio")
	main.bridge.receive_sound_json('{"muted":false,"volume":1}')
	var pings: Array = []
	a.pinged.connect(func(kind: StringName) -> void: pings.append(kind))
	var rv := {"id": "c1", "x": 1.0, "z": 2.0, "dy": 0.0}
	# Just after world-ready: the page's replay is silent, but remembered.
	main._world_ready_at = Time.get_ticks_msec()
	main.bridge.cache_revealed.emit(rv)
	main.bridge.receive_found_json('{"id":"c1","mine":true}')
	check(pings.is_empty(), "reveals and finds within 2 s of world-ready don't ping")
	main._world_ready_at = Time.get_ticks_msec() - int(main.PING_SETTLE_S * 1000.0) - 100
	main.bridge.cache_revealed.emit(rv)
	main.bridge.receive_found_json('{"id":"c1"}')
	check(pings.is_empty(), "ids seen in the window never ping later")
	main.bridge.cache_revealed.emit({"id": "c2", "x": 1.0, "z": 2.0, "dy": 0.0})
	main.bridge.cache_revealed.emit({"id": "c2", "x": 1.0, "z": 2.0, "dy": 0.0})
	check(pings == [&"reveal"], "a new id after 2 s pings once")
	main.bridge.receive_found_json('{"id":"c3","mine":false}')
	check(pings == [&"reveal"], "a take by another team (mine: false) doesn't chime")
	main.bridge.receive_found_json('{"id":"c3","mine":true}')
	check(pings == [&"reveal"], "and its id stays known")
	main.bridge.receive_found_json('{"id":"c4"}')
	main.bridge.receive_found_json('{"id":"c4","mine":true}')
	check(pings == [&"reveal", &"claim"], "mine defaults to true; a find chimes once")
	main.bridge.receive_hot_cold_json('{"level":3}')
	check(a.hot_level == 3, "the bridge's hotCold reaches the audio")
	main.bridge.receive_hot_cold_json('{"level":-1}')
	main.queue_free()
	await t.process_frame
