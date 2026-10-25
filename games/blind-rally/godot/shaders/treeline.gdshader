// The distant treeline ring round the eye-level cameras. No lighting, no
// depth fog: it *is* the fog, a silhouette in the haze colour, a touch darker
// at the foot so it reads as forest against the brighter sky.
shader_type spatial;
render_mode unshaded, fog_disabled, cull_disabled, shadows_disabled;

uniform vec3 haze : source_color = vec3(0.69, 0.73, 0.76);

void fragment() {
	ALBEDO = haze * mix(0.9, 1.0, UV.x);
}
