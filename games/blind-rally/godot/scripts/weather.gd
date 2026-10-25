class_name Weather
extends Node3D
## Clouds over the stage: drifting cloud shadows on everything, and low mist
## banks that drift between the camera and the ground and hide stretches of
## road for a few seconds at a time. 3D view only: everything here is on
## render layer 4, which the static map camera never draws (spec: modifiers
## change the 3D view, not the map).
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

@export var clouds := 0.0 ## 0 = clear, 1 = heavy
var seed_value := 0
var time := 0.0 ## seconds of race clock; Weather advances it in physics time

var car: Node3D
var bounds := Rect2(-500, -500, 1000, 1000)

var _wind := Vector2.ZERO
var _banks: Array = [] # {origin: Vector2, phase, period, thick, puffs: [[offset Vector2, size]]}
var _shadow: MeshInstance3D
var _shadow_mat: ShaderMaterial
var _mist: MultiMeshInstance3D
var _mist_mat: ShaderMaterial
var _mm: MultiMesh


func _ready() -> void:
	_shadow_mat = ShaderMaterial.new()
	_shadow_mat.shader = preload("res://shaders/cloud_shadow.gdshader")
	_shadow_mat.set_shader_parameter("detail", DetailNoise.texture())
	_shadow_mat.render_priority = -1
	var quad := PlaneMesh.new()
	quad.size = Vector2(600, 600)
	quad.material = _shadow_mat
	_shadow = MeshInstance3D.new()
	_shadow.name = "CloudShadow"
	_shadow.mesh = quad
	_shadow.layers = LAYER
	_shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_shadow)

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
	_shadow_mat.set_shader_parameter("coverage", lerpf(0.0, 0.55, clouds) if clouds > 0.0 else -0.2)
	_shadow_mat.set_shader_parameter("strength", lerpf(0.22, 0.38, clouds))
	_shadow.visible = clouds > 0.0
	_mist.visible = clouds > 0.0
	_mm.visible_instance_count = _banks.size() * BANK_PUFFS
	_update_mist()


func _physics_process(dt: float) -> void:
	time += dt


func _process(_dt: float) -> void:
	if clouds <= 0.0:
		return
	var cam := get_viewport().get_camera_3d()
	var centre := car.global_position if car else (cam.global_position if cam else Vector3.ZERO)
	# The shadow quad rides along under the car; the pattern stays in world space.
	_shadow.global_position = Vector3(centre.x, centre.y, centre.z)
	_shadow_mat.set_shader_parameter("offset", _wind * time)
	if car:
		_mist_mat.set_shader_parameter("car_pos", car.global_position)
	_mist_mat.set_shader_parameter("drift", time * 0.004)
	_update_mist()


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
