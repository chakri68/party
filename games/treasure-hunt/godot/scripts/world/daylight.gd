class_name Daylight
extends Node
## Turns a game minute into light: the sun's direction and strength, a dim
## fixed moon, ambient, sky and fog colours. Reads DayClock's model, holds
## no clock of its own.
##
## The day colours are whatever the scene had at setup, so at dark 0 with
## the sun well up (10:00, say) the look is exactly today's. The night
## palette comes in with the dark; a warm horizon shows around sunset and
## sunrise, while the sun is between WARM_LOW and WARM_HIGH.

const MOON_AZ := 200.0
const MOON_EL := 35.0
const MOON_ENERGY := 0.15 ## at full dark; never pitch black (spec §7.4)
const AMBIENT_DAY := 0.8
const AMBIENT_NIGHT := 0.25
const NIGHT_TOP := Color("#0b1530")
const NIGHT_HORIZON := Color("#1a2440")
const NIGHT_FOG := Color("#141c30")
const WARM := Color("#e89a5a")
const WARM_LOW := -6.0
const WARM_HIGH := 10.0
## How much of WARM the horizon takes at the peak (halfway up the band).
## The fog takes half that, the sun's colour a third. Tuned by eye.
const WARM_PEAK := 0.7
## main skips a re-apply closer than this to the last (minutes): the sun
## moves 0.25 degrees a minute, and every sky change re-bakes the radiance.
const APPLY_EPS := 0.05

var sun: DirectionalLight3D
var moon: DirectionalLight3D
var env: Environment
var sky: ProceduralSkyMaterial

var _day_top: Color
var _day_horizon: Color
var _day_ground_horizon: Color
var _day_ground_bottom: Color
var _day_fog: Color
var _day_sun: Color
var _applied := NAN


func setup(s: DirectionalLight3D, m: DirectionalLight3D, e: Environment, k: ProceduralSkyMaterial) -> void:
	sun = s
	moon = m
	env = e
	sky = k
	_day_top = sky.sky_top_color
	_day_horizon = sky.sky_horizon_color
	_day_ground_horizon = sky.ground_horizon_color
	_day_ground_bottom = sky.ground_bottom_color
	_day_fog = env.fog_light_color
	_day_sun = sun.light_color
	moon.shadow_enabled = false
	moon.basis = Basis.looking_at(-toward(MOON_AZ, MOON_EL), Vector3.UP)


## Unit vector from the ground toward a body at compass bearing `az`, `el`
## degrees up (north is -Z, east +X). A light shines the other way.
static func toward(az: float, el: float) -> Vector3:
	var a := deg_to_rad(az)
	var e := deg_to_rad(el)
	return Vector3(sin(a) * cos(e), sin(e), -cos(a) * cos(e))


## 0 outside WARM_LOW..WARM_HIGH, 1 halfway, a tent between.
static func warmth(el: float) -> float:
	var mid := (WARM_LOW + WARM_HIGH) / 2.0
	return clampf(1.0 - absf(el - mid) / ((WARM_HIGH - WARM_LOW) / 2.0), 0.0, 1.0)


## apply, unless the last one was within APPLY_EPS minutes.
func update(m: float) -> void:
	if is_nan(_applied) or absf(m - _applied) >= APPLY_EPS:
		apply(m)


func apply(m: float) -> void:
	_applied = m
	var s := DayClock.sun_at(m)
	var dark := DayClock.dark_at(m)
	var w := warmth(s.y) * WARM_PEAK
	sun.basis = Basis.looking_at(-toward(s.x, s.y), Vector3.UP)
	# Nothing from below the horizon: the sun lights only while it is up.
	sun.light_energy = (1.0 - dark) if s.y >= 0.0 else 0.0
	sun.shadow_enabled = s.y > 0.0
	sun.light_color = _day_sun.lerp(WARM, w / 3.0)
	moon.light_energy = MOON_ENERGY * dark
	moon.visible = dark > 0.0
	env.ambient_light_energy = lerpf(AMBIENT_DAY, AMBIENT_NIGHT, dark)
	sky.sky_top_color = _day_top.lerp(NIGHT_TOP, dark)
	sky.sky_horizon_color = _day_horizon.lerp(NIGHT_HORIZON, dark).lerp(WARM, w)
	sky.ground_horizon_color = _day_ground_horizon.lerp(NIGHT_HORIZON, dark).lerp(WARM, w)
	sky.ground_bottom_color = _day_ground_bottom.lerp(NIGHT_FOG, dark)
	env.fog_light_color = _day_fog.lerp(NIGHT_FOG, dark).lerp(WARM, w / 2.0)
