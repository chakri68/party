// Cliffhanger's sea: one flat plane, opaque, lit. What makes it water:
// - Colour by depth, from the builder's shore texture (R = depth over the
//   seabed, G = distance to the nearest shore; tools/build_cliffhanger.gd
//   _sea): turquoise over the rock shelf at the cliff foot, deep blue out.
// - A swell: two fetches of the shared detail noise, scrolling apart,
//   tilt the normal, so the sun glints and the surface moves. No vertex
//   waves (the plane is two triangles).
// - Surf: a foam band where the water meets rock, a few metres wide and
//   breathing with a line that runs in toward the shore, broken up by the
//   noise so it froths rather than outlines.
// Cheap on purpose (Compatibility, phones): three texture fetches, no
// depth or screen reads, no transparency. Weather as every world surface.
shader_type spatial;
render_mode cull_back;

#include "res://shaders/weather.gdshaderinc"

uniform sampler2D shore : filter_linear, repeat_disable;
uniform vec4 shore_rect = vec4(0.0, 0.0, 1.0, 1.0); // origin xz, size xz (metres)
uniform vec2 shore_scale = vec2(16.0, 48.0); // metres the R and G channels span
uniform vec3 c_deep : source_color = vec3(0.09, 0.24, 0.33);
uniform vec3 c_mid : source_color = vec3(0.12, 0.36, 0.42);
uniform vec3 c_shallow : source_color = vec3(0.24, 0.55, 0.54);
uniform vec3 c_foam : source_color = vec3(0.9, 0.93, 0.93);

varying vec3 world;
varying float v_mist;

void vertex() {
	world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_mist = weather_seen(CAMERA_VISIBLE_LAYERS) ? eye_mist(INV_VIEW_MATRIX[3].xyz, world) : 0.0;
}

void fragment() {
	vec2 uv = (world.xz - shore_rect.xy) / shore_rect.zw;
	vec2 sd = vec2(1.0);
	if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
		sd = texture(shore, uv).rg;
	}
	float depth = sd.r * shore_scale.x;
	float dist = sd.g * shore_scale.y;
	vec2 t = vec2(TIME * 0.011, TIME * 0.007);
	vec3 a = texture(detail, world.xz / 29.0 + t).rgb;
	vec3 b = texture(detail, world.xz / 8.5 - t * 2.3 + vec2(0.37, 0.61)).rgb;
	vec2 slope = (a.rg - 0.5) * 0.28 + (b.gb - 0.5) * 0.16;
	vec3 nw = normalize(vec3(slope.x, 1.0, slope.y));
	NORMAL = normalize((VIEW_MATRIX * vec4(nw, 0.0)).xyz);
	vec3 c = mix(c_shallow, c_mid, smoothstep(0.4, 4.0, depth));
	c = mix(c, c_deep, smoothstep(4.0, 13.0, depth));
	// Lighter where the swell faces up, darker in the troughs.
	c *= 0.9 + (a.b - 0.5) * 0.25 + (b.r - 0.5) * 0.12;
	// Surf: the band at the rock, and a line breathing in toward it.
	float swell = 0.5 + 0.5 * sin(dist * 0.85 - TIME * 1.5 + a.r * 4.0);
	float band = 1.0 - smoothstep(0.4, 2.6 + swell * 2.4, dist);
	float froth = smoothstep(0.42, 0.62, b.r * 0.7 + a.g * 0.3 + band * 0.45);
	float foam = clamp(band * froth + (1.0 - smoothstep(0.0, 0.9, dist)) * 0.8, 0.0, 1.0);
	c = mix(c, c_foam, foam * 0.92);
	float mist = 0.0;
	if (weather_seen(CAMERA_VISIBLE_LAYERS)) {
		c *= 1.0 - cloud_shade_at(world.xz, false);
		mist = v_mist;
	}
	ALBEDO = c * (1.0 - mist);
	EMISSION = mist_tint * mist;
	// The map looks straight down and is drawn once: a sun glint there
	// would be a white blot frozen on the chart. Matte when looking down.
	float chart = smoothstep(0.96, 0.99, INV_VIEW_MATRIX[2].y);
	ROUGHNESS = mix(mix(0.34, 0.9, foam), 1.0, chart);
	SPECULAR = mix(mix(0.35, 0.15, foam), 0.05, chart);
}
