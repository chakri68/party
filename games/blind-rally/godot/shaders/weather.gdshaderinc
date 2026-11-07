// Weather terms shared by every world shader (ground, road, palette, forest
// impostors). Weather.gd owns the numbers and pushes them to each material
// it's told about (Weather.register); nothing here keeps state.
//
// Two effects:
// - Cloud shade: the same drifting cloud field the old overlay quad drew, but
//   multiplied into the surface's albedo, so it lies on the ground (and the
//   trees, and the car) in any camera with no horizon line to give it away.
// - Eye-level mist: ground-hugging banks as soft discs in XZ. Each pixel
//   integrates how much bank its view ray crosses on the way from the camera,
//   so a bank hides the road behind it, not just under it. Only counted past
//   the car plus a keyhole, so the car itself is never in it. The top-down
//   camera gets the old puff sprites instead (mist_count stays 0 then).
//
// - Night (the sky's light): sky_light() multiplies the surface colour by
//   the tint and darkens it toward NIGHT_FLOOR, so road edges stay faintly
//   readable at full dark. Sky (sky.gd) sets both, through Weather.
// - Headlights (night): sky_light() adds back what the dark took inside
//   our car's cone (long and narrow, plus a short wide spread that shows
//   corners) and a short cone in front of each rival ghost. No Light3D:
//   just distance and angle in XZ. Weather pushes head_* and ghost_heads
//   only while it's dark; head_on 0 (day) skips the lot.
//
// - Rain (the SkyClock's wetness): sky_wet darkens the ground and the road
//   and makes the road glossy; puddle_at() is the standing water, soft discs
//   in XZ the road shader mixes in by sky_wet. Weather pushes sky_wet only
//   when the wetness moves and the puddles once per session, so a dry or
//   steady sky costs nothing per frame. At sky_wet 0 nothing changes.
//
// The map camera never sees any of it: it doesn't draw render layer 4, the
// weather layer, and CAMERA_VISIBLE_LAYERS says so. That keeps the static map
// identical whatever the sky is doing.

uniform sampler2D detail : filter_linear_mipmap, repeat_enable;
uniform vec2 cloud_offset = vec2(0.0); // wind * time, metres
uniform float cloud_coverage = -0.2; // 0 clear .. ~0.6 mostly cloudy
uniform float cloud_strength = 0.0; // how dark a full shadow gets

const int MIST_MAX = 16;
uniform vec4 mist_puffs[16]; // xz centre, radius, opacity now
uniform int mist_count = 0;
uniform vec3 mist_car = vec3(0.0);
uniform vec2 mist_keyhole = vec2(3.5, 9.0); // clear for x metres past the car, full by y
uniform float mist_max = 0.78;
uniform float mist_density = 0.075; // per metre of bank crossed, at full opacity
uniform float mist_top = 11.0; // metres above the car where the mist has thinned out
uniform vec3 mist_tint : source_color = vec3(0.8, 0.83, 0.85);

uniform float sky_dark = 0.0; // 0 day .. 1 night
uniform vec3 sky_tint : source_color = vec3(1.0);
const float NIGHT_FLOOR = 0.12; // a full night keeps this share of day brightness

// Headlights. head_on is the darkness, so they fade in at dusk.
uniform vec3 head_pos = vec3(0.0); // our car, interpolated
uniform vec2 head_dir = vec2(0.0, -1.0); // its -Z in xz, unit
uniform float head_on = 0.0;
const int GHOST_HEADS_MAX = 7; // GhostCars.MAX_GHOSTS
uniform vec4 ghost_heads[7]; // x, z, yaw, strength
uniform int ghost_head_count = 0;

// The cone numbers, all of them. Edges are cosines: (fully dark, fully lit).
const float HEAD_LEN = 60.0; // metres
const vec2 HEAD_EDGE = vec2(0.883, 0.961); // cos 28, cos 16: a ~22 degree half-angle, soft
const float SPREAD_LEN = 20.0; // the corner spread
const vec2 SPREAD_EDGE = vec2(0.342, 0.643); // cos 70, cos 50: ~60 degrees
const float SPREAD_K = 0.5;
const vec2 HEAD_TOP = vec2(3.0, 9.0); // metres above the lamps: lit below x, dark by y (no lit treetops)
const float GHOST_LEN = 25.0;
const float GHOST_K = 0.5;
const float GHOST_REACH = 80.0; // a pixel this far from a ghost skips its cone
const vec3 HEAD_TINT = vec3(1.0, 0.95, 0.85); // halogen, a touch warm

uniform float sky_wet = 0.0; // 0 dry .. 1 soaked: the road's wetness, not the rain
const int PUDDLE_MAX = 24; // Puddles.PUDDLE_MAX
uniform vec3 puddles[24]; // x, z, radius
uniform int puddle_count = 0;

bool weather_seen(uint layers) {
	return (layers & 8u) != 0u;
}

// Lod 0 in the vertex stage (no derivatives there), normal sampling otherwise.
float cloud_shade_at(vec2 xz, bool in_vertex) {
	vec2 p = (xz - cloud_offset) / 180.0;
	float n;
	if (in_vertex) {
		n = textureLod(detail, p, 0.0).r * 0.7 + textureLod(detail, p * 2.3 + vec2(0.31, 0.77), 0.0).g * 0.3;
	} else {
		n = texture(detail, p).r * 0.7 + texture(detail, p * 2.3 + vec2(0.31, 0.77)).g * 0.3;
	}
	return smoothstep(1.0 - cloud_coverage - 0.12, 1.0 - cloud_coverage + 0.12, n) * cloud_strength;
}

// 0..mist_max: how much mist lies between the camera and `world`.
float eye_mist(vec3 cam, vec3 world) {
	if (mist_count <= 0) {
		return 0.0;
	}
	vec2 o = cam.xz;
	vec2 to = world.xz - o;
	float len = length(to);
	float car_d = length(mist_car.xz - o);
	float t0 = car_d + mist_keyhole.x;
	if (len <= t0) {
		return 0.0;
	}
	vec2 d = to / len;
	float acc = 0.0;
	for (int i = 0; i < MIST_MAX; i++) {
		if (i >= mist_count) {
			break;
		}
		vec4 p = mist_puffs[i];
		vec2 oc = p.xy - o;
		float tc = dot(oc, d);
		float h2 = dot(oc, oc) - tc * tc;
		float r2 = p.z * p.z;
		if (h2 < r2) {
			float hw = sqrt(r2 - h2);
			float a = max(tc - hw, t0);
			float b = min(tc + hw, len);
			// Thicker through the middle of a bank than across its rim.
			acc += max(b - a, 0.0) * p.w * (1.0 - h2 / r2);
		}
	}
	float ramp = smoothstep(car_d + mist_keyhole.x, car_d + mist_keyhole.y, len);
	float low = 1.0 - smoothstep(mist_top * 0.35, mist_top, world.y - mist_car.y);
	return min(1.0 - exp(-acc * mist_density), mist_max) * ramp * low;
}

// 0..1 of a cone from the origin along `dir` (unit), at offset `to`:
// soft at the sides, brightest near the lamp, gone by `len`.
float head_cone(vec2 to, vec2 dir, float len, vec2 edge) {
	float d = length(to);
	if (d >= len || d < 0.001) {
		return 0.0;
	}
	return smoothstep(edge.x, edge.y, dot(to, dir) / d) * (1.0 - smoothstep(0.0, len, d));
}

// How much of the dark the headlights take back at `world`: up to
// (1 - NIGHT_FLOOR) * head_on, so a full beam at night is day brightness.
float headlights(vec3 world) {
	vec2 to = world.xz - head_pos.xz;
	float own = max(head_cone(to, head_dir, HEAD_LEN, HEAD_EDGE),
			SPREAD_K * head_cone(to, head_dir, SPREAD_LEN, SPREAD_EDGE));
	own *= 1.0 - smoothstep(HEAD_TOP.x, HEAD_TOP.y, world.y - head_pos.y);
	float rivals = 0.0;
	for (int i = 0; i < GHOST_HEADS_MAX; i++) {
		if (i >= ghost_head_count) {
			break;
		}
		vec4 g = ghost_heads[i];
		vec2 gt = world.xz - g.xy;
		if (dot(gt, gt) > GHOST_REACH * GHOST_REACH) {
			continue;
		}
		rivals += GHOST_K * g.w * head_cone(gt, vec2(-sin(g.z), -cos(g.z)), GHOST_LEN, HEAD_EDGE);
	}
	return min(own + rivals, 1.0) * head_on * (1.0 - NIGHT_FLOOR);
}

// What the light does to a surface at `world`, with darkness `dark` (the
// palette caps it near the car). White and 1 by day. Call it only inside a
// weather_seen() branch.
vec3 sky_light_at(vec3 world, float dark) {
	vec3 l = sky_tint * mix(1.0, NIGHT_FLOOR, dark);
	if (head_on > 0.0) {
		l = min(l + HEAD_TINT * headlights(world), vec3(1.0));
	}
	return l;
}

vec3 sky_light(vec3 world) {
	return sky_light_at(world, sky_dark);
}

// The air's colour: the tint, dimmed with the dark toward HAZE_FLOOR
// (SkyClock.HAZE_FLOOR, the same number). The mist glow takes this, not the
// bare tint, so banks don't shine over a dark stage.
const float HAZE_FLOOR = 0.3;
vec3 sky_haze() {
	return sky_tint * mix(1.0, HAZE_FLOOR, sky_dark);
}

// 0..1: how much standing water is at `xz`. Soft discs with a ragged rim
// (the shared noise nudges the edge), so they read as puddles, not decals.
// Fragment stage only.
float puddle_at(vec2 xz) {
	if (puddle_count <= 0) {
		return 0.0;
	}
	float rim = (texture(detail, xz / 1.7).g - 0.5) * 0.35;
	float m = 0.0;
	for (int i = 0; i < PUDDLE_MAX; i++) {
		if (i >= puddle_count) {
			break;
		}
		vec3 p = puddles[i];
		vec2 d = xz - p.xy;
		if (dot(d, d) < p.z * p.z * 1.6) {
			m = max(m, 1.0 - smoothstep(0.7, 1.0, length(d) / p.z + rim));
		}
	}
	return m;
}
