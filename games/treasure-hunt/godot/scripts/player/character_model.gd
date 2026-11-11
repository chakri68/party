class_name CharacterModel
extends Node3D
## One Kenney Mini Character, scaled to HEIGHT, with its shirt in a team
## colour and an AnimationPlayer driven by play(). Reusable: the walker, the
## remotes and the seats each hold one. setup() builds it; set_color() only
## moves a shader uniform.
##
## The shirt is the colormap swatch most of the torso's vertices sample.
## body-mesh gets shirt_tint.gdshader as a surface override; head-mesh keeps
## the glb's own material.

const IDS: Array[String] = ["female-a", "female-b", "female-c", "female-d", "male-a", "male-b", "male-c", "male-d"]
const HEIGHT := 1.7
const FADE := 0.15
const DIR := "res://assets/kenney_mini-characters/"
const SHADER := preload("res://shaders/shirt_tint.gdshader")
## The colormap: 16 columns by 4 rows (32 x 128 px cells) on the full image.
const GRID := Vector2(16.0, 4.0)
## Below this speed (m/s) you're standing; above RUN_FROM you're sprinting.
## The walker walks at 1.7 and runs at 3.4.
const MOVING := 0.5
const RUN_FROM := 3.2
const LOOPING: Array[StringName] = [&"idle", &"walk", &"sprint", &"drive", &"sit"]

var id := ""
var shirt_cell := Vector2i.ZERO

var _model: Node3D
var _player: AnimationPlayer
var _material: ShaderMaterial
var _color := Color.WHITE
var _state := &""


func setup(new_id: String, color: Color) -> void:
	if not IDS.has(new_id):
		new_id = IDS[0]
	_color = color
	if new_id != id or _model == null:
		_build(new_id)
	set_color(color)


func set_color(color: Color) -> void:
	_color = color
	if _material:
		_material.set_shader_parameter("team_color", color)


## idle, walk, sprint, jump, fall, drive, sit or pick-up. Crossfades;
## asking for the state it's already in does nothing.
func play(state: StringName) -> void:
	if state == _state or _player == null or not _player.has_animation(state):
		return
	_state = state
	_player.play(state, FADE)


## Off freezes the pose. Far-off remotes aren't worth animating.
func set_animating(on: bool) -> void:
	if _player:
		_player.active = on


## What a body is doing, from what it's doing. seat is &"", &"driver" or
## &"passenger".
static func state_for(speed: float, on_floor: bool, vy: float, seat: StringName) -> StringName:
	if seat == &"driver":
		return &"drive"
	if seat == &"passenger":
		return &"sit"
	if not on_floor:
		return &"jump" if vy > 0.0 else &"fall"
	if speed < MOVING:
		return &"idle"
	return &"walk" if speed < RUN_FROM else &"sprint"


## The colormap cell of a uv.
static func cell_of(uv: Vector2) -> Vector2i:
	return Vector2i(floori(uv.x * GRID.x), floori(uv.y * GRID.y))


## The cell most of the torso's vertices sample: the shirt. A vertex counts
## as torso when the torso bone has the most weight on it. Ties go to the
## lowest cell.
static func shirt_cell_of(mesh: Mesh, skin: Skin, skeleton: Skeleton3D) -> Vector2i:
	var arrays := mesh.surface_get_arrays(0)
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	var bones: PackedInt32Array = arrays[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arrays[Mesh.ARRAY_WEIGHTS]
	if uvs.is_empty() or bones.is_empty():
		return Vector2i.ZERO
	var torso := -1
	for i in skin.get_bind_count():
		var bone_name := skin.get_bind_name(i)
		if bone_name.is_empty() and skeleton:
			bone_name = skeleton.get_bone_name(skin.get_bind_bone(i))
		if bone_name == "torso":
			torso = i
	var stride := bones.size() / uvs.size()
	var count := {}
	for v in uvs.size():
		var best := 0
		for k in stride:
			if weights[v * stride + k] > weights[v * stride + best]:
				best = k
		if bones[v * stride + best] != torso:
			continue
		var c := cell_of(uvs[v])
		count[c] = count.get(c, 0) + 1
	var pick := Vector2i.ZERO
	var most := 0
	for c: Vector2i in count:
		if count[c] > most or (count[c] == most and (c.y < pick.y or (c.y == pick.y and c.x < pick.x))):
			most = count[c]
			pick = c
	return pick


func _build(new_id: String) -> void:
	if _model:
		remove_child(_model)
		_model.queue_free()
	_player = null
	_material = null
	_state = &""
	id = new_id
	_model = (load(DIR + "character-%s.glb" % id) as PackedScene).instantiate()
	add_child(_model)

	var skeleton: Skeleton3D = _model.find_child("Skeleton3D", true, false)
	var body: MeshInstance3D = _model.find_child("body-mesh", true, false)
	shirt_cell = shirt_cell_of(body.mesh, body.skin, skeleton)
	var original := body.mesh.surface_get_material(0) as BaseMaterial3D
	_material = ShaderMaterial.new()
	_material.shader = SHADER
	_material.set_shader_parameter("albedo_tex", original.albedo_texture)
	_material.set_shader_parameter("cell", shirt_cell)
	_material.set_shader_parameter("team_color", _color)
	body.set_surface_override_material(0, _material)

	_player = _model.find_child("AnimationPlayer", true, false)
	# The animations are shared resources of the imported scene. The same
	# loop modes every time, so setting them again is harmless.
	for anim_name in _player.get_animation_list():
		_player.get_animation(anim_name).loop_mode = Animation.LOOP_LINEAR if LOOPING.has(StringName(anim_name)) else Animation.LOOP_NONE
	play(&"idle")
	_fit()


## Scales the model to HEIGHT and stands its feet on y = 0. Measured from
## the meshes' own boxes (bind pose), in the model's space, so it works
## before this node is in the tree.
func _fit() -> void:
	_model.scale = Vector3.ONE
	_model.position = Vector3.ZERO
	var lo := INF
	var hi := -INF
	for n in _model.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		var xf := Transform3D.IDENTITY
		var up: Node = mi
		while up != _model:
			xf = (up as Node3D).transform * xf
			up = up.get_parent()
		var box := xf * mi.get_aabb()
		lo = minf(lo, box.position.y)
		hi = maxf(hi, box.end.y)
	var h := hi - lo
	if h <= 0.0:
		return
	var k := HEIGHT / h
	_model.scale = Vector3.ONE * k
	_model.position.y = -lo * k
