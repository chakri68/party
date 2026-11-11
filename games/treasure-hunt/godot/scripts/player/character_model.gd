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
## All eight share this one texture. Loaded directly, because the web export
## drops it from the GLBs' imported materials (albedo_texture comes out null
## and the model renders white).
const COLORMAP := preload("res://assets/kenney_mini-characters/Textures/colormap.png")
## The colormap: 16 columns by 4 rows (32 x 128 px cells) on the full image.
const GRID := Vector2(16.0, 4.0)
## Below this speed (m/s) you're standing; above RUN_FROM you're sprinting.
## The walker walks at 1.7 and runs at 3.4; this is halfway between.
const MOVING := 0.5
const RUN_FROM := 2.55
const CELL_EPS := 1e-4
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


## The state last asked for.
func state() -> StringName:
	return _state


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
## A uv a hair under a cell edge (float noise from the glb) counts as on the
## edge, so it lands in the cell it was authored for, not the one below.
static func cell_of(uv: Vector2) -> Vector2i:
	var c := uv * GRID + Vector2(CELL_EPS, CELL_EPS)
	return Vector2i(floori(c.x), floori(c.y))


## The shirt: the cell that covers the most surface on the upper half of
## the torso. A triangle is torso when the torso bone has the most weight on
## its first vertex. Upper half, by area, because the belt band at the waist
## has more vertices than the shirt on several models. Ties go to the lowest
## cell. Only surface 0 is read: body-mesh has a single surface.
static func shirt_cell_of(mesh: Mesh, skin: Skin, skeleton: Skeleton3D) -> Vector2i:
	return _vote(mesh, skin, skeleton).cell


## How many torso triangles voted in shirt_cell_of. 0 means the torso bind
## wasn't found, and the cell is a meaningless (0, 0).
static func torso_vertex_count(mesh: Mesh, skin: Skin, skeleton: Skeleton3D) -> int:
	return _vote(mesh, skin, skeleton).votes


static func _vote(mesh: Mesh, skin: Skin, skeleton: Skeleton3D) -> Dictionary:
	var out := {"cell": Vector2i.ZERO, "votes": 0}
	var arrays := mesh.surface_get_arrays(0)
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	var bones: PackedInt32Array = arrays[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arrays[Mesh.ARRAY_WEIGHTS]
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var index: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	if uvs.is_empty() or bones.is_empty() or index.is_empty():
		return out
	var torso := -1
	for i in skin.get_bind_count():
		var bone_name := skin.get_bind_name(i)
		if bone_name.is_empty() and skeleton:
			bone_name = skeleton.get_bone_name(skin.get_bind_bone(i))
		if bone_name == "torso":
			torso = i
	if torso < 0:
		return out
	var stride := bones.size() / uvs.size()
	var tris: Array[int] = []
	var lo := INF
	var hi := -INF
	for t in range(0, index.size(), 3):
		var v := index[t]
		var best := 0
		for k in stride:
			if weights[v * stride + k] > weights[v * stride + best]:
				best = k
		if bones[v * stride + best] != torso:
			continue
		tris.append(t)
		var y := (verts[index[t]].y + verts[index[t + 1]].y + verts[index[t + 2]].y) / 3.0
		lo = minf(lo, y)
		hi = maxf(hi, y)
	var mid := (lo + hi) * 0.5
	var area := {}
	for t in tris:
		var a := verts[index[t]]
		var b := verts[index[t + 1]]
		var c := verts[index[t + 2]]
		if (a.y + b.y + c.y) / 3.0 < mid:
			continue
		var cell := cell_of((uvs[index[t]] + uvs[index[t + 1]] + uvs[index[t + 2]]) / 3.0)
		area[cell] = area.get(cell, 0.0) + (b - a).cross(c - a).length() * 0.5
	var pick := Vector2i.ZERO
	var most := 0.0
	for c: Vector2i in area:
		if area[c] > most or (area[c] == most and (c.y < pick.y or (c.y == pick.y and c.x < pick.x))):
			most = area[c]
			pick = c
	out.cell = pick
	out.votes = tris.size()
	return out


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
	if torso_vertex_count(body.mesh, body.skin, skeleton) == 0:
		push_warning("CharacterModel: no torso vertices in %s, shirt cell is a guess" % id)
	shirt_cell = shirt_cell_of(body.mesh, body.skin, skeleton)
	_material = ShaderMaterial.new()
	_material.shader = SHADER
	_material.set_shader_parameter("albedo_tex", COLORMAP)
	_material.set_shader_parameter("cell", shirt_cell)
	_material.set_shader_parameter("team_color", _color)
	body.set_surface_override_material(0, _material)
	# The other meshes (the head) keep their look, but get the colormap back.
	for n in _model.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi == body:
			continue
		for i in mi.mesh.get_surface_count():
			var own := mi.mesh.surface_get_material(i) as BaseMaterial3D
			if own:
				var mat := own.duplicate() as BaseMaterial3D
				mat.albedo_texture = COLORMAP
				mi.set_surface_override_material(i, mat)

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
