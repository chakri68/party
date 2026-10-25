// Drifting cloud shadows: one big quad at ground level under the camera,
// drawn after everything (no depth test) and multiplied over the frame.
// Each pixel looks up the cloud field at the ground point it was placed on,
// so tree crowns and the car darken with the ground under them; no shadow
// maps involved. Soft thresholds and slow drift: it can't flicker.
shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, depth_test_disabled, cull_disabled, shadows_disabled;

uniform sampler2D detail : filter_linear_mipmap, repeat_enable;
uniform vec2 offset = vec2(0.0); // wind * time, metres
uniform float coverage = 0.0; // 0 clear .. ~0.6 mostly cloudy
uniform float strength = 0.35; // how dark a full shadow gets

varying vec2 world_xz;

void vertex() {
	world_xz = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
}

void fragment() {
	vec2 p = (world_xz - offset) / 180.0;
	float n = texture(detail, p).r * 0.7 + texture(detail, p * 2.3 + vec2(0.31, 0.77)).g * 0.3;
	float shade = smoothstep(1.0 - coverage - 0.12, 1.0 - coverage + 0.12, n);
	ALBEDO = vec3(1.0 - shade * strength);
}
