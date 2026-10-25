// Small additive lights for scenery: the fire tower's beacon, the campfire's
// glow and its flame. Unshaded, no lights, no CPU: everything moves on TIME.
//
// Readability (spec §10): nothing here flashes. The beacon breathes on a
// slow sine (pulse_period seconds, 45-100% brightness); the fire wavers by
// +-8% on two incommensurate slow sines, so it never strobes.
//
// Render layer 5 only (the 3D view), never the static map: the map is one
// still picture and shouldn't catch a light mid-pulse.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

uniform vec3 color : source_color = vec3(1.0, 0.5, 0.2);
uniform float energy = 1.0;
uniform float pulse_period = 0.0; // > 0: slow beacon pulse; 0: fire flicker
uniform vec2 fade = vec2(60.0, 115.0); // metres: full until x, gone by y (stands in for fog)
uniform bool billboard = true;
uniform bool flame = false; // crossed quads that sway; UV.y 0 = tip, 1 = base

varying float v_fade;

float level() {
	if (pulse_period > 0.0) {
		return 0.45 + 0.55 * (0.5 + 0.5 * sin(TIME * 6.2831853 / pulse_period));
	}
	return 0.92 + 0.05 * sin(TIME * 2.3) + 0.03 * sin(TIME * 3.7 + 1.3);
}

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	if (billboard) {
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
		MODELVIEW_NORMAL_MATRIX = mat3(MODELVIEW_MATRIX);
	}
	if (flame) {
		// Sway grows toward the tip; the tip also breathes in height a little.
		float h = 1.0 - UV.y;
		VERTEX.x += sin(TIME * 4.1 + VERTEX.z * 3.0) * 0.07 * h;
		VERTEX.z += sin(TIME * 3.3 + VERTEX.x * 2.0) * 0.07 * h;
		VERTEX.y *= 0.9 + 0.1 * sin(TIME * 2.9);
	}
	v_fade = 1.0 - smoothstep(fade.x, fade.y, distance(origin, INV_VIEW_MATRIX[3].xyz));
}

void fragment() {
	float a;
	if (flame) {
		// Teardrop: wide at the base, a point at the tip, soft sides.
		float h = UV.y;
		float half_w = 0.5 * pow(h, 0.7);
		a = 1.0 - smoothstep(half_w * 0.4, half_w, abs(UV.x - 0.5));
		a *= smoothstep(0.0, 0.25, h) * (1.0 - smoothstep(0.85, 1.0, h) * 0.5);
		ALBEDO = mix(color, vec3(1.0, 0.85, 0.45), h * 0.6) * a * energy * level() * v_fade;
	} else {
		float r = length(UV - vec2(0.5)) * 2.0;
		a = pow(clamp(1.0 - r, 0.0, 1.0), 2.0);
		ALBEDO = color * a * energy * level() * v_fade;
	}
}
