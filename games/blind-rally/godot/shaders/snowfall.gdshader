// Falling snow (Weather, snow biome). One MultiMesh of small quads; nothing
// moves on the CPU. Each flake's INSTANCE_CUSTOM is a fixed random point in a
// box (xyz 0..1) and a size/speed jitter (w); Weather hands over `drift`, the
// metres the air has moved since the race started (wind sideways, fall
// down, race clock, so it's the same snow for every team), and the box
// follows `centre` (the car). Flakes wrap round the box, so it never runs out
// and nothing spawns. Billboarded to the camera here.
//
// Render layer 4 (weather): the 3D view only, never the static map.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, world_vertex_coords;

uniform vec3 centre = vec3(0.0);
uniform vec3 box = vec3(64.0, 28.0, 64.0);
uniform vec3 drift = vec3(0.0);
uniform float flake = 0.09; // metres across, before jitter
uniform float t = 0.0; // race clock, for the flutter
uniform vec3 tint : source_color = vec3(0.96, 0.97, 1.0);
uniform float opacity = 0.85;

varying float v_fade;

void vertex() {
	vec4 c = INSTANCE_CUSTOM;
	vec3 lo = centre - vec3(box.x * 0.5, 3.0, box.z * 0.5);
	vec3 p = c.xyz * box + drift * (0.75 + 0.5 * c.w);
	// Flutter: a lazy sideways wander, its own phase per flake.
	p.x += sin(t * 1.1 + c.w * 37.0) * 0.6;
	p.z += cos(t * 0.9 + c.w * 53.0) * 0.6;
	p = lo + mod(p - lo, box);
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 right = INV_VIEW_MATRIX[0].xyz;
	vec3 up = INV_VIEW_MATRIX[1].xyz;
	float s = flake * (0.6 + 0.9 * c.w);
	VERTEX = p + (right * VERTEX.x + up * VERTEX.y) * s;
	// Fade in at the top and out at the walls of the box, so the wrap never shows.
	vec3 q = (p - lo) / box;
	v_fade = smoothstep(0.0, 0.08, q.y) * (1.0 - smoothstep(0.85, 1.0, q.y))
		* (1.0 - smoothstep(0.38, 0.5, abs(q.x - 0.5))) * (1.0 - smoothstep(0.38, 0.5, abs(q.z - 0.5)));
	// Too close to the lens is a white blot: gone by half a metre.
	v_fade *= smoothstep(0.5, 1.6, distance(p, cam));
}

void fragment() {
	float r = length(UV - vec2(0.5)) * 2.0;
	ALBEDO = tint;
	ALPHA = (1.0 - smoothstep(0.35, 1.0, r)) * opacity * v_fade;
}
