// The palette material: every baked Kenney mesh, the props and the car. Was
// a StandardMaterial3D (vertex colour as albedo, roughness 0.95, specular
// 0.25); same look, plus the weather terms, which it evaluates per vertex
// because these meshes are small and the cloud field is 180 m across.
//
// lod_mode is for the eye-level forest (EyeForest), which duplicates this
// material per role; the baked scene always uses 0:
//   1 = near detail: an instance past lod_range.x (horizontal metres from the
//       camera) collapses to a point. The impostor ring draws it instead.
//   2 = floor clutter: shrinks into the ground over the last lod_range.y
//       metres before lod_range.x, so it never pops.
shader_type spatial;
render_mode cull_back;

#include "res://shaders/weather.gdshaderinc"

uniform int lod_mode = 0;
uniform vec2 lod_range = vec2(1000.0, 8.0);

varying float v_shade;
varying float v_mist;

void vertex() {
	if (!OUTPUT_IS_SRGB) {
		COLOR.rgb = mix(pow((COLOR.rgb + vec3(0.055)) * (1.0 / (1.0 + 0.055)), vec3(2.4)), COLOR.rgb * (1.0 / 12.92), lessThan(COLOR.rgb, vec3(0.04045)));
	}
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	if (lod_mode != 0) {
		float d = length(MODEL_MATRIX[3].xz - cam.xz);
		if (lod_mode == 1 && d >= lod_range.x) {
			VERTEX = vec3(0.0);
		} else if (lod_mode == 2) {
			VERTEX *= 1.0 - smoothstep(lod_range.x - lod_range.y, lod_range.x, d);
		}
	}
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_shade = 0.0;
	v_mist = 0.0;
	if (weather_seen(CAMERA_VISIBLE_LAYERS)) {
		v_shade = cloud_shade_at(world.xz, true);
		v_mist = eye_mist(cam, world);
	}
}

void fragment() {
	ALBEDO = COLOR.rgb * (1.0 - v_shade) * (1.0 - v_mist);
	EMISSION = mist_tint * v_mist;
	ROUGHNESS = 0.95;
	SPECULAR = 0.25;
}
