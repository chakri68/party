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
// The map camera never sees either: it doesn't draw render layer 4, the
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
