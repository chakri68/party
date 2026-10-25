// Gravel road. Vertex colour carries the cross-section the track tool baked
// (verge, wheel ruts, crown, ditch); UV.x is metres from the centreline, UV.y
// metres along the stage, UV2 = (half width, verge edge) at that point. On
// top: loose stones, damp patches, a dusty crown, compacted tracks on the
// racing line, moss creeping into the verge, and a ragged outer edge: past
// the ditch the mesh is an apron the noise eats away, so gravel spills onto
// the forest floor in patches instead of stopping at a ruled line.
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

varying vec3 world;
varying float v_mist; // per vertex: a smooth field, and the ground is most of the screen

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_mist = weather_seen(CAMERA_VISIBLE_LAYERS) ? eye_mist(INV_VIEW_MATRIX[3].xyz, world) : 0.0;
}

void fragment() {
	vec3 c = COLOR.rgb;
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
	c *= 1.0 - damp * 0.2;
	// Dusty crown between the wheel tracks, drier where it isn't damp.
	float crown = 1.0 - smoothstep(0.35, 0.8, lat);
	c = mix(c, c * 1.22 + vec3(0.02), crown * (1.0 - damp) * 0.6);
	// Compacted tracks: where the wheels run, the gravel is pushed aside.
	float track = 1.0 - smoothstep(0.15, 0.5, abs(lat - 1.25));
	// Loose gravel everywhere off the tracks, thinning out into the apron.
	float loose = (1.0 - track * 0.75) * (1.0 - smoothstep(1.0, 2.6, past));
	// Loose stones: light and dark pebbles, more at the verge than in the ruts.
	float light_st = smoothstep(0.66, 0.7, stones.r) * loose;
	float dark_st = smoothstep(0.68, 0.72, stones.g) * loose;
	c = mix(c, vec3(0.68, 0.66, 0.61), light_st * 0.7);
	c = mix(c, vec3(0.27, 0.25, 0.22), dark_st * 0.6);
	c *= 0.9 + gravel * 0.2;
	// Grass and moss creeping in from the edge, in patches.
	float creep = smoothstep(UV2.x - 0.5, UV2.y, lat) * smoothstep(0.45, 0.6, fray.g);
	c = mix(c, vec3(0.30, 0.36, 0.18), creep * 0.75);
	float mist = 0.0;
	if (weather_seen(CAMERA_VISIBLE_LAYERS)) {
		c *= 1.0 - cloud_shade_at(world.xz, false);
		mist = v_mist;
	}
	ALBEDO = c * (1.0 - mist);
	EMISSION = mist_tint * mist;
	ROUGHNESS = mix(0.95, 0.8, damp);
	SPECULAR = 0.25; // as the palette material, so the road lights like everything else
}
