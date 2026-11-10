class_name Water
extends MeshInstance3D
## The sea: one flat plane at sea level, past the world's edge on every side.
## Nothing solid: main's deep-water rule stops you at the waterline. Drawn
## from both sides, so a camera that dips under it still sees the surface.

const HALF := 1200.0


func build() -> void:
	name = "Water"
	var p := PlaneMesh.new()
	p.size = Vector2(2.0 * HALF, 2.0 * HALF)
	mesh = p
	position = Vector3(0, TerrainField.SEA_LEVEL, 0)
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.16, 0.38, 0.55, 0.72)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = 0.15
	m.metallic_specular = 0.6
	material_override = m
