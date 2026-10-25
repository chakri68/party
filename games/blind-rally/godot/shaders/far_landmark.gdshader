// A tall landmark (the fire tower) past the eye-level far plane: EyeForest
// scales a copy of its mesh toward the camera, which keeps its silhouette
// exactly, and draws it in haze. haze_k is how much fog it gets: at the
// hand-over radius the real tower's depth fog, thinning a little more with
// distance. The beacon (its lamp is C_BEACON in the vertex colours) keeps
// pulsing, slowly, the same as the real one's glow.
shader_type spatial;
render_mode unshaded, fog_disabled, cull_back, shadows_disabled;

uniform vec3 haze : source_color = vec3(0.69, 0.74, 0.77);
uniform float haze_k = 0.6;
uniform float pulse_period = 3.2;

varying vec3 v_col;

void vertex() {
	v_col = COLOR.rgb;
}

void fragment() {
	bool lamp = v_col.r > 0.5 && v_col.g < 0.25 && v_col.b < 0.25;
	vec3 c = v_col;
	if (!OUTPUT_IS_SRGB) {
		c = mix(pow((c + vec3(0.055)) * (1.0 / 1.055), vec3(2.4)), c * (1.0 / 12.92), lessThan(c, vec3(0.04045)));
	}
	if (lamp) {
		float k = 0.45 + 0.55 * (0.5 + 0.5 * sin(TIME * 6.2831853 / pulse_period));
		ALBEDO = mix(vec3(1.0, 0.25, 0.15) * (0.6 + 0.6 * k), haze, haze_k * 0.4);
	} else {
		ALBEDO = mix(c * 0.85, haze, haze_k);
	}
}
