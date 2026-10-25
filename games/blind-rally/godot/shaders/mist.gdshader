// Low cloud / mist puffs between the camera and the ground. Each instance is a
// flat soft blob; COLOR.a is its current opacity (fades in and out over
// seconds, set by Weather), INSTANCE_CUSTOM.xy a noise offset so no two puffs
// look alike. Around the car there's always a hole: the fragment's ground
// point (straight down the view ray, ortho camera) is measured against the
// car, and opacity falls to nothing inside keyhole.x metres. The road ahead
// can vanish; the car can't.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform sampler2D detail : filter_linear_mipmap, repeat_enable;
uniform vec3 car_pos = vec3(0.0);
uniform vec2 keyhole = vec2(3.5, 9.0); // fully clear inside x, full opacity past y (metres)
uniform float max_alpha = 0.78;
uniform vec3 tint : source_color = vec3(0.86, 0.88, 0.9);
uniform float drift = 0.0; // slow churn inside the puffs, in noise UV

varying vec3 world;
varying vec4 custom;

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	custom = INSTANCE_CUSTOM;
}

void fragment() {
	vec2 q = UV - vec2(0.5);
	float r = length(q) * 2.0;
	float n = texture(detail, UV * 0.55 + custom.xy + vec2(drift, drift * 0.6)).r;
	float blob = 1.0 - smoothstep(0.25 + n * 0.35, 1.0, r + (n - 0.5) * 0.5);
	// Ground point under this fragment, along the (parallel) view direction.
	vec3 view_dir = -normalize((INV_VIEW_MATRIX * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
	vec3 ground = world - view_dir * ((world.y - car_pos.y) / min(view_dir.y, -0.1));
	float d = distance(ground.xz, car_pos.xz);
	float hole = smoothstep(keyhole.x, keyhole.y, d);
	ALBEDO = tint * (0.92 + n * 0.12);
	ALPHA = clamp(blob * COLOR.a * hole, 0.0, max_alpha);
}
