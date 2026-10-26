// The ground. The vertex colour carries the broad picture the track tool
// baked (verge grass, yards, darker under dense canopy; alpha = how much
// floor detail). This adds what a 4 m grid can't, from one shared noise
// texture in world space. Three fetches: WebGL2/Compatibility-friendly.
//
// The four floor colours and the thin dark lines are the biome's (Track
// applies Biome.ground_params at load): the defaults are the forest's
// needle litter, moss, bare soil and roots; the desert's are red sand,
// hardpan, caliche, desert pavement and drying cracks. `strata` > 0 adds
// rock: wherever the ground is steeper than `rock_slope`, banded layers
// (by height, wobbled by the noise) in the rock colours, with a sand cap on
// the flat tops. That's the canyon walls and the mesas.
shader_type spatial;
render_mode cull_back;

#include "res://shaders/weather.gdshaderinc"

varying vec3 world;
varying float v_mist; // per vertex: a smooth field, and the ground is most of the screen

// sRGB, like the rest of the palette (no source_color hint: used as given).
uniform vec3 c_needles = vec3(0.46, 0.34, 0.21); // rust pine needles
uniform vec3 c_litter = vec3(0.31, 0.26, 0.18); // brown leaf litter
uniform vec3 c_moss = vec3(0.33, 0.43, 0.19);
uniform vec3 c_soil = vec3(0.42, 0.33, 0.24);
uniform float roots = 0.45; // how dark the thin lines get
uniform float strata = 0.0; // 0 = no rock faces at all (the forest)
uniform float rock_slope = 0.8; // normal.y under this is rock face
uniform vec3 c_rock_a = vec3(0.62, 0.33, 0.2);
uniform vec3 c_rock_b = vec3(0.78, 0.5, 0.3);
uniform vec3 c_rock_c = vec3(0.86, 0.72, 0.52); // the pale band
uniform float band_m = 2.6; // metres per layer

varying vec3 w_normal;

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	w_normal = (MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz;
	v_mist = weather_seen(CAMERA_VISIBLE_LAYERS) ? eye_mist(INV_VIEW_MATRIX[3].xyz, world) : 0.0;
}

void fragment() {
	vec2 p = world.xz;
	vec3 big = texture(detail, p / 61.0).rgb; // patches: moss beds, needle drifts
	vec3 mid = texture(detail, p / 13.0 + vec2(0.37, 0.11)).rgb; // clumps and roots
	float fine = texture(detail, p / 2.3).b; // grain: needles, twigs, pebbles
	vec3 floor_c = mix(c_litter, c_needles, smoothstep(0.35, 0.65, big.r));
	floor_c = mix(floor_c, c_moss, smoothstep(0.52, 0.68, big.g) * 0.85);
	floor_c = mix(floor_c, c_soil, smoothstep(0.62, 0.7, mid.b) * 0.7);
	// Roots (or cracks): thin dark ridges where a mid-scale field crosses its midpoint.
	float root = 1.0 - smoothstep(0.0, 0.018, abs(mid.r - 0.5));
	floor_c *= 1.0 - root * smoothstep(0.45, 0.6, mid.g) * roots;
	floor_c *= 0.82 + fine * 0.36;
	vec3 base = COLOR.rgb;
	// Keep the baked tint's value (canopy shade, yards) and swap in the detail.
	// REF is the track tool's C_FLOOR_REF (5a4a36): value relative to it is canopy shade.
	const vec3 REF = vec3(0.353, 0.290, 0.212);
	float lum = dot(base, vec3(0.3, 0.55, 0.15)) / dot(REF, vec3(0.3, 0.55, 0.15));
	vec3 forest = floor_c * clamp(lum, 0.45, 1.25);
	vec3 albedo = mix(base * (0.88 + fine * 0.24), forest, COLOR.a);
	if (strata > 0.0) {
		vec3 nrm = normalize(w_normal);
		float face = (1.0 - smoothstep(rock_slope - 0.12, rock_slope, nrm.y)) * strata;
		// Layers by height, wobbled sideways so they aren't ruled lines.
		float h = world.y / band_m + (big.b - 0.5) * 1.6 + (mid.g - 0.5) * 0.35;
		float layer = fract(h * 0.5);
		vec3 rock = mix(c_rock_a, c_rock_b, smoothstep(0.2, 0.3, layer) - smoothstep(0.62, 0.72, layer));
		rock = mix(rock, c_rock_c, smoothstep(0.86, 0.9, fract(h * 0.31 + 0.4)) * 0.85);
		// Ledges catch a little sand; the face itself is streaked with varnish.
		rock *= 0.86 + fine * 0.22 - smoothstep(0.55, 0.75, mid.r) * 0.1;
		albedo = mix(albedo, rock, face);
	}
	float mist = 0.0;
	if (weather_seen(CAMERA_VISIBLE_LAYERS)) {
		albedo *= 1.0 - cloud_shade_at(world.xz, false);
		mist = v_mist;
	}
	ALBEDO = albedo * (1.0 - mist);
	EMISSION = mist_tint * mist;
	ROUGHNESS = 0.95;
	SPECULAR = 0.25;
}
