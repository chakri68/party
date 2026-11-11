class_name HuntAudio
extends Node
## The hunt's sound: the buggy's engine and gravel, footsteps, and an ambient
## bed (wind, birds by day, crickets by night). Loops are pre-rendered by
## Synth; per frame only pitch and volume move.
##
## prepare() builds the players, silent, behind the loader. Nothing plays
## until start(), which main.gd calls on the first key or mouse press
## (browsers hold audio until a gesture). Kept quiet on purpose: MAX_DB.
## Everything plays on the "Hunt" bus under Master; the page's mute and
## volume land on Master. On the web, Master stays muted until the page's
## first sound call (hold_for_page), so a muted player never hears a blip.

const MAX_DB := -8.0
## Below this a player is off: stopped, not just quiet.
const SILENT_DB := -80.0
## The buggy is slow and big-tyred: a low note. 22050 / 480 = 46 Hz.
const PERIOD := 480
const CYCLES := 24
const HARMONICS: Array[float] = [0.55, 0.35, 0.22, 0.14, 0.07]
const GRIT := 0.08
const PITCH := Vector2(0.8, 2.2)
## The buggy's top speed, for the pitch when no buggy tells us.
const TOP_SPEED := 15.3
const BUS := &"Hunt"
## Per-sound levels before MAX_DB.
const WIND_MIX := 0.4
const BIRDS_MIX := 0.5
const CRICKETS_MIX := 0.3
const GRAVEL_MIX := 0.5
const STEP_MIX := 0.5
const PING_MIX := 0.6
const BEEP_MIX := 0.4
## The beep's base note; each level lifts it a semitone.
const BEEP_HZ := 880.0

var started := false
var built := false
## The meter level, -1..3. The beep rides on it.
var hot_level := -1
## Master is muted until the page's first set_sound.
var held := false

## A one-shot was asked for (played only once started). For tests and the like.
signal pinged(kind: StringName)
## The hot/cold beep fired at this level.
signal beeped(level: int)

var _engine: AudioStreamPlayer
var _gravel: AudioStreamPlayer
var _steps: AudioStreamPlayer
var _wind: AudioStreamPlayer
var _birds: AudioStreamPlayer
var _crickets: AudioStreamPlayer
var _reveal: AudioStreamPlayer
var _claim: AudioStreamPlayer
var _beep: AudioStreamPlayer
var _beep_t := 0.0
var _rpm := 0.0
var _step_t := 0.0
var _rng := RandomNumberGenerator.new()


## Seconds between steps at `speed` m/s: INF when basically still.
## 0.5 s at a walk (3 m/s), 0.33 s at a run (6 m/s), never faster than 0.25.
static func step_interval(speed: float) -> float:
	if speed < 0.5:
		return INF
	return maxf(0.25, 2.0 / 3.0 - speed / 18.0)


## (wind, birds, crickets), each 0..1. Birds go out and crickets come in
## between dark 0.3 and 0.7.
static func ambient_mix(dark: float) -> Vector3:
	var night := smoothstep(0.3, 0.7, dark)
	return Vector3(0.6 + 0.4 * clampf(dark, 0.0, 1.0), 1.0 - night, night)


## Seconds between hot/cold beeps: INF for no meter (-1).
static func beep_interval(level: int) -> float:
	match level:
		0: return 2.0
		1: return 1.2
		2: return 0.6
		3: return 0.25
	return INF


func _ready() -> void:
	_rng.seed = 7


## Builds the bus, the players and their loops, silent. Safe to call twice.
func prepare() -> void:
	if built:
		return
	built = true
	if AudioServer.get_bus_index(BUS) < 0:
		AudioServer.add_bus()
		var i := AudioServer.bus_count - 1
		AudioServer.set_bus_name(i, BUS)
		AudioServer.set_bus_send(i, &"Master")
	_engine = _player("Engine", Synth.engine(PERIOD, CYCLES, HARMONICS, GRIT, 11))
	_gravel = _player("Gravel", Synth.noise(1.2, 0.9, 0.0, 12))
	_steps = _player("Steps", Synth.step(13))
	_steps.max_polyphony = 2
	_wind = _player("Wind", Synth.wind(14))
	_birds = _player("Birds", Synth.birds(15))
	_crickets = _player("Crickets", Synth.crickets(16))
	# Rising two notes (A5, E6); a major arpeggio (C5, E5, G5); one short A5.
	_reveal = _player("Reveal", Synth.notes([880.0, 1318.5], 0.11, 0.25))
	_claim = _player("Claim", Synth.notes([523.25, 659.25, 784.0], 0.1, 0.4))
	_beep = _player("Beep", Synth.notes([BEEP_HZ], 0.09, 0.03))


## The first gesture: the ambient comes up (tick sets its level).
func start() -> void:
	prepare()
	started = true


## Mutes Master until the first set_sound: the page hasn't said yet whether
## this player has sound off. main.gd calls it on the web only; off-web
## there's no page to ask.
func hold_for_page() -> void:
	held = true
	AudioServer.set_bus_mute(0, true)


## The page's mute and volume (0..1). On Master, so it covers everything.
func set_sound(muted: bool, volume: float) -> void:
	held = false
	AudioServer.set_bus_mute(0, muted)
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(volume, 0.0001)))


func set_hot_cold(level: int) -> void:
	hot_level = clampi(level, -1, 3)
	_beep_t = minf(_beep_t, beep_interval(hot_level))


## A one-shot: &"reveal" (a cache showed up) or &"claim" (my team found one).
## Silent until start().
func ping(kind: StringName) -> void:
	pinged.emit(kind)
	if not started:
		return
	var p := _reveal if kind == &"reveal" else (_claim if kind == &"claim" else null)
	if p != null:
		p.volume_db = _db(PING_MIX)
		p.play()


func _beep_now() -> void:
	beeped.emit(hot_level)
	_beep.pitch_scale = pow(2.0, hot_level / 12.0)
	_beep.volume_db = _db(BEEP_MIX)
	_beep.play()


## Every frame. buggy_speed is m/s along the buggy (signed), driving whether
## it's mine to drive; walk_speed the walker's flat speed (0 when you're not
## walking). A spectator passes false and 0: the ambient only.
func tick(dt: float, buggy_speed: float, driving: bool, walk_speed: float, on_floor: bool, dark: float) -> void:
	if not started:
		return
	var mix := ambient_mix(dark)
	_drive(_wind, _db(mix.x * WIND_MIX))
	_drive(_birds, _db(mix.y * BIRDS_MIX))
	_drive(_crickets, _db(mix.z * CRICKETS_MIX))
	if driving:
		var v := clampf(absf(buggy_speed) / TOP_SPEED, 0.0, 1.0)
		_rpm = lerpf(_rpm, v, 1.0 - exp(-6.0 * dt))
		_engine.pitch_scale = lerpf(PITCH.x, PITCH.y, _rpm)
		_drive(_engine, MAX_DB - 8.0 + 3.0 * _rpm)
		_gravel.pitch_scale = lerpf(0.8, 1.25, v)
		_drive(_gravel, _db(v * GRAVEL_MIX) if v > 0.02 else SILENT_DB)
	else:
		_rpm = 0.0
		_drive(_engine, SILENT_DB)
		_drive(_gravel, SILENT_DB)
	var every := beep_interval(hot_level)
	if every < INF:
		# Clamped: a long frame (a tab back from the background) is one beep, not a burst.
		_beep_t = minf(_beep_t + dt, every)
		if _beep_t >= every:
			_beep_t -= every
			_beep_now()
	else:
		_beep_t = 0.0
	var gap := step_interval(walk_speed)
	if on_floor and not driving and gap < INF:
		_step_t += dt
		if _step_t >= gap:
			_step_t = 0.0
			_steps.volume_db = _db(STEP_MIX)
			_steps.pitch_scale = _rng.randf_range(0.85, 1.15)
			_steps.play()
	else:
		_step_t = gap * 0.5 if gap < INF else 0.0


func _db(linear: float) -> float:
	return SILENT_DB if linear <= 0.0 else linear_to_db(linear) + MAX_DB


## Plays p at db, or stops it at SILENT_DB.
func _drive(p: AudioStreamPlayer, db: float) -> void:
	if db <= SILENT_DB:
		if p.playing:
			p.stop()
		return
	p.volume_db = db
	if not p.playing:
		p.play()


func _player(n: String, stream: AudioStream) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.name = n
	p.stream = stream
	p.bus = BUS
	add_child(p)
	return p
