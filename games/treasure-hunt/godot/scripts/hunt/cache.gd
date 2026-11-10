class_name Cache
extends Node3D
## One cache: a small ochre crate with a lighter band round the middle.
## Origin at its bottom, so placing it at the ground puts it on the ground.
## No collider: you walk into it, not over it, and E does the rest.

const SIZE := Vector3(0.5, 0.35, 0.35)
const COLOR := Color("#d8a23a")
const FOUND_S := 0.3

static var _body_mat: StandardMaterial3D
static var _strip_mat: StandardMaterial3D
static var _body_mesh: BoxMesh
static var _strip_mesh: BoxMesh

var id := ""
var found := false


func _init(cache_id := "") -> void:
	id = cache_id
	name = "Cache_" + cache_id.validate_node_name()
	if _body_mesh == null:
		_body_mat = StandardMaterial3D.new()
		_body_mat.albedo_color = COLOR
		_body_mat.roughness = 0.8
		_strip_mat = StandardMaterial3D.new()
		_strip_mat.albedo_color = COLOR.lightened(0.45)
		_strip_mat.roughness = 0.8
		_body_mesh = BoxMesh.new()
		_body_mesh.size = SIZE
		_strip_mesh = BoxMesh.new()
		# A hair proud of the body on every side, so it reads as a band.
		_strip_mesh.size = Vector3(SIZE.x + 0.01, 0.07, SIZE.z + 0.01)
	var body := MeshInstance3D.new()
	body.mesh = _body_mesh
	body.material_override = _body_mat
	body.position.y = SIZE.y * 0.5
	add_child(body)
	var strip := MeshInstance3D.new()
	strip.mesh = _strip_mesh
	strip.material_override = _strip_mat
	strip.position.y = SIZE.y * 0.5
	add_child(strip)
	# Each crate sits at its own angle, from its id, so a row of them doesn't
	# look stamped.
	rotation.y = deg_to_rad(float(posmod(hash(cache_id), 360)))


## Shrinks away over FOUND_S, then hides. Already found: nothing.
func mark_found() -> void:
	if found:
		return
	found = true
	if not is_inside_tree():
		visible = false
		return
	var tw := create_tween()
	# Not to zero: a zero scale makes a basis Godot can't invert.
	tw.tween_property(self, "scale", Vector3.ONE * 0.01, FOUND_S)
	tw.tween_callback(func() -> void: visible = false)
