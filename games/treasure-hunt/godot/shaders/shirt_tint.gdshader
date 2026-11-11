// The Mini Characters' colormap, with one swatch (the shirt) recoloured.
// The colormap is 16 columns by 4 rows of 32 x 128 px cells (the top row is
// black and unused). Inside `cell` the shirt's own shading is kept: the
// texel's brightness over the cell's middle texel scales the team colour,
// so the vertical gradient survives. Everywhere else the texture passes
// through, so skin, trousers and hair are untouched.
shader_type spatial;
render_mode cull_disabled;

uniform vec4 team_color : source_color = vec4(1.0);
uniform ivec2 cell = ivec2(0);
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_disable;

float lum(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void fragment() {
	vec4 tex = texture(albedo_tex, UV);
	vec3 rgb = tex.rgb;
	ivec2 here = ivec2(floor(UV * vec2(16.0, 4.0)));
	if (here == cell) {
		vec2 mid = (vec2(cell) + vec2(0.5)) / vec2(16.0, 4.0);
		float base = max(lum(textureLod(albedo_tex, mid, 0.0).rgb), 0.001);
		rgb = clamp(team_color.rgb * (lum(tex.rgb) / base), 0.0, 1.0);
	}
	ALBEDO = rgb;
	ROUGHNESS = 1.0;
	METALLIC = 0.0;
}
