class_name Scatter
extends StaticBody3D
## One chunk of baked scenery (trees, rocks, bushes). Instances are stored as
## (x, y, z, yaw, scale) records per mesh, packed into 10 bytes each (the
## deep forest is ~90k of them; floats tripled the scene), and expanded in
## _ready into one MultiMeshInstance3D per mesh (one draw call each, culled per chunk) plus a
## cylinder collider per solid instance. The data is baked by the track tool;
## nothing here is random, so every client builds the same forest.

## Meshes, one per variant. All share the palette material.
@export var meshes: Array[Mesh] = []
## Per mesh: packed records, see pack(). Positions are world space (y is the
## ground under it, so hills carry their trees); x and z relative to origin.
@export var packed: Array[PackedByteArray] = []
## World XZ of the chunk's corner; records span `span` metres from it.
@export var origin := Vector2.ZERO
@export var span := 96.0
## Per mesh: collider radius at scale 1. 0 means you drive through it (grass).
@export var radii: PackedFloat32Array = []
@export var collider_height := 4.0
## Per-instance brightness jitter, so a wall of pines isn't one flat green.
@export var tint_jitter := 0.1
@export var cast_shadows := true
## Render layers for the drawn instances (the map's backdrop forest is map-only).
@export var layers := 1

const STRIDE := 5 ## floats per record once decoded
const BYTES := 10 ## per packed record: u16 x, u16 z, s16 y cm, u16 yaw, s16 scale x 1000

var instance_total := 0
var collider_total := 0


func _ready() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(String(name))
	var shapes := {}
	for m in meshes.size():
		var data := decode(m)
		var count := data.size() / STRIDE
		if count == 0:
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = tint_jitter > 0.0
		mm.mesh = meshes[m]
		mm.instance_count = count
		var r: float = radii[m] if m < radii.size() else 0.0
		for i in count:
			var o := i * STRIDE
			var x := data[o]
			var y := data[o + 1]
			var z := data[o + 2]
			var s := absf(data[o + 4])
			var basis := Basis(Vector3.UP, data[o + 3]).scaled(Vector3(s, s, s))
			mm.set_instance_transform(i, Transform3D(basis, Vector3(x, y, z)))
			if mm.use_colors:
				var k := 1.0 + rng.randf_range(-tint_jitter, tint_jitter)
				mm.set_instance_color(i, Color(k, k * rng.randf_range(0.97, 1.03), k, 1.0))
			# A negative scale marks scenery the car can't reach: drawn, not solid.
			if r > 0.0 and data[o + 4] > 0.0:
				# Colliders come in 0.1 m radius steps so most instances share one shape.
				var rr := snappedf(r * s, 0.1)
				if not shapes.has(rr):
					var cyl := CylinderShape3D.new()
					cyl.radius = rr
					cyl.height = collider_height
					shapes[rr] = cyl
				var owner_id := create_shape_owner(self)
				shape_owner_add_shape(owner_id, shapes[rr])
				shape_owner_set_transform(owner_id, Transform3D(Basis.IDENTITY, Vector3(x, y + collider_height * 0.5, z)))
				collider_total += 1
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "MM%d" % m
		mmi.multimesh = mm
		mmi.layers = layers
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast_shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)
		instance_total += count


## Draws (or stops drawing) this chunk's meshes; colliders are untouched.
## The eye-level cameras swap in EyeForest's finer, LOD'd copy of the same
## records.
func set_drawn(on: bool) -> void:
	for c in get_children():
		if c is MultiMeshInstance3D:
			(c as MultiMeshInstance3D).visible = on


## Instance positions of one mesh, for tests and tools.
func positions(mesh_index: int) -> PackedVector3Array:
	var out := PackedVector3Array()
	var data := decode(mesh_index)
	for i in data.size() / STRIDE:
		out.append(Vector3(data[i * STRIDE], data[i * STRIDE + 1], data[i * STRIDE + 2]))
	return out


## Records (x, y, z, yaw, scale; negative scale = not solid) -> bytes.
## x and z to ~1.5 mm over a 96 m chunk, y to 1 cm, yaw to 0.006 deg.
static func pack(records: PackedFloat32Array, chunk_origin: Vector2, chunk_span: float) -> PackedByteArray:
	var n := records.size() / STRIDE
	var out := PackedByteArray()
	out.resize(n * BYTES)
	for i in n:
		var r := i * STRIDE
		var o := i * BYTES
		out.encode_u16(o, clampi(roundi((records[r] - chunk_origin.x) / chunk_span * 65535.0), 0, 65535))
		out.encode_u16(o + 2, clampi(roundi((records[r + 2] - chunk_origin.y) / chunk_span * 65535.0), 0, 65535))
		out.encode_s16(o + 4, clampi(roundi(records[r + 1] * 100.0), -32768, 32767))
		out.encode_u16(o + 6, roundi(fposmod(records[r + 3], TAU) / TAU * 65535.0))
		out.encode_s16(o + 8, clampi(roundi(records[r + 4] * 1000.0), -32768, 32767))
	return out


func decode(mesh_index: int) -> PackedFloat32Array:
	var b: PackedByteArray = packed[mesh_index]
	var n := b.size() / BYTES
	var out := PackedFloat32Array()
	out.resize(n * STRIDE)
	for i in n:
		var o := i * BYTES
		var r := i * STRIDE
		out[r] = origin.x + b.decode_u16(o) / 65535.0 * span
		out[r + 1] = b.decode_s16(o + 4) * 0.01
		out[r + 2] = origin.y + b.decode_u16(o + 2) / 65535.0 * span
		out[r + 3] = b.decode_u16(o + 6) / 65535.0 * TAU
		out[r + 4] = b.decode_s16(o + 8) * 0.001
	return out
