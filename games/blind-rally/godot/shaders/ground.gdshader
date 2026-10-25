// Forest floor. The vertex colour carries the broad picture the track tool
// baked (verge grass, yards, darker under dense canopy; alpha = how much
// forest floor). This adds what a 4 m grid can't: needle litter, moss,
// bare soil and the odd root, from one shared noise texture in world space.
// Three fetches, no branches: WebGL2/Compatibility-friendly.
shader_type spatial;
render_mode cull_back;

uniform sampler2D detail : filter_linear_mipmap, repeat_enable;

varying vec3 world;

// sRGB, like the rest of the palette.
const vec3 NEEDLES = vec3(0.46, 0.34, 0.21); // rust pine needles
const vec3 LITTER = vec3(0.31, 0.26, 0.18); // brown leaf litter
const vec3 MOSS = vec3(0.33, 0.43, 0.19);
const vec3 SOIL = vec3(0.42, 0.33, 0.24);

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = world.xz;
	vec3 big = texture(detail, p / 61.0).rgb; // patches: moss beds, needle drifts
	vec3 mid = texture(detail, p / 13.0 + vec2(0.37, 0.11)).rgb; // clumps and roots
	float fine = texture(detail, p / 2.3).b; // grain: needles, twigs, pebbles
	vec3 floor_c = mix(LITTER, NEEDLES, smoothstep(0.35, 0.65, big.r));
	floor_c = mix(floor_c, MOSS, smoothstep(0.52, 0.68, big.g) * 0.85);
	floor_c = mix(floor_c, SOIL, smoothstep(0.62, 0.7, mid.b) * 0.7);
	// Roots: thin dark ridges where a mid-scale field crosses its midpoint.
	float root = 1.0 - smoothstep(0.0, 0.018, abs(mid.r - 0.5));
	floor_c *= 1.0 - root * smoothstep(0.45, 0.6, mid.g) * 0.45;
	floor_c *= 0.82 + fine * 0.36;
	vec3 base = COLOR.rgb;
	// Keep the baked tint's value (canopy shade, yards) and swap in the detail.
	// REF is the track tool's C_FLOOR_REF (5a4a36): value relative to it is canopy shade.
	const vec3 REF = vec3(0.353, 0.290, 0.212);
	float lum = dot(base, vec3(0.3, 0.55, 0.15)) / dot(REF, vec3(0.3, 0.55, 0.15));
	vec3 forest = floor_c * clamp(lum, 0.45, 1.25);
	ALBEDO = mix(base * (0.88 + fine * 0.24), forest, COLOR.a);
	ROUGHNESS = 0.95;
	SPECULAR = 0.25;
}
