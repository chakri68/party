// Gravel road. Vertex colour carries the cross-section the track tool baked
// (verge, wheel ruts, crown, ditch); UV.x is metres from the centreline, UV.y
// metres along the stage, UV2 = (half width, verge edge) at that point. On
// top: loose stones, damp patches, a dusty crown, compacted tracks on the
// racing line, moss creeping into the verge, and a ragged outer edge: past
// the ditch the mesh is an apron the noise eats away, so gravel spills onto
// the forest floor in patches instead of stopping at a ruled line.
//
// The colours that aren't baked (stones, the creep from the edge) and how
// much of each effect there is are uniforms, so a biome can retune them
// (Track applies Biome.road_params at load); the defaults are Pine Panic's
// gravel. The desert adds blown sand drifting in across the road (`drift`)
// and washboard corrugation (`washboard`), both 0 here. Snowblind bakes its
// ice patches with vertex alpha under 1: no loose stones there, and a
// polished, glinting surface (alpha is 1 everywhere else, so no change).
//
// Dirt-sim hook (not built, on purpose): a deformation layer would be one more
// world-space mask sampled here (ruts darken, berms lighten) plus the matching
// surface lookup in CarController._read_surface. Nothing else needs to move.
// Colours here are in the same space as the baked vertex colours (which
// Godot hands the shader as-is and lights the same way the palette material
// does), so palette hex values can be used directly.
shader_type spatial;
render_mode cull_back;

#include "res://shaders/weather.gdshaderinc"

uniform vec3 c_stone_light = vec3(0.68, 0.66, 0.61);
uniform vec3 c_stone_dark = vec3(0.27, 0.25, 0.22);
uniform vec3 c_creep = vec3(0.30, 0.36, 0.18); // grass and moss at the edge
uniform float creep_k = 0.75;
uniform float damp_k = 0.2;
uniform vec3 c_drift = vec3(0.85, 0.7, 0.5); // blown sand
uniform float drift = 0.0;
uniform float washboard = 0.0;

varying vec3 world;
varying float v_mist; // per vertex: a smooth field, and the ground is most of the screen

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_mist = weather_seen(CAMERA_VISIBLE_LAYERS) ? eye_mist(INV_VIEW_MATRIX[3].xyz, world) : 0.0;
}

void fragment() {
	vec3 c = COLOR.rgb;
	float ice = 1.0 - COLOR.a;
	float lat = abs(UV.x);
	float past = lat - UV2.y; // metres beyond the verge: ditch, then apron
	vec3 fray = texture(detail, world.xz / 3.1).rgb;
	// Ragged edge: the further out, the more of the apron (and the outer
	// ditch) is let through to the ground underneath.
	if (fray.r + fray.b * 0.35 < smoothstep(0.7, 2.6, past) * 1.1 + 0.08 * step(0.7, past)) {
		discard;
	}
	vec3 big = texture(detail, world.xz / 37.0).rgb;
	vec3 stones = texture(detail, world.xz / 0.9).rgb;
	float gravel = texture(detail, world.xz / 0.31).b;
	float on_road = 1.0 - smoothstep(UV2.x + 0.2, UV2.y + 0.2, lat);
	// Damp patches: darker, a touch smoother, mostly off the racing line.
	float damp = smoothstep(0.6, 0.7, big.g) * on_road;
	c *= 1.0 - damp * damp_k;
	// Dusty crown between the wheel tracks, drier where it isn't damp.
	float crown = 1.0 - smoothstep(0.35, 0.8, lat);
	c = mix(c, c * 1.22 + vec3(0.02), crown * (1.0 - damp) * 0.6 * (1.0 - ice));
	// Compacted tracks: where the wheels run, the gravel is pushed aside.
	float track = 1.0 - smoothstep(0.15, 0.5, abs(lat - 1.25));
	// Loose gravel everywhere off the tracks, thinning out into the apron.
	float loose = (1.0 - track * 0.75) * (1.0 - smoothstep(1.0, 2.6, past)) * (1.0 - ice);
	// Loose stones: light and dark pebbles, more at the verge than in the ruts.
	float light_st = smoothstep(0.66, 0.7, stones.r) * loose;
	float dark_st = smoothstep(0.68, 0.72, stones.g) * loose;
	c = mix(c, c_stone_light, light_st * 0.7);
	c = mix(c, c_stone_dark, dark_st * 0.6);
	c *= 0.9 + gravel * 0.2 * (1.0 - ice * 0.7);
	// Washboard: ripples across the road, strongest off the wheel tracks.
	if (washboard > 0.0) {
		float rip = sin(UV.y * 9.0 + big.r * 4.0);
		c *= 1.0 - washboard * smoothstep(0.3, 1.0, rip) * (1.0 - track * 0.5) * on_road;
	}
	// Grass and moss creeping in from the edge, in patches.
	float creep = smoothstep(UV2.x - 0.5, UV2.y, lat) * smoothstep(0.45, 0.6, fray.g);
	c = mix(c, c_creep, creep * creep_k);
	// Drifts of blown sand across the road, in long tongues off the verge.
	if (drift > 0.0) {
		float tongue = smoothstep(0.55, 0.7, texture(detail, vec2(world.x, world.z) / 23.0 + vec2(0.13, 0.71)).r + (lat / max(UV2.y, 0.1)) * 0.25);
		c = mix(c, c_drift * (0.92 + gravel * 0.16), tongue * drift * (1.0 - track * 0.6) * (1.0 - ice * 0.8));
	}
	float mist = 0.0;
	if (weather_seen(CAMERA_VISIBLE_LAYERS)) {
		c *= 1.0 - cloud_shade_at(world.xz, false);
		mist = v_mist;
	}
	ALBEDO = c * (1.0 - mist);
	EMISSION = mist_tint * mist;
	ROUGHNESS = mix(mix(0.95, 0.8, damp), 0.22, ice);
	SPECULAR = mix(0.25, 0.6, ice); // 0.25 as the palette material, so the road lights like everything else
}
