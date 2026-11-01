class_name Warmup
extends Node3D
## Draws a speck of every material that otherwise first shows up mid-race,
## for a couple of frames, then frees itself.
##
## Why: under the Compatibility renderer WebGL compiles and links a shader
## the first time a draw call uses it. On the web that's 40-110 ms a
## material, and 650 ms for the ghost shader on a cold GPU cache. Dust, tyre
## marks and speed streaks aren't drawn until the car moves, ghosts until the
## first relay, easter eggs until one comes into view, so all of that used
## to land in the first half second after GO. Drawing each once behind the
## loader (and again on the grid, once the session has set the camera, since
## the eye-level cameras' fog is another shader variant) moves the cost
## there.
##
## Each source is copied, not moved: same mesh, same materials, same kind of
## instance (a MultiMesh compiles a different variant from a plain mesh),
## same layers and shadow setting. Sources that would link the same programs
## (same kind, same materials, same flags) share one copy, so handing it a
## whole stage costs a handful of draws, not hundreds. The copies sit just
## past the camera's near plane, a millimetre across (under a pixel) and
## clear where the material allows it. They have no collision and nothing
## reads them, so the race (checkpoints, trip meter, the map) never knows
## they were there.

const FRAMES := 2 ## frames drawn before it goes
const SIZE := 0.001 ## metres
const AHEAD := 1.0 ## metres past the near plane

var _left := FRAMES
var _seen := {}


## A copy of `src` to draw. Kinds it doesn't know (none in the game today)
## are skipped.
func add_source(src: GeometryInstance3D) -> void:
	var key := _key(src)
	if key != "":
		if _seen.has(key):
			return
		_seen[key] = true
	var p: GeometryInstance3D
	if src is MeshInstance3D:
		var mi := src as MeshInstance3D
		if mi.mesh == null:
			return
		var c := MeshInstance3D.new()
		c.mesh = mi.mesh
		for i in mi.get_surface_override_material_count():
			c.set_surface_override_material(i, mi.get_surface_override_material(i))
		p = c
	elif src is MultiMeshInstance3D:
		var from := (src as MultiMeshInstance3D).multimesh
		if from == null or from.mesh == null:
			return
		var mm := MultiMesh.new()
		mm.transform_format = from.transform_format
		mm.use_colors = from.use_colors
		mm.use_custom_data = from.use_custom_data
		mm.mesh = from.mesh
		mm.instance_count = 1
		mm.set_instance_transform(0, Transform3D.IDENTITY)
		if mm.use_colors:
			mm.set_instance_color(0, Color(1, 1, 1, 0))
		var c := MultiMeshInstance3D.new()
		c.multimesh = mm
		p = c
	elif src is Label3D:
		if (src as Label3D).text.is_empty():
			return
		p = src.duplicate(0) as Label3D
		for k in p.get_children():
			k.free()
		p.transform = Transform3D.IDENTITY
	else:
		return
	p.material_override = src.material_override
	p.material_overlay = src.material_overlay
	p.layers = src.layers
	p.cast_shadow = src.cast_shadow
	p.visible = true
	add_child(p)


## One of each kind of draw among `sources` (see _key): what add_source
## would keep. For a list worth computing once, like a stage's.
static func distinct(sources: Array) -> Array:
	var seen := {}
	var out := []
	for src in sources:
		var key := _key(src)
		if key == "" or not seen.has(key):
			seen[key] = true
			out.append(src)
	return out


## A ready-made node to draw as it is (a ghost, from GhostCars.warm_node).
func add_node(n: Node3D) -> void:
	n.transform = Transform3D.IDENTITY
	add_child(n)


## What decides which programs a source links. "" (never shared) for a
## label, whose material comes from its own settings.
static func _key(src: GeometryInstance3D) -> String:
	if src is Label3D:
		return ""
	var mesh: Mesh = null
	var bits := [src.get_class(), src.material_override, src.material_overlay, src.cast_shadow, src.layers]
	if src is MeshInstance3D:
		mesh = (src as MeshInstance3D).mesh
		for i in (src as MeshInstance3D).get_surface_override_material_count():
			bits.append((src as MeshInstance3D).get_surface_override_material(i))
	elif src is MultiMeshInstance3D and (src as MultiMeshInstance3D).multimesh:
		var mm := (src as MultiMeshInstance3D).multimesh
		mesh = mm.mesh
		bits.append_array([mm.transform_format, mm.use_colors, mm.use_custom_data])
	if mesh:
		for i in mesh.get_surface_count():
			bits.append(mesh.surface_get_material(i))
	return str(bits.map(func(b: Variant) -> String: return str(b.get_instance_id()) if b is Object else str(b)))


func _ready() -> void:
	_place()


func _process(_dt: float) -> void:
	if _left <= 0:
		queue_free()
		return
	_place()
	_left -= 1


func _place() -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var b := cam.global_basis.orthonormalized()
	global_transform = Transform3D(b.scaled(Vector3.ONE * SIZE), cam.global_position - b.z * (cam.near + AHEAD))
