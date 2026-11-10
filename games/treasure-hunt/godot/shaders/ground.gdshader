// The ground, M1: the biome colour from the mesh, lit, and a little darker
// where it's steep so slopes read without textures. No weather yet.
shader_type spatial;
render_mode cull_back;

uniform float slope_dark = 0.35; // how much darker a cliff face gets

varying float v_up; // world normal's y

void vertex() {
	v_up = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz).y;
}

void fragment() {
	float steep = 1.0 - smoothstep(0.55, 0.9, v_up);
	ALBEDO = COLOR.rgb * (1.0 - slope_dark * steep);
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
}
