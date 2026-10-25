class_name Scatter
extends StaticBody3D
## One chunk of baked scenery (trees, rocks, bushes). Instances are stored as
## compact (x, z, yaw, scale) quads per mesh and expanded in _ready into one
## MultiMeshInstance3D per mesh (one draw call each, culled per chunk) plus a
## cylinder collider per solid instance. The data is baked by the track tool;
## nothing here is random, so every client builds the same forest.

## Meshes, one per variant. All share the palette material.
@export var meshes: Array[Mesh] = []
## Per mesh: x, z, yaw, scale for each instance, world space.
@export var instances: Array[PackedFloat32Array] = []
## Per mesh: collider radius at scale 1. 0 means you drive through it (grass).
@export var radii: PackedFloat32Array = []
@export var collider_height := 4.0
## Per-instance brightness jitter, so a wall of pines isn't one flat green.
@export var tint_jitter := 0.1
@export var cast_shadows := true

var instance_total := 0
var collider_total := 0


func _ready() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(String(name))
	var shapes := {}
	for m in meshes.size():
		var data: PackedFloat32Array = instances[m]
		var count := data.size() / 4
		if count == 0:
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = tint_jitter > 0.0
		mm.mesh = meshes[m]
		mm.instance_count = count
		var r: float = radii[m] if m < radii.size() else 0.0
		for i in count:
			var x := data[i * 4]
			var z := data[i * 4 + 1]
			var s := data[i * 4 + 3]
			var basis := Basis(Vector3.UP, data[i * 4 + 2]).scaled(Vector3(s, s, s))
			mm.set_instance_transform(i, Transform3D(basis, Vector3(x, 0, z)))
			if mm.use_colors:
				var k := 1.0 + rng.randf_range(-tint_jitter, tint_jitter)
				mm.set_instance_color(i, Color(k, k * rng.randf_range(0.97, 1.03), k, 1.0))
			if r > 0.0:
				# Colliders come in 0.1 m radius steps so most instances share one shape.
				var rr := snappedf(r * s, 0.1)
				if not shapes.has(rr):
					var cyl := CylinderShape3D.new()
					cyl.radius = rr
					cyl.height = collider_height
					shapes[rr] = cyl
				var owner_id := create_shape_owner(self)
				shape_owner_add_shape(owner_id, shapes[rr])
				shape_owner_set_transform(owner_id, Transform3D(Basis.IDENTITY, Vector3(x, collider_height * 0.5, z)))
				collider_total += 1
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "MM%d" % m
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast_shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)
		instance_total += count


## Instance positions of one mesh, for tests and tools.
func positions(mesh_index: int) -> PackedVector3Array:
	var out := PackedVector3Array()
	var data: PackedFloat32Array = instances[mesh_index]
	for i in data.size() / 4:
		out.append(Vector3(data[i * 4], 0, data[i * 4 + 1]))
	return out
