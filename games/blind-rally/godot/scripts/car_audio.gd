class_name CarAudio
extends Node
## Engine, gravel, skid and impact sounds. All synthesized once at load into
## short looping AudioStreamWAVs; per frame only pitch and volume move.
##
## Why not AudioStreamGenerator: the Web export plays through Web Audio
## "samples" (single-threaded builds would crackle otherwise), and sample
## playback can't run procedural generators. Pre-rendered loops play fine
## there and cost nothing per frame.
##
## Nothing plays until start(), which main.gd calls on the first user gesture
## (browsers block audio before one). Kept quiet on purpose (spec §10).

const RATE := 22050
const MAX_DB := -8.0

## 0..1 master level, on top of the per-sound mix.
@export var volume := 0.8
var muted := false:
	set(v):
		muted = v
		_apply_master()
var started := false

var _car: CarController
var _engine: AudioStreamPlayer
var _gravel: AudioStreamPlayer
var _skid: AudioStreamPlayer
var _thump: AudioStreamPlayer
var _rng := RandomNumberGenerator.new()
var _rpm := 0.0
var _gear := 1
var _bus := 0


func _ready() -> void:
	_car = get_parent() as CarController
	_rng.seed = 99
	if _car:
		_car.impact.connect(_on_impact)


## Builds the sounds and starts the loops. Safe to call more than once.
func start() -> void:
	if started:
		return
	started = true
	_engine = _player("Engine", _make_engine(), true)
	_gravel = _player("Gravel", _make_noise(1.2, 0.9, 0.0), true)
	_skid = _player("Skid", _make_noise(0.8, 0.35, 900.0), true)
	_thump = _player("Thump", _make_thump(), false)
	_thump.max_polyphony = 2
	for p in [_engine, _gravel, _skid]:
		p.volume_db = -60.0
		p.play()
	_apply_master()


func _player(n: String, stream: AudioStream, loop: bool) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.name = n
	p.stream = stream
	p.bus = &"Master"
	add_child(p)
	return p


func _apply_master() -> void:
	AudioServer.set_bus_mute(_bus, muted)
	AudioServer.set_bus_volume_db(_bus, linear_to_db(maxf(volume, 0.0001)))


func _process(dt: float) -> void:
	if not started or not _car:
		return
	var speed := Vector2(_car.velocity.x, _car.velocity.z).length()
	var top := _car.max_speed
	# Fake gearbox: five gears over the speed range, rpm sweeps within each.
	var v := clampf(absf(_car.forward_speed) / top, 0.0, 1.0)
	var gear_f := v * 4.6
	_gear = clampi(int(gear_f) + 1, 1, 5)
	var in_gear := gear_f - (_gear - 1)
	var target_rpm := lerpf(0.28, 1.0, clampf(in_gear, 0.0, 1.0)) if v > 0.02 else 0.22
	target_rpm = maxf(target_rpm, 0.22 + 0.45 * _car.throttle_input * (1.0 - v)) # revs on a standing start
	# Wheelspin in a slide revs it up a touch.
	target_rpm = minf(1.0, target_rpm + clampf(absf(_car.lateral_speed) / 20.0, 0.0, 0.15) * _car.throttle_input)
	_rpm = lerpf(_rpm, target_rpm, 1.0 - exp(-(10.0 if target_rpm > _rpm else 5.0) * dt))
	_engine.pitch_scale = lerpf(0.75, 2.6, _rpm)
	_engine.volume_db = MAX_DB - 8.0 + 6.0 * _car.throttle_input + 3.0 * _rpm

	var loose := _car.surface in ["road", "offroad", "sand"]
	var g := clampf(speed / top, 0.0, 1.0) * (1.0 if loose else 0.3)
	_gravel.volume_db = linear_to_db(maxf(g * 0.55, 0.0001)) + MAX_DB
	_gravel.pitch_scale = lerpf(0.8, 1.25, g)
	var slide := clampf((absf(_car.lateral_speed) - 2.0) / 7.0, 0.0, 1.0)
	_skid.volume_db = linear_to_db(maxf(slide * 0.5, 0.0001)) + MAX_DB
	_skid.pitch_scale = lerpf(0.85, 1.1, slide)


func _on_impact(strength: float, _who: Object) -> void:
	if not started:
		return
	var k := clampf(strength / 15.0, 0.15, 1.0)
	_thump.volume_db = MAX_DB - 2.0 + linear_to_db(k)
	_thump.pitch_scale = _rng.randf_range(0.85, 1.1)
	_thump.play()


# --- synthesis -------------------------------------------------------------------

func _wav(samples: PackedFloat32Array, loop: bool) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for i in samples.size():
		data.encode_s16(i * 2, int(clampf(samples[i], -1.0, 1.0) * 32000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = data
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = samples.size()
	return w


## Four-cylinder-ish buzz at ~55 Hz; pitch_scale does the revving. The loop
## holds a whole number of cycles, so it repeats without a click.
func _make_engine() -> AudioStreamWAV:
	const PERIOD := 400 # samples per cycle: 22050 / 400 = 55.1 Hz
	const CYCLES := 24
	var s := PackedFloat32Array()
	s.resize(PERIOD * CYCLES)
	var lp := 0.0
	for i in s.size():
		var ph := TAU * float(i % PERIOD) / PERIOD
		var cyc := i / PERIOD
		# Two firing pulses per cycle, slightly uneven, plus harmonics.
		var lumpy := 1.0 + 0.12 * sin(TAU * cyc / CYCLES * 3.0)
		var x := 0.55 * sin(ph) + 0.35 * sin(2.0 * ph + 0.4) * lumpy + 0.22 * sin(3.0 * ph + 1.1) + 0.14 * sin(4.0 * ph) + 0.07 * sin(6.0 * ph + 0.5)
		var pulse := pow(maxf(0.0, sin(2.0 * ph)), 6.0) * 0.35
		var hiss := _rng.randf_range(-1.0, 1.0) * 0.06
		lp += 0.35 * ((x + pulse + hiss) - lp)
		s[i] = lp * 0.55
	return _wav(s, true)


## Noise loop. lowpass 0..1 smooths it (gravel rumble), band > 0 adds a
## resonant peak at that frequency (tyre squeal over loose stuff).
func _make_noise(seconds: float, lowpass: float, band: float) -> AudioStreamWAV:
	var count := int(seconds * RATE)
	var s := PackedFloat32Array()
	s.resize(count)
	var lp := 0.0
	var y1 := 0.0
	var y2 := 0.0
	var w := TAU * band / RATE
	var r := 0.985
	for i in count:
		var x := _rng.randf_range(-1.0, 1.0)
		# Crunch: occasional louder grains.
		if band == 0.0 and _rng.randf() < 0.004:
			x *= 4.0
		lp += lowpass * (x - lp)
		var out := lp
		if band > 0.0:
			var y := lp + 2.0 * r * cos(w) * y1 - r * r * y2
			y2 = y1
			y1 = y
			out = y * 0.05
		s[i] = out * 0.6
	# Crossfade the tail into the head so the loop point doesn't click.
	var fade := int(0.05 * RATE)
	for i in fade:
		var t := float(i) / fade
		s[i] = s[i] * t + s[count - fade + i] * (1.0 - t)
	s.resize(count - fade)
	return _wav(s, true)


## Soft low thump: a falling sine and a short noise burst, 0.35 s.
func _make_thump() -> AudioStreamWAV:
	var count := int(0.35 * RATE)
	var s := PackedFloat32Array()
	s.resize(count)
	var ph := 0.0
	var lp := 0.0
	for i in count:
		var t := float(i) / RATE
		var f := lerpf(110.0, 45.0, minf(t / 0.2, 1.0))
		ph += TAU * f / RATE
		var env := exp(-t * 14.0)
		lp += 0.25 * (_rng.randf_range(-1.0, 1.0) - lp)
		s[i] = (sin(ph) * 0.8 + lp * exp(-t * 40.0) * 0.9) * env * minf(1.0, t * 400.0)
	return _wav(s, false)
