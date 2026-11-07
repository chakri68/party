// Falling rain (Weather, every biome but snow). One MultiMesh of thin quads;
// nothing moves on the CPU. Built like snowfall.gdshader: each drop's
// INSTANCE_CUSTOM is a fixed random point in a box (xyz 0..1) and a speed
// jitter (w); the box follows `centre` (Weather: the camera's spot, a bit
// ahead of it at eye level, the car top-down) and drops wrap round it, so
// it never runs out and nothing spawns. `vel` is the fall plus the
// weather's wind, so the streaks slant with it; `t` is the race clock.
// Each streak is a quad stretched along `vel` and turned to face the eye
// round that axis.
//
// Render layer 4 (weather): the 3D view only, never the static map.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, world_vertex_coords;

uniform vec3 centre = vec3(0.0);
uniform vec3 box = vec3(30.0, 16.0, 30.0);
uniform vec3 vel = vec3(0.0, -9.0, 0.0); // m/s: the fall, and the wind's push
uniform float t = 0.0; // race clock
uniform float width = 0.018; // metres across
uniform float streak = 0.7; // metres long
uniform vec3 tint : source_color = vec3(0.78, 0.83, 0.9);
uniform float opacity = 0.32;
uniform vec3 sky_tint : source_color = vec3(1.0); // the sky's haze, SkyClock.haze: dims the rain at night; layer 4, never on the map

varying float v_fade;

void vertex() {
	vec4 c = INSTANCE_CUSTOM;
	vec3 lo = centre - vec3(box.x * 0.5, box.y * 0.3, box.z * 0.5);
	vec3 p = c.xyz * box + vel * t * (0.85 + 0.3 * c.w);
	p = lo + mod(p - lo, box);
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 along = normalize(vel);
	// Ortho (top-down) looks along -Z of the view; perspective, from the eye.
	vec3 look = PROJECTION_MATRIX[3][3] > 0.5 ? -INV_VIEW_MATRIX[2].xyz : p - cam;
	vec3 side = cross(along, look);
	side = dot(side, side) > 1e-8 ? normalize(side) : INV_VIEW_MATRIX[0].xyz;
	VERTEX = p + side * VERTEX.x * width + along * VERTEX.y * streak * (0.8 + 0.4 * c.w);
	// Fade in at the top and out at the walls of the box, so the wrap never shows.
	vec3 q = (p - lo) / box;
	v_fade = smoothstep(0.0, 0.06, q.y) * (1.0 - smoothstep(0.85, 1.0, q.y))
		* (1.0 - smoothstep(0.38, 0.5, abs(q.x - 0.5))) * (1.0 - smoothstep(0.38, 0.5, abs(q.z - 0.5)));
	// Right at the lens a streak is a smear: gone inside a metre.
	v_fade *= smoothstep(0.4, 1.2, distance(p, cam));
}

void fragment() {
	float across = abs(UV.x - 0.5) * 2.0;
	float along_k = sin(UV.y * 3.14159);
	ALBEDO = tint * sky_tint;
	ALPHA = (1.0 - across * across) * along_k * opacity * v_fade;
}
