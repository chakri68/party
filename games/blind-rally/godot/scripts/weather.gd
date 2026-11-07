class_name Weather
extends Node3D
## Clouds over the stage: drifting cloud shadows on everything, and low mist
## banks that hide stretches of road for a few seconds at a time. 3D view
## only, never the static map (spec: modifiers change the 3D view, not the map).
##
## Cloud shadows aren't geometry: every world material (ground, road, the
## palette shared by trees, props and the car, the eye-level forest) carries
## the cloud term, shaders/weather.gdshaderinc, and Weather pushes the
## numbers to whatever was register()ed. Same for the eye-level mist. Those
## shaders skip both when the camera can't see render layer 4, which is how
## the map camera stays clean.
##
## Mist looks different per camera, from the same banks:
## - Top-down: soft puff sprites at treetop height (the Mist node, layer 4),
##   with a clear hole round the car.
## - Chase and bonnet (eye_level): the sprites would float overhead hiding
##   nothing, so they're hidden and the nearest MIST_MAX puffs go to the
##   shaders as ground-hugging discs; each pixel fogs by how much bank its
##   view ray crosses past the car.
##
## Deterministic: configure(seed, clouds) plus the race clock fully decide
## where every bank is and how thick it is, so every team in a Fair Race gets
## the same weather at the same moment of their run. Banks don't spawn around
## the car; they live in world space, drift with one seeded wind and fade in
## and out on their own slow cycles.
##
## Readability guarantees: opacity is capped, every bank fades over several
## seconds (no pops, no flashing), and the mist shader keeps a clear hole
## around the car, so it can lose the road but never the car.
##
## Biomes (set_biome): the same banks are mist in the forest and dust in
## the desert canyon: a warm tint, a stronger wind (so they stream past
## instead of drifting), lower over the ground, and paler cloud shade, since
## a dust storm dims the sun rather than casting crisp cloud shadows. Same
## seed, same storm, for every team. Snow: the banks are blowing snow (white,
## low and quick, like the dust), and flakes fall through a box round the
## car (shaders/snowfall.gdshader: one draw call, moved in the shader), as
## thick as the clouds say times a seeded share. They drift on the same wind
## as the banks and run on the race clock, so every team gets the same
## snow; clouds 0 is a clear day here too. Fog (the coast): sea fog,
## the same banks again, but bigger, slower, lower, greyer and denser in the
## middle, drifting onshore (Biome.wind_heading_deg, swung a little by the
## seed) so they roll in off the water and across the cliff road. The
## readability caps hold: same MAX_ALPHA, same keyholes.
##
## Night (the SkyClock's light): the same path again. set_sky() hands
## sky_dark and sky_tint to every registered material (weather.gdshaderinc
## sky_light(): a multiply, gated like the clouds; their mist glow takes
## sky_haze()), and the haze (SkyClock.haze: the tint, dimmed with the
## dark) as `sky_tint` to the unshaded ones: the mist and snow sprites
## here, and whatever was register_tinted() (the treeline, far landmarks).
## Late registrations get the current values, like the clouds.
##
## Headlights ride the same path: head_on is the darkness (set_sky), and
## while it's above 0 every frame pushes head_pos and head_dir from the
## car's interpolated transform, and the rivals' ghost_heads as GhostCars
## hands them over. By day nothing is pushed per frame: head_on 0 makes
## the shaders skip the headlight terms, so stale positions are harmless.
## The landmarks' glows (set_glows) get night_boost = the darkness.
##
## Rain rides it too: set_wet() hands the road's wetness (SkyClock.wetness,
## not the rain: the road lags it) to every registered material as sky_wet,
## and set_puddles() the stage's puddles (Puddles.place) once per session.
## Both only when they change, so a dry or steady sky pushes nothing per
## frame. Snow: rain falls as snow, so the ground never looks wet (sky_wet
## stays 0) and there are no puddles to draw.
##
## And you see it fall: set_rain() (SkyClock.rain, not the wetness) shows
## round(rain * MAX_DROPS) streaks of one MultiMesh (shaders/rain.gdshader:
## one draw, moved in the shader, like the snow), set only when the rain
## moves. While it rains the box follows the camera, and the streaks hide
## while the camera's in a tunnel bore (tunnels, from main): the only
## per-frame work, and none on a dry run. Snow: no streaks; the rain adds
## to the snowfall instead (snowfall = base + rain * RAIN_SNOW, at most 1).

const LAYER := 8 ## render layer 4
const BANK_PUFFS := 5
const BANK_HEIGHT := 16.0 ## metres above the car's ground: in the treetops, well under the camera
const MAX_BANKS := 48
const KEYHOLE := Vector2(3.5, 9.0) ## mist-free radius round the car, and where it's back to full
const MAX_ALPHA := 0.78 ## thickest mist still lets the road show through a little
const EYE_KEYHOLE := Vector2(4.0, 18.0) ## eye level: clear for x metres past the car, full by y (a slow ramp, so no wall)
const MIST_MAX := 16 ## puffs the eye-level shaders get (weather.gdshaderinc MIST_MAX)
const MIST_RANGE := 150.0 ## metres: puffs further than this from the camera fade out of the list
const MIST_DENSITY := 0.075 ## per metre of bank crossed at full opacity
const MIST_TOP := 11.0 ## metres above the car where the eye-level mist has thinned out
const MIST_TINT := Color(0.8, 0.83, 0.85)
const SHADE_SCALE := 180.0 ## metres per cloud-noise tile; keep in sync with weather.gdshaderinc
const MAX_FLAKES := 2400 ## at snowfall 1
const FALL := 1.6 ## m/s a flake drops
const FLAKE_WIND := 0.45 ## share of the bank wind the flakes drift with (they're near the ground, in the lee)
const MAX_DROPS := 3000 ## rain streaks at rain 1
const DROP_FALL := 9.0 ## m/s a raindrop drops
const DROP_WIND := 0.8 ## share of the bank wind the drops slant with
const RAIN_SNOW := 0.6 ## snowfall that rain 1 adds where it snows
## The rain box, its streaks, and how far ahead of the eye it sits: at eye
## level a small box round the lens; top-down a wide one round the car, and
## fatter streaks, since a metre there is a few pixels.
const RAIN_EYE := {"box": Vector3(30.0, 16.0, 30.0), "width": 0.018, "streak": 0.7, "ahead": 8.0}
const RAIN_TOP := {"box": Vector3(80.0, 40.0, 80.0), "width": 0.07, "streak": 1.6, "ahead": 0.0}

@export var clouds := 0.0 ## 0 = clear, 1 = heavy
var seed_value := 0
var sky: SkyClock ## the run clock, once a session attaches one
var _own_time := 0.0 ## the clock without a sky (tests, local runs): physics time
## Seconds of race clock: the sky's when attached, else Weather's own counter.
var time: float:
	get: return sky.clock if sky else _own_time
	set(v):
		_own_time = v
		if sky:
			sky.clock = v

var car: Node3D
## Chase and bonnet: mist goes to the shaders as ground-hugging banks and the
## overhead puff sprites hide. main sets it with the camera mode.
var eye_level := false:
	set(v):
		eye_level = v
		if _mist:
			_mist.visible = clouds > 0.0 and not v
		_rain_view()
		_push_mist()
var bounds := Rect2(-500, -500, 1000, 1000)
## "mist", "dust" or "snow" (Biome.weather); set_biome() sets these.
var style := "mist"
var tint := MIST_TINT
var wind_k := 1.0
var bank_height := BANK_HEIGHT
var shade_k := 1.0
var size_k := 1.0 ## puff size multiplier (sea fog banks are bigger)
var heading := -1.0 ## radians the banks drift toward; < 0: the seed's
## How hard it's snowing, 0..1: clouds times a seeded share (snow biome
## only), plus what the rain adds there.
var snowfall := 0.0
var rain := 0.0 ## SkyClock.rain as set_rain() last had it
## The stage's tunnel roofs (main, at track setup): no rain in their bores.
var tunnels: Array[TunnelRoof] = []
var rain_sets := 0 ## times the drop count was set, for tests: none per frame on a steady rain

var _wind := Vector2.ZERO
var _banks: Array = [] # {origin: Vector2, phase, period, thick, puffs: [[offset Vector2, size]]}
var _mats: Array[ShaderMaterial] = []
var _cloud := {} # shader parameter -> value, for materials registered later
var _sky := {"sky_dark": 0.0, "sky_tint": Color(1, 1, 1)} # the same, for the light
var _tinted: Array[ShaderMaterial] = [] # unshaded: sky_tint only
var _glows: Array[ShaderMaterial] = [] # glow.gdshader: night_boost only
var _wet := 0.0 # sky_wet the materials have
var _puddles := PackedVector3Array() # (x, z, radius), the materials have them
var rain_pushes := 0 ## sky_wet / puddle pushes so far, for tests: none per frame on a steady sky
var _ghost_heads := PackedVector4Array() # (x, z, yaw, strength), GhostCars' last
var _ghost_sent := -1 # ghost_head_count the materials have; -1: unknown
var _eye_puffs := PackedVector4Array() # what the shaders got last, for the CPU mirror
var _mist: MultiMeshInstance3D
var _mist_mat: ShaderMaterial
var _mm: MultiMesh
var _snow: MultiMeshInstance3D
var _snow_mat: ShaderMaterial
var _snow_base := 0.0 # the seed's snowfall, before the rain
var _rain: MultiMeshInstance3D
var _rain_mat: ShaderMaterial
var _rain_hidden := false # in a bore


func _ready() -> void:
	_mist_mat = ShaderMaterial.new()
	_mist_mat.shader = preload("res://shaders/mist.gdshader")
	_mist_mat.set_shader_parameter("detail", DetailNoise.texture())
	_mist_mat.render_priority = 1
	_mist_mat.set_shader_parameter("keyhole", KEYHOLE)
	_mist_mat.set_shader_parameter("max_alpha", MAX_ALPHA)
	_mist_mat.set_shader_parameter("sky_tint", haze())
	var puff := PlaneMesh.new()
	puff.size = Vector2(1, 1)
	puff.material = _mist_mat
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.use_colors = true
	_mm.use_custom_data = true
	_mm.mesh = puff
	_mm.instance_count = MAX_BANKS * BANK_PUFFS
	_mm.visible_instance_count = 0
	_mist = MultiMeshInstance3D.new()
	_mist.name = "Mist"
	_mist.multimesh = _mm
	_mist.layers = LAYER
	_mist.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Puffs move every frame anywhere on the stage; skip per-frame AABB work.
	_mist.custom_aabb = AABB(Vector3(-5000, -100, -5000), Vector3(10000, 300, 10000))
	add_child(_mist)
	configure(seed_value, clouds)


## The stage's weather flavour. Call before configure(); materials
## registered before or after get the tint.
func set_biome(b: Biome) -> void:
	style = b.weather
	tint = b.weather_tint
	wind_k = b.wind
	bank_height = BANK_HEIGHT * (0.55 if style in ["dust", "snow"] else (0.7 if style == "fog" else 1.0))
	shade_k = 0.55 if style == "dust" else (0.8 if style == "snow" else (0.7 if style == "fog" else 1.0))
	size_k = 1.45 if style == "fog" else 1.0
	heading = deg_to_rad(b.wind_heading_deg) if b.wind_heading_deg >= 0.0 else -1.0
	if style == "snow" and _snow == null:
		_build_snowfall()
	if style != "snow" and _rain == null:
		_build_rain()
	if _mist_mat:
		_mist_mat.set_shader_parameter("tint", tint.lightened(0.08))
	for m in _mats:
		m.set_shader_parameter("mist_tint", tint)
	configure(seed_value, clouds)


## Same seed + same clouds = same weather. clouds 0 turns it all off.
func configure(seed_in: int, clouds_in: float) -> void:
	seed_value = seed_in
	clouds = clampf(clouds_in, 0.0, 1.0)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_in
	var dir := rng.randf() * TAU
	if heading >= 0.0:
		# Onshore, swung up to ~25 degrees by the same number.
		dir = heading + (dir / TAU - 0.5) * deg_to_rad(50.0)
	_wind = Vector2(cos(dir), sin(dir)) * rng.randf_range(2.5, 5.5) * wind_k
	_banks.clear()
	var count := roundi(clouds * MAX_BANKS)
	var area := bounds.grow(80.0)
	for b in MAX_BANKS:
		# Draw every bank's numbers even if unused, so clouds 0.5 is a subset
		# of clouds 1.0 with the same seed rather than a different sky.
		var bank := {
			"origin": Vector2(rng.randf_range(area.position.x, area.end.x), rng.randf_range(area.position.y, area.end.y)),
			"phase": rng.randf() * TAU,
			"period": rng.randf_range(45.0, 90.0),
			"thick": rng.randf_range(0.6, 1.0),
			"puffs": [],
		}
		for k in BANK_PUFFS:
			var a := rng.randf() * TAU
			bank.puffs.append([Vector2(cos(a), sin(a)) * rng.randf_range(0.0, 18.0) * size_k, rng.randf_range(22.0, 38.0) * size_k, Vector2(rng.randf(), rng.randf())])
		if b < count:
			_banks.append(bank)
	# After every bank's numbers, so the snow never shifts a bank.
	var share := rng.randf_range(0.55, 1.0)
	_snow_base = clouds * share if style == "snow" else 0.0
	_set_snowfall()
	if _rain_mat:
		var w := _wind * DROP_WIND
		_rain_mat.set_shader_parameter("vel", Vector3(w.x, -DROP_FALL, w.y))
	_cloud = {
		"cloud_coverage": lerpf(0.0, 0.55, clouds) if clouds > 0.0 else -0.2,
		"cloud_strength": lerpf(0.22, 0.38, clouds) * shade_k if clouds > 0.0 else 0.0,
		"cloud_offset": _wind * time,
	}
	for m in _mats:
		_apply_cloud(m)
	_mist.visible = clouds > 0.0 and not eye_level
	_mm.visible_instance_count = _banks.size() * BANK_PUFFS
	_update_mist()
	_push_mist()


## A world material that should get cloud shade and eye-level mist. It must
## use shaders/weather.gdshaderinc. Registering twice is harmless.
func register(mat: ShaderMaterial) -> void:
	if mat == null or _mats.has(mat):
		return
	_mats.append(mat)
	mat.set_shader_parameter("detail", DetailNoise.texture())
	mat.set_shader_parameter("mist_keyhole", EYE_KEYHOLE)
	mat.set_shader_parameter("mist_max", MAX_ALPHA)
	mat.set_shader_parameter("mist_density", MIST_DENSITY)
	mat.set_shader_parameter("mist_top", MIST_TOP)
	mat.set_shader_parameter("mist_tint", tint)
	_apply_cloud(mat)
	_apply_mist(mat)
	mat.set_shader_parameter("sky_dark", _sky.sky_dark)
	mat.set_shader_parameter("sky_tint", _sky.sky_tint)
	mat.set_shader_parameter("head_on", _sky.sky_dark)
	mat.set_shader_parameter("sky_wet", _wet)
	_apply_puddles(mat)
	if night():
		_apply_head(mat, _head_xf())
		_apply_ghosts(mat)


## An unshaded material with a `sky_tint` uniform and nothing else of the
## weather's (treeline, far landmarks). Registering twice is harmless.
func register_tinted(mat: ShaderMaterial) -> void:
	if mat == null or _tinted.has(mat):
		return
	_tinted.append(mat)
	mat.set_shader_parameter("sky_tint", haze())


## The light now (SkyClock.light_changed): darkness 0..1 and the tint.
## Only called when it moved, so a static sky costs nothing per frame.
func set_sky(dark: float, tint_now: Color) -> void:
	_sky = {"sky_dark": dark, "sky_tint": tint_now}
	var xf: Variant = _head_xf()
	for m in _mats:
		m.set_shader_parameter("sky_dark", dark)
		m.set_shader_parameter("sky_tint", tint_now)
		m.set_shader_parameter("head_on", dark)
		if dark > 0.0:
			_apply_head(m, xf)
			_apply_ghosts(m)
	for m in _glows:
		m.set_shader_parameter("night_boost", dark)
	var hz := haze()
	for m in _tinted:
		m.set_shader_parameter("sky_tint", hz)
	if _mist_mat:
		_mist_mat.set_shader_parameter("sky_tint", hz)
	if _snow_mat:
		_snow_mat.set_shader_parameter("sky_tint", hz)
	if _rain_mat:
		_rain_mat.set_shader_parameter("sky_tint", hz)


## How hard it's raining now (SkyClock.rain_changed), 0..1. Only called
## when it moved. Where it snows it snows harder instead.
func set_rain(r: float) -> void:
	rain = clampf(r, 0.0, 1.0)
	if style == "snow":
		_set_snowfall()
		return
	if _rain == null:
		return
	var n := roundi(rain * MAX_DROPS)
	if n != _rain.multimesh.visible_instance_count:
		_rain.multimesh.visible_instance_count = n
		rain_sets += 1
	_rain_hidden = n > 0 and _in_bore()
	_rain.visible = n > 0 and not _rain_hidden
	_push_rain()


## Streaks drawn now: 0 where it snows or it's dry.
func rain_visible() -> int:
	return _rain.multimesh.visible_instance_count if _rain else 0


## The seed's snowfall plus the rain's share, and the flakes to match.
func _set_snowfall() -> void:
	snowfall = clampf(_snow_base + rain * RAIN_SNOW, 0.0, 1.0) if style == "snow" else 0.0
	if _snow:
		_snow.visible = snowfall > 0.0
		_snow.multimesh.visible_instance_count = roundi(snowfall * MAX_FLAKES)
		_push_snow()


## The road's wetness now (SkyClock.rain_changed), 0..1. Only called when
## it moved. Snow stages stay dry-looking: the wet there falls as snow.
func set_wet(wet: float) -> void:
	var w := 0.0 if style == "snow" else clampf(wet, 0.0, 1.0)
	if w == _wet:
		return
	_wet = w
	rain_pushes += 1
	for m in _mats:
		m.set_shader_parameter("sky_wet", w)


func wet() -> float:
	return _wet


## The stage's puddles (Puddles.place), at most PUDDLE_MAX. Once a session.
func set_puddles(p: PackedVector3Array) -> void:
	_puddles = p.slice(0, Puddles.PUDDLE_MAX)
	rain_pushes += 1
	for m in _mats:
		_apply_puddles(m)


func _apply_puddles(m: ShaderMaterial) -> void:
	m.set_shader_parameter("puddle_count", _puddles.size())
	if not _puddles.is_empty():
		var arr := _puddles.duplicate()
		arr.resize(Puddles.PUDDLE_MAX)
		m.set_shader_parameter("puddles", arr)


## What the unshaded materials get as `sky_tint` now: SkyClock.haze.
func haze() -> Color:
	return SkyClock.haze(float(_sky.sky_dark), _sky.sky_tint)


## Is it dark at all (the headlights are on)?
func night() -> bool:
	return float(_sky.sky_dark) > 0.0


## The glow.gdshader materials to brighten at night (the stage's beacons,
## campfire, lamps, and the eggs' lights). Replaces the last list; each
## gets night_boost now.
func set_glows(mats: Array) -> void:
	_glows.clear()
	for m in mats:
		if m is ShaderMaterial and not _glows.has(m):
			_glows.append(m)
			(m as ShaderMaterial).set_shader_parameter("night_boost", _sky.sky_dark)


func glows() -> Array[ShaderMaterial]:
	return _glows


## The rivals' headlights, from where GhostCars draws them this frame:
## (x, z, yaw, strength) each, at most GhostCars.MAX_GHOSTS. Pushed only
## in the dark; an empty list is pushed once, not every frame.
func set_ghost_heads(heads: PackedVector4Array) -> void:
	_ghost_heads = heads
	if not night() or (heads.is_empty() and _ghost_sent == 0):
		return
	for m in _mats:
		_apply_ghosts(m)


func _apply_ghosts(m: ShaderMaterial) -> void:
	var n := mini(_ghost_heads.size(), GhostCars.MAX_GHOSTS)
	m.set_shader_parameter("ghost_head_count", n)
	if n > 0:
		var arr := _ghost_heads.slice(0, n)
		arr.resize(GhostCars.MAX_GHOSTS)
		m.set_shader_parameter("ghost_heads", arr)
	_ghost_sent = n


## Where our headlights are now: the car as drawn (interpolated), or null.
func _head_xf() -> Variant:
	return car.get_global_transform_interpolated() if car else null


func _apply_head(m: ShaderMaterial, xf: Variant) -> void:
	if xf == null:
		return
	var t: Transform3D = xf
	m.set_shader_parameter("head_pos", t.origin)
	var f := Vector2(-t.basis.z.x, -t.basis.z.z)
	m.set_shader_parameter("head_dir", f.normalized() if f.length_squared() > 1e-8 else Vector2(0, -1))


## A material that's going away (a ghost car that stopped coming).
func unregister(mat: ShaderMaterial) -> void:
	_mats.erase(mat)


func materials() -> Array[ShaderMaterial]:
	return _mats


## Mist, snowfall and rain: all start with nothing to draw (no bank in
## view, a dry stage, a storm that hasn't come), so Warmup draws their
## shaders once at load.
func warm_sources() -> Array[MultiMeshInstance3D]:
	var out: Array[MultiMeshInstance3D] = [_mist]
	if _snow:
		out.append(_snow)
	if _rain:
		out.append(_rain)
	return out


func _apply_cloud(m: ShaderMaterial) -> void:
	for k in _cloud:
		m.set_shader_parameter(k, _cloud[k])


func _apply_mist(m: ShaderMaterial) -> void:
	var n := _eye_puffs.size()
	m.set_shader_parameter("mist_count", n)
	if n > 0:
		var arr := _eye_puffs.duplicate()
		arr.resize(MIST_MAX)
		m.set_shader_parameter("mist_puffs", arr)
	if car:
		m.set_shader_parameter("mist_car", car.get_global_transform_interpolated().origin)


func _physics_process(dt: float) -> void:
	if not sky:
		_own_time += dt


func _process(_dt: float) -> void:
	# The palette's car keyhole (never darker than dusk round the car) reads
	# mist_car. The eye-level mist pushes it below; any other time it's dark,
	# push it here, so the keyhole follows the car in every camera and sky.
	# The headlights follow the same transform while it's dark.
	if car and night():
		var xf := car.get_global_transform_interpolated()
		var keyhole := not (clouds > 0.0 and eye_level)
		for m in _mats:
			if keyhole:
				m.set_shader_parameter("mist_car", xf.origin)
			_apply_head(m, xf)
	# Rain and snow don't need clouds: rain adds to the snowfall.
	_push_snow()
	if rain > 0.0 and _rain:
		var hide := _in_bore()
		if hide != _rain_hidden:
			_rain_hidden = hide
			_rain.visible = not hide
		if not hide:
			_push_rain()
	if clouds <= 0.0:
		return
	_cloud["cloud_offset"] = _wind * time
	for m in _mats:
		m.set_shader_parameter("cloud_offset", _wind * time)
	if eye_level:
		_push_mist()
		return
	if car:
		_mist_mat.set_shader_parameter("car_pos", car.get_global_transform_interpolated().origin)
	_mist_mat.set_shader_parameter("drift", time * 0.004)
	_update_mist()


## Eye level: the MIST_MAX puffs nearest the camera, as (x, z, radius,
## opacity). Opacity eases to 0 over the last 30 m of MIST_RANGE, so a puff
## leaving the list has already faded (and past ~120 m the depth fog has the
## view anyway). Top-down or clear sky: none.
func eye_puffs(from: Vector3) -> PackedVector4Array:
	var out := PackedVector4Array()
	if not eye_level or clouds <= 0.0:
		return out
	var cand := []
	for b in _banks.size():
		var a := bank_alpha(b)
		if a < 0.01:
			continue
		var c := bank_centre(b)
		for k in BANK_PUFFS:
			var p: Array = _banks[b].puffs[k]
			var r: float = p[1] * 0.5
			var at: Vector2 = c + p[0]
			var gap := at.distance_to(Vector2(from.x, from.z)) - r
			if gap > MIST_RANGE:
				continue
			cand.append([gap, Vector4(at.x, at.y, r, a * (1.0 - smoothstep(MIST_RANGE - 30.0, MIST_RANGE, gap)))])
	cand.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
	for i in mini(cand.size(), MIST_MAX):
		out.append(cand[i][1])
	return out


func _push_mist() -> void:
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	_eye_puffs = eye_puffs(cam.global_position if cam else (car.global_position if car else Vector3.ZERO))
	for m in _mats:
		_apply_mist(m)


## CPU copy of the shaders' eye_mist(): how much mist lies between `cam` and
## `world` right now, 0..MAX_ALPHA. For tests and tools.
func eye_mist(cam: Vector3, world: Vector3) -> float:
	var puffs := eye_puffs(cam)
	if puffs.is_empty() or not car:
		return 0.0
	var o := Vector2(cam.x, cam.z)
	var to := Vector2(world.x, world.z) - o
	var length := to.length()
	var car_at := car.get_global_transform_interpolated().origin # = the shader's mist_car
	var car_d := Vector2(car_at.x, car_at.z).distance_to(o)
	var t0 := car_d + EYE_KEYHOLE.x
	if length <= t0:
		return 0.0
	var d := to / length
	var acc := 0.0
	for p in puffs:
		var oc := Vector2(p.x, p.y) - o
		var tc := oc.dot(d)
		var h2 := oc.dot(oc) - tc * tc
		var r2 := p.z * p.z
		if h2 < r2:
			var hw := sqrt(r2 - h2)
			acc += maxf(minf(tc + hw, length) - maxf(tc - hw, t0), 0.0) * p.w * (1.0 - h2 / r2)
	var ramp := smoothstep(car_d + EYE_KEYHOLE.x, car_d + EYE_KEYHOLE.y, length)
	var low := 1.0 - smoothstep(MIST_TOP * 0.35, MIST_TOP, world.y - car_at.y)
	return minf(1.0 - exp(-acc * MIST_DENSITY), MAX_ALPHA) * ramp * low


## CPU copy of the shaders' cloud_shade_at(): how much darker the ground at
## world (x, z) is right now under cloud, 0 = full sun. Same in every camera.
func cloud_shade(x: float, z: float) -> float:
	if clouds <= 0.0:
		return 0.0
	var img := DetailNoise.texture().get_image()
	var p := (Vector2(x, z) - _wind * time) / SHADE_SCALE
	var n := _sample(img, p).r * 0.7 + _sample(img, p * 2.3 + Vector2(0.31, 0.77)).g * 0.3
	var cov: float = _cloud["cloud_coverage"]
	return smoothstep(1.0 - cov - 0.12, 1.0 - cov + 0.12, n) * float(_cloud["cloud_strength"])


static func _sample(img: Image, uv: Vector2) -> Color:
	var s := Vector2(img.get_width(), img.get_height())
	var q := Vector2(fposmod(uv.x, 1.0), fposmod(uv.y, 1.0)) * s - Vector2(0.5, 0.5)
	var i := Vector2i(floori(q.x), floori(q.y))
	var f := q - Vector2(i)
	var w := img.get_width()
	var h := img.get_height()
	var c00 := img.get_pixel(posmod(i.x, w), posmod(i.y, h))
	var c10 := img.get_pixel(posmod(i.x + 1, w), posmod(i.y, h))
	var c01 := img.get_pixel(posmod(i.x, w), posmod(i.y + 1, h))
	var c11 := img.get_pixel(posmod(i.x + 1, w), posmod(i.y + 1, h))
	return c00.lerp(c10, f.x).lerp(c01.lerp(c11, f.x), f.y)


## Opacity of bank b right now: a slow breathing cycle, thick for a while,
## gone for a while, smoothstepped so it eases in and out over ~10 s.
func bank_alpha(b: int) -> float:
	var bank: Dictionary = _banks[b]
	var c := sin(bank.phase + time * TAU / bank.period)
	return smoothstep(-0.1, 0.6, c) * bank.thick * lerpf(0.55, 1.0, clouds)


## Where bank b is now: drifts with the wind, wraps around the stage.
func bank_centre(b: int) -> Vector2:
	var area := bounds.grow(80.0)
	var p: Vector2 = _banks[b].origin + _wind * time
	return Vector2(wrapf(p.x, area.position.x, area.end.x), wrapf(p.y, area.position.y, area.end.y))


func bank_count() -> int:
	return _banks.size()


func _update_mist() -> void:
	var ground_y := car.global_position.y if car else 0.0
	for b in _banks.size():
		var c := bank_centre(b)
		var a := bank_alpha(b)
		for k in BANK_PUFFS:
			var p: Array = _banks[b].puffs[k]
			var i := b * BANK_PUFFS + k
			var s: float = p[1]
			var pos := Vector3(c.x + p[0].x, ground_y + bank_height + k * 0.3, c.y + p[0].y)
			_mm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3(s, 1, s)), pos))
			_mm.set_instance_color(i, Color(1, 1, 1, a))
			_mm.set_instance_custom_data(i, Color(p[2].x, p[2].y, 0, 0))


## The flakes: MAX_FLAKES quads at fixed random spots in the box (seed 1:
## where a flake sits in the box isn't weather, only how many fall is).
func _build_snowfall() -> void:
	_snow_mat = ShaderMaterial.new()
	_snow_mat.shader = preload("res://shaders/snowfall.gdshader")
	_snow_mat.render_priority = 1
	_snow_mat.set_shader_parameter("sky_tint", haze())
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	quad.material = _snow_mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = quad
	mm.instance_count = MAX_FLAKES
	var rng := RandomNumberGenerator.new()
	rng.seed = 1
	for i in MAX_FLAKES:
		mm.set_instance_transform(i, Transform3D.IDENTITY)
		mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf(), rng.randf(), rng.randf()))
	mm.visible_instance_count = 0
	_snow = MultiMeshInstance3D.new()
	_snow.name = "Snowfall"
	_snow.multimesh = mm
	_snow.layers = LAYER
	_snow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_snow.custom_aabb = AABB(Vector3(-5000, -500, -5000), Vector3(10000, 1000, 10000))
	_snow.visible = false
	add_child(_snow)


func _push_snow() -> void:
	if _snow == null or snowfall <= 0.0:
		return
	var w := _wind * FLAKE_WIND * time
	_snow_mat.set_shader_parameter("drift", Vector3(w.x, -FALL * time, w.y))
	_snow_mat.set_shader_parameter("t", time)
	if car:
		_snow_mat.set_shader_parameter("centre", car.get_global_transform_interpolated().origin)


## The streaks: MAX_DROPS thin quads at fixed random spots in the box (seed
## 2: where a drop sits isn't weather, only how many fall is).
func _build_rain() -> void:
	_rain_mat = ShaderMaterial.new()
	_rain_mat.shader = preload("res://shaders/rain.gdshader")
	_rain_mat.render_priority = 1
	_rain_mat.set_shader_parameter("sky_tint", haze())
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	quad.material = _rain_mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = quad
	mm.instance_count = MAX_DROPS
	var rng := RandomNumberGenerator.new()
	rng.seed = 2
	for i in MAX_DROPS:
		mm.set_instance_transform(i, Transform3D.IDENTITY)
		mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf(), rng.randf(), rng.randf()))
	mm.visible_instance_count = 0
	_rain = MultiMeshInstance3D.new()
	_rain.name = "Rain"
	_rain.multimesh = mm
	_rain.layers = LAYER
	_rain.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_rain.custom_aabb = AABB(Vector3(-5000, -500, -5000), Vector3(10000, 1000, 10000))
	_rain.visible = false
	add_child(_rain)
	_rain_view()


## The box and streak size for the camera (eye_level), once per switch.
func _rain_view() -> void:
	if _rain_mat == null:
		return
	var v: Dictionary = RAIN_EYE if eye_level else RAIN_TOP
	_rain_mat.set_shader_parameter("box", v.box)
	_rain_mat.set_shader_parameter("width", v.width)
	_rain_mat.set_shader_parameter("streak", v.streak)


## Where the rain box sits: at eye level just ahead of the lens (flat), so
## the near air is full; top-down round the car, where the view looks.
func _rain_centre() -> Vector3:
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	if eye_level and cam:
		var f := -cam.global_basis.z
		f.y = 0.0
		return cam.global_position + (f.normalized() * float(RAIN_EYE.ahead) if f.length_squared() > 1e-6 else Vector3.ZERO)
	if car:
		return car.get_global_transform_interpolated().origin
	return cam.global_position if cam else Vector3.ZERO


func _push_rain() -> void:
	if _rain_mat == null or rain <= 0.0:
		return
	_rain_mat.set_shader_parameter("t", time)
	_rain_mat.set_shader_parameter("centre", _rain_centre())


## Is the camera in a tunnel bore? Top-down, the car stands in for it, the
## way the roof decides to dissolve: the rock's cut open there, so no rain
## falls on what's under it. Flat distance to each bore's line: a few dozen
## segments, only on a stage with a tunnel, only while it rains.
func _in_bore() -> bool:
	if tunnels.is_empty():
		return false
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	if cam == null:
		return false
	var p := cam.global_position
	if not eye_level and car:
		p = car.get_global_transform_interpolated().origin
	for roof in tunnels:
		if is_instance_valid(roof) and roof.distance_to_bore(p) < roof.reach.y:
			return true
	return false
