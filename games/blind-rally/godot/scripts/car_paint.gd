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
	"f0e442": "pentagon", "0072b2": "hexagon", "d55e00": "star", "e8e6e1": "cross",
}
const SHAPES := ["circle", "square", "triangle", "diamond", "pentagon", "hexagon", "star", "cross"]
const PLATE_RADIUS := 0.42
## Shapes whose middle (where the number sits) is smaller than a circle's.
const SMALL_MIDDLE := ["triangle", "star", "cross"]
const PLATE_WHITE := Color(0.96, 0.96, 0.94)

static var _painted := {} ## "<mesh id>:<html>" -> ArrayMesh
static var _plates := {} ## shape -> Mesh


## Body paint, roof plate and number on a car scene (car.tscn's node layout).
## Always repaints from the baked mesh, so calling it twice is harmless.
## Remembered on the car, so a class change (Vehicles.dress) can put it back.
static func apply(car: Node3D, color: Color, number: int, shape: String) -> void:
	car.set_meta("livery", [color, number, shape])
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
		# A triangle's, star's or cross's middle is smaller than a circle's.
		label.font_size = 72 if shape in SMALL_MIDDLE else 96


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
		# The new four are sized to about the circle's area (0.55 m2), point forward.
		"pentagon":
			pts = _polygon(5, 0.48)
		"hexagon":
			pts = _polygon(6, 0.46)
		"star":
			# Ten points, outer and inner in turn.
			for i in 10:
				var a := PI / 2.0 + TAU * i / 10.0
				pts.append(Vector2(cos(a), sin(a)) * (0.6 if i % 2 == 0 else 0.26))
		"cross":
			# Arms 0.34 wide, 1.0 long, stepping round clockwise from the front arm.
			var w := 0.17
			var l := 0.5
			pts = PackedVector2Array([
				Vector2(-w, l), Vector2(w, l), Vector2(w, w), Vector2(l, w), Vector2(l, -w), Vector2(w, -w),
				Vector2(w, -l), Vector2(-w, -l), Vector2(-w, -w), Vector2(-l, -w), Vector2(-l, w), Vector2(-w, w)])
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


## A regular polygon with a point at the front, `r` to its corners.
static func _polygon(sides: int, r: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in sides:
		var a := PI / 2.0 + TAU * i / sides
		pts.append(Vector2(cos(a), sin(a)) * r)
	return pts


## One mesh for a whole ghost car: body (repainted), four wheels and the roof
## plate, merged into a single surface with vertex colours, so a ghost is one
## draw plus its number. Built from the class's model (Vehicles), in car space,
## so a ghost needn't match our own car.
static func ghost_mesh(vehicle: String, color: Color, shape: String) -> ArrayMesh:
	vehicle = Vehicles.valid(vehicle)
	var key := "ghost:%s:%s:%s" % [vehicle, color.to_html(false), valid_shape(shape)]
	if _painted.has(key):
		return _painted[key]
	var m: Dictionary = Vehicles.get_preset(vehicle)["model"]
	# car.tscn's Visual node: turned half round, so the model's +z is the car's -z.
	var visual := Transform3D(Basis(Vector3.UP, PI), Vector3.ZERO)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.append_from(repaint(load(m["body"]), color), 0, visual)
	for i in 4:
		# Right-hand wheels are the left one turned round, as in car.tscn.
		var flip := Basis(Vector3.UP, PI) if i % 2 == 1 else Basis()
		st.append_from(Vehicles.wheel_mesh(m, i), 0, visual * Transform3D(flip, Vehicles.hub(m, i)))
	st.append_from(_coloured(plate_mesh(shape), PLATE_WHITE), 0, visual * (m["roundel"] as Transform3D))
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
