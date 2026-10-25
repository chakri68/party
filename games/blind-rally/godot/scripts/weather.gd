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
## Later: the NIGHT modifier (spec §7.2) fits the same slot. A dark multiply
## pass like the cloud shadow, with the car's keyhole as headlights, would
## cut visibility the same way without touching the map. Not built.

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

@export var clouds := 0.0 ## 0 = clear, 1 = heavy
var seed_value := 0
var time := 0.0 ## seconds of race clock; Weather advances it in physics time

var car: Node3D
## Chase and bonnet: mist goes to the shaders as ground-hugging banks and the
## overhead puff sprites hide. main sets it with the camera mode.
var eye_level := false:
	set(v):
		eye_level = v
		if _mist:
			_mist.visible = clouds > 0.0 and not v
		_push_mist()
var bounds := Rect2(-500, -500, 1000, 1000)

var _wind := Vector2.ZERO
var _banks: Array = [] # {origin: Vector2, phase, period, thick, puffs: [[offset Vector2, size]]}
var _mats: Array[ShaderMaterial] = []
var _cloud := {} # shader parameter -> value, for materials registered later
var _eye_puffs := PackedVector4Array() # what the shaders got last, for the CPU mirror
var _mist: MultiMeshInstance3D
var _mist_mat: ShaderMaterial
var _mm: MultiMesh


func _ready() -> void:
	_mist_mat = ShaderMaterial.new()
	_mist_mat.shader = preload("res://shaders/mist.gdshader")
	_mist_mat.set_shader_parameter("detail", DetailNoise.texture())
	_mist_mat.render_priority = 1
	_mist_mat.set_shader_parameter("keyhole", KEYHOLE)
	_mist_mat.set_shader_parameter("max_alpha", MAX_ALPHA)
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


## Same seed + same clouds = same weather. clouds 0 turns it all off.
func configure(seed_in: int, clouds_in: float) -> void:
	seed_value = seed_in
	clouds = clampf(clouds_in, 0.0, 1.0)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_in
	var heading := rng.randf() * TAU
	_wind = Vector2(cos(heading), sin(heading)) * rng.randf_range(2.5, 5.5)
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
			bank.puffs.append([Vector2(cos(a), sin(a)) * rng.randf_range(0.0, 18.0), rng.randf_range(22.0, 38.0), Vector2(rng.randf(), rng.randf())])
		if b < count:
			_banks.append(bank)
	_cloud = {
		"cloud_coverage": lerpf(0.0, 0.55, clouds) if clouds > 0.0 else -0.2,
		"cloud_strength": lerpf(0.22, 0.38, clouds) if clouds > 0.0 else 0.0,
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
	mat.set_shader_parameter("mist_tint", MIST_TINT)
	_apply_cloud(mat)
	_apply_mist(mat)


## A material that's going away (a ghost car that stopped coming).
func unregister(mat: ShaderMaterial) -> void:
	_mats.erase(mat)


func materials() -> Array[ShaderMaterial]:
	return _mats


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
		m.set_shader_parameter("mist_car", car.global_position)


func _physics_process(dt: float) -> void:
	time += dt


func _process(_dt: float) -> void:
	if clouds <= 0.0:
		return
	_cloud["cloud_offset"] = _wind * time
	for m in _mats:
		m.set_shader_parameter("cloud_offset", _wind * time)
	if eye_level:
		_push_mist()
		return
	if car:
		_mist_mat.set_shader_parameter("car_pos", car.global_position)
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
	var car_d := Vector2(car.global_position.x, car.global_position.z).distance_to(o)
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
	var low := 1.0 - smoothstep(MIST_TOP * 0.35, MIST_TOP, world.y - car.global_position.y)
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
			var pos := Vector3(c.x + p[0].x, ground_y + BANK_HEIGHT + k * 0.3, c.y + p[0].y)
			_mm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3(s, 1, s)), pos))
			_mm.set_instance_color(i, Color(1, 1, 1, a))
			_mm.set_instance_custom_data(i, Color(p[2].x, p[2].y, 0, 0))
