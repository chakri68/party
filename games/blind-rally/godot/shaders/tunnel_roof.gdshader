// The rock and heath over Cliffhanger's sea tunnel (scripts/tunnel_roof.gd).
// Vertex colours carry the look (the builder bakes heath, grass and the
// portals' stone); a little world-space grain on top, and the weather terms
// like every world surface. `cut` dissolves it for the top-down camera: a
// 4x4 ordered dither in screen space drops that share of its pixels, so it
// stays an opaque surface (no blending, no sorting) and the road shows
// through. The shadow pass runs the same discard, so a cut roof also lets
// the sun in, which is what you'd want to see down there anyway.
shader_type spatial;
render_mode cull_back;

#include "res://shaders/weather.gdshaderinc"

uniform float cut = 0.0;

varying vec3 world;
varying float v_mist;

int bayer2(int x, int y) {
	return (((x ^ y) & 1) << 1) | (y & 1);
}

// 4x4 ordered dither threshold at a pixel, 0..1 (centred in each of 16 steps).
float bayer4(vec2 p) {
	int x = int(p.x) & 3;
	int y = int(p.y) & 3;
	return (float(4 * bayer2(x & 1, y & 1) + bayer2(x >> 1, y >> 1)) + 0.5) / 16.0;
}

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_mist = weather_seen(CAMERA_VISIBLE_LAYERS) ? eye_mist(INV_VIEW_MATRIX[3].xyz, world) : 0.0;
}

void fragment() {
	if (cut > 0.0 && bayer4(FRAGCOORD.xy) < cut) {
		discard;
	}
	vec3 c = COLOR.rgb * (0.88 + texture(detail, world.xz / 5.3).b * 0.24);
	float mist = 0.0;
	if (weather_seen(CAMERA_VISIBLE_LAYERS)) {
		c *= 1.0 - cloud_shade_at(world.xz, false);
		mist = v_mist;
	}
	ALBEDO = c * (1.0 - mist);
	EMISSION = mist_tint * mist;
	ROUGHNESS = 0.95;
	SPECULAR = 0.25;
}
