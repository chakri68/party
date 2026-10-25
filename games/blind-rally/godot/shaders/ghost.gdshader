// Shared-stage ghost cars (spec §7.4): the palette material's look (vertex
// colour, cloud shade, eye-level mist), see-through. `alpha` drops as the
// ghost closes on your own car, so your car always reads on top of it.
// Depth is written before colour (depth_prepass_alpha), so a ghost's own
// panels don't show through each other: it fades as one shape.
shader_type spatial;
render_mode cull_back, blend_mix, depth_prepass_alpha;

#include "res://shaders/weather.gdshaderinc"

uniform float alpha : hint_range(0.0, 1.0) = 0.8;

varying float v_shade;
varying float v_mist;

void vertex() {
	if (!OUTPUT_IS_SRGB) {
		COLOR.rgb = mix(pow((COLOR.rgb + vec3(0.055)) * (1.0 / (1.0 + 0.055)), vec3(2.4)), COLOR.rgb * (1.0 / 12.92), lessThan(COLOR.rgb, vec3(0.04045)));
	}
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
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
	ROUGHNESS = 0.9;
	SPECULAR = 0.25;
	ALPHA = alpha;
}
