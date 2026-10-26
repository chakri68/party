// Eye-level forest impostors (EyeForest): one 18-triangle pine per tree,
// reshaped per instance. INSTANCE_CUSTOM = (width, height, drop top tier,
// hash 0..1); UV.x tags the part (0 trunk, 1-3 tiers).
//
// Trees inside near_r (horizontal metres from the camera) collapse: the
// detailed near meshes draw those. Past ~45 m each tree drifts a little in
// height and tint by its hash, and cools toward blue-grey, so the far forest
// stops reading as one wall of identical cones. Distance-driven, so it
// changes over tens of metres of driving, never in a frame.
shader_type spatial;
render_mode cull_back;

#include "res://shaders/weather.gdshaderinc"

uniform float near_r = 50.0;
// Snow on the branches (Biome.tree_snow): each tier's tip goes white and the
// colour runs down its faces to the green at the base. 0 = the forest.
uniform float snow_cap = 0.0;

varying float v_shade;
varying float v_mist;

void vertex() {
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	float d = length(MODEL_MATRIX[3].xz - cam.xz);
	vec4 c = INSTANCE_CUSTOM;
	float far_k = smoothstep(45.0, 110.0, d);
	if (d < near_r) {
		VERTEX = vec3(0.0);
	} else {
		float part = UV.x;
		if (snow_cap > 0.0 && part > 0.5 && length(VERTEX.xz) < 0.01) {
			COLOR.rgb = mix(COLOR.rgb, vec3(0.92, 0.94, 0.96), snow_cap);
		}
		if (c.z > 0.5 && part > 2.5) {
			// Two-tier variant: the top tier folds into the middle one's apex.
			VERTEX = vec3(0.0, 7.7, 0.0);
		}
		VERTEX.xz *= c.x * mix(1.0, 0.85 + 0.3 * fract(c.w * 7.31), far_k);
		VERTEX.y *= c.y * mix(1.0, 0.8 + 0.45 * c.w, far_k);
		COLOR.rgb *= mix(vec3(1.0), vec3(0.86, 0.95, 1.08) * (0.85 + 0.3 * fract(c.w * 3.7)), far_k);
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
