class_name CarPaint
extends RefCounted
## Team livery (spec §7.4, §10): the body's blue paint swapped for the team
## colour, and the roof plate cut to the team's shape with its number on it.
## Colour is never the only tell; the shape and the number go with it.
##
## The baked body mesh carries its paint as vertex colours (bake_assets.gd's
## CAR_PAINT, keeping the atlas's light-to-dark ramp). Repainting finds those
## vertices by hue and moves them to the new colour along the same ramp, so
## the shading on the panels survives. One mesh per colour, cached: the
## ghosts of a team share theirs.

## The bake's paint (bake_assets.gd CAR_PAINT). Vertices near this hue and
## this saturated are bodywork; the rest is glass, trim and tyres.
const BAKED_PAINT := Color("1f6fe0")
const HUE_TOLERANCE := 0.05
const MIN_SAT := 0.5
## Team colours are picked to read on a screen; under the stage's sun a
## full-value paint clips its brightest channel and orange goes yellow. The
## livery sits this much darker so the lit panels land on the team colour.
const EXPOSURE := 0.78

## shared/types.ts TEAM_COLORS, for a ghost relay that only names a colour.
## Keep in step with that list; an unknown colour gets a circle.
const SHAPE_BY_COLOR := {
	"e69f00": "circle", "56b4e9": "square", "009e73": "triangle", "cc79a7": "diamond",
}
const SHAPES := ["circle", "square", "triangle", "diamond"]
const PLATE_RADIUS := 0.42
const PLATE_WHITE := Color(0.96, 0.96, 0.94)

static var _painted := {} ## "<mesh id>:<html>" -> ArrayMesh
static var _plates := {} ## shape -> Mesh


## Body paint, roof plate and number on a car scene (car.tscn's node layout).
## Always repaints from the baked mesh, so calling it twice is harmless.
static func apply(car: Node3D, color: Color, number: int, shape: String) -> void:
	var body := car.get_node_or_null("Visual/Body") as MeshInstance3D
	if body:
		if not body.has_meta("baked_mesh"):
			body.set_meta("baked_mesh", body.mesh)
		body.mesh = repaint(body.get_meta("baked_mesh"), color)
	var plate := car.get_node_or_null("Visual/Body/Roundel") as MeshInstance3D
	if plate:
		plate.mesh = plate_mesh(shape)
	var label := car.get_node_or_null("Visual/Body/Roundel/Number") as Label3D
	if label:
		label.text = str(number)
		# A triangle's middle is smaller than a circle's.
		label.font_size = 72 if shape == "triangle" else 96


static func shape_for(color_hex: String) -> String:
	return SHAPE_BY_COLOR.get(color_hex.trim_prefix("#").to_lower(), "circle")


static func valid_shape(s: String) -> String:
	return s if SHAPES.has(s) else "circle"


## `src` with its paint moved to `color`, same light-to-dark ramp.
static func repaint(src: ArrayMesh, color: Color) -> ArrayMesh:
	var key := "%d:%s" % [src.get_instance_id(), color.to_html(false)]
	if _painted.has(key):
		return _painted[key]
	var out := ArrayMesh.new()
	for s in src.get_surface_count():
		var arrays := src.surface_get_arrays(s)
		var cols: PackedColorArray = arrays[Mesh.ARRAY_COLOR]
		for i in cols.size():
			if is_paint(cols[i]):
				cols[i] = shade(cols[i], color)
		arrays[Mesh.ARRAY_COLOR] = cols
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		out.surface_set_material(s, src.surface_get_material(s))
	_painted[key] = out
	return out


static func is_paint(c: Color) -> bool:
	return c.s > MIN_SAT and absf(c.h - BAKED_PAINT.h) < HUE_TOLERANCE


## One baked paint vertex, recoloured: its brightness and saturation relative
## to the baked paint carry over to the new colour.
static func shade(c: Color, to: Color) -> Color:
	var v := clampf(to.v * EXPOSURE * c.v / BAKED_PAINT.v, 0.0, 1.0)
	var s := clampf(to.s * c.s / BAKED_PAINT.s, 0.0, 1.0)
	return Color.from_hsv(to.h, s, v, c.a)


## The flat roof plate in a team's shape, in the plate node's space (+z is
## forward on the road). The car's number sits on it. Drawn from both sides,
## so its winding can't hide it.
static func plate_mesh(shape: String) -> Mesh:
	shape = valid_shape(shape)
	if _plates.has(shape):
		return _plates[shape]
	var pts := PackedVector2Array() # (x, z)
	match shape:
		"circle":
			for i in 20:
				var a := TAU * i / 20.0
				pts.append(Vector2(cos(a), sin(a)) * PLATE_RADIUS)
		"square":
			var h := PLATE_RADIUS * 0.88
			pts = PackedVector2Array([Vector2(-h, -h), Vector2(h, -h), Vector2(h, h), Vector2(-h, h)])
		"triangle":
			# Point forward; the number sits a touch behind the middle.
			pts = PackedVector2Array([Vector2(0, 0.56), Vector2(0.5, -0.32), Vector2(-0.5, -0.32)])
		"diamond":
			pts = PackedVector2Array([Vector2(0, 0.52), Vector2(0.38, 0), Vector2(0, -0.52), Vector2(-0.38, 0)])
	var mat := StandardMaterial3D.new()
	mat.albedo_color = PLATE_WHITE
	mat.roughness = 0.7
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_normal(Vector3.UP)
	var c := Vector3(0, 0.01, 0)
	for i in pts.size():
		var p := Vector3(pts[i].x, 0.01, pts[i].y)
		var q := Vector3(pts[(i + 1) % pts.size()].x, 0.01, pts[(i + 1) % pts.size()].y)
		for v in [c, p, q, c, q, p]:
			st.add_vertex(v)
	st.set_material(mat)
	var out := st.commit()
	_plates[shape] = out
	return out


## One mesh for a whole ghost car: body (repainted), four wheels and the roof
## plate, merged into a single surface with vertex colours, so a ghost is one
## draw plus its number. `car` is a car.tscn instance to copy the layout from.
static func ghost_mesh(car: Node3D, color: Color, shape: String) -> ArrayMesh:
	var key := "ghost:%s:%s" % [color.to_html(false), valid_shape(shape)]
	if _painted.has(key):
		return _painted[key]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var root_inv := car.global_transform.affine_inverse()
	var body := car.get_node("Visual/Body") as MeshInstance3D
	var baked: ArrayMesh = body.get_meta("baked_mesh", body.mesh)
	for path in ["Visual/Body", "Visual/WheelFL", "Visual/WheelFR", "Visual/WheelRL", "Visual/WheelRR"]:
		var mi := car.get_node_or_null(path) as MeshInstance3D
		if mi == null:
			continue
		var mesh: Mesh = repaint(baked, color) if path == "Visual/Body" else mi.mesh
		st.append_from(mesh, 0, root_inv * mi.global_transform)
	var plate := car.get_node_or_null("Visual/Body/Roundel") as MeshInstance3D
	if plate:
		st.append_from(_coloured(plate_mesh(shape), PLATE_WHITE), 0, root_inv * plate.global_transform)
	var out := st.commit()
	_painted[key] = out
	return out


## A copy of surface 0 with a flat vertex colour and no index, so it can be
## merged with the baked (vertex-coloured, unindexed) meshes.
static func _coloured(src: Mesh, c: Color) -> ArrayMesh:
	var arrays := src.surface_get_arrays(0)
	var n := (arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
	var cols := PackedColorArray()
	cols.resize(n)
	cols.fill(c)
	arrays[Mesh.ARRAY_COLOR] = cols
	var tmp := ArrayMesh.new()
	tmp.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	# Unindexed, like the baked meshes it's merged with: SurfaceTool turns a
	# merge indexed as soon as one indexed piece arrives, and drops the rest.
	var st := SurfaceTool.new()
	st.create_from(tmp, 0)
	st.deindex()
	return st.commit()
