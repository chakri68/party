extends SceneTree
## Bakes the Kenney glTF sources in assets/kenney_*/ into palette meshes.
## Run after an import: godot --headless --path . --script res://tools/bake_assets.gd
##
## Every model is flattened into one ArrayMesh surface whose colour lives in
## the vertices, remapped onto the Blind Rally palette (Kenney's pastels would
## look like a different game next to our dirt and pines). All of them share
## one material, so a MultiMesh of trees is one draw call and the export
## carries no textures. The glTF files are sources only; export skips them.

const OUT_DIR := "res://assets/meshes/"
const MATERIAL := "res://assets/materials/vertex_color.tres"

const NATURE := "res://assets/kenney_nature-kit/"
const RACING := "res://assets/kenney_racing-kit/"
const CAR := "res://assets/kenney_car-kit/"

## Kenney material name -> palette colour (sRGB).
const NATURE_PALETTE := {
	"leafsDark": Color("2f5636"),
	"woodBarkDark": Color("4a3326"),
	"woodBark": Color("6b4a33"),
	"woodInner": Color("c9a477"),
	"woodDark": Color("5a3e2a"),
	"wood": Color("8a6440"),
	"dirt": Color("85827a"),
	"grass": Color("4f6f36"),
	"_defaultMat": Color("85827a"),
}
const RACING_PALETTE := {
	"red": Color("d8322a"),
	"grey": Color("f0ede4"),
	"road": Color("5b5b5b"),
	"_defaultMat": Color("e8e8e8"),
	"grass": Color("2e9e4f"),
	"pylon": Color("ff7a1a"),
}
## Rally livery: the Car Kit hatchback's green becomes this blue.
const CAR_PAINT := Color("1f6fe0")

## id: [source, scale, palette, options]. Options: "only" = node names to keep,
## "skip" = node names to drop, "centre" = recentre on the AABB, "ao" = darken
## toward the base (cheap contact shading for things that stand on the ground),
## "drop" = [AABB, max area]: small triangles whose centre lands in the box
## (baked, scaled space) are left out.
const JOBS := {
	"pine_tall": [NATURE + "tree_pineTallA.glb", 7.0, "nature", {"ao": true}],
	"pine_default": [NATURE + "tree_pineDefaultA.glb", 6.5, "nature", {"ao": true}],
	"pine_round": [NATURE + "tree_pineRoundC.glb", 7.0, "nature", {"ao": true}],
	"pine_small": [NATURE + "tree_pineSmallA.glb", 6.0, "nature", {"ao": true}],
	"log": [NATURE + "log.glb", 5.0, "nature", {}],
	"log_large": [NATURE + "log_large.glb", 3.5, "nature", {}],
	"log_stack": [NATURE + "log_stackLarge.glb", 5.0, "nature", {}],
	"rock_a": [NATURE + "rock_largeA.glb", 3.0, "nature", {"ao": true}],
	"rock_c": [NATURE + "rock_largeC.glb", 3.0, "nature", {"ao": true}],
	"rock_small": [NATURE + "rock_smallA.glb", 3.0, "nature", {}],
	"rock_tall": [NATURE + "rock_tallA.glb", 3.0, "nature", {"ao": true}],
	"stump": [NATURE + "stump_old.glb", 3.0, "nature", {}],
	"bush": [NATURE + "plant_bushLarge.glb", 5.0, "nature", {"ao": true}],
	"bush_small": [NATURE + "plant_bush.glb", 4.0, "nature", {"ao": true}],
	"grass": [NATURE + "grass_large.glb", 4.0, "nature", {}],
	"campfire": [NATURE + "campfire_logs.glb", 4.0, "nature", {}],
	"arch": [RACING + "overheadRoundColored.glb", 5.0, "racing", {}],
	"flag_red": [RACING + "flagRed.glb", 2.5, "racing", {}],
	"flag_green": [RACING + "flagGreen.glb", 2.5, "racing", {}],
	"tent": [RACING + "tent.glb", 4.0, "racing", {}],
	"cone": [RACING + "pylon.glb", 5.0, "racing", {}],
	# The hatchback's octagonal tow eyes stick out of both bumpers with a pale
	# cap, and from the chase camera that's the brightest thing on the car.
	"car_body": [CAR + "hatchback-sports.glb", 1.38, "car", {"only": ["body"], "drop": [
		[AABB(Vector3(-0.27, 0.15, 1.84), Vector3(0.54, 0.5, 0.2)), 0.05],
		[AABB(Vector3(-0.27, 0.15, -2.05), Vector3(0.54, 0.5, 0.25)), 0.05]]}],
	"car_wheel": [CAR + "hatchback-sports.glb", 1.38, "car", {"only": ["wheel-front-left"], "centre": true}],
}

var _atlas_cache := {}


func _init() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT_DIR))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(MATERIAL.get_base_dir()))
	# Vertex colour as albedo, roughness 0.95, specular 0.25, plus the weather
	# terms (cloud shade, eye-level mist): see shaders/palette.gdshader.
	var mat := ShaderMaterial.new()
	mat.resource_name = "vertex_color"
	mat.shader = load("res://shaders/palette.gdshader")
	ResourceSaver.save(mat, MATERIAL)
	mat = load(MATERIAL) # saved copy, so meshes reference the file, not an embed

	var failed := 0
	for id in JOBS:
		var job: Array = JOBS[id]
		var mesh := _bake(job[0], job[1], job[2], job[3], mat)
		if mesh == null:
			failed += 1
			continue
		var err := ResourceSaver.save(mesh, OUT_DIR + id + ".res")
		var aabb := mesh.get_aabb()
		print("%-13s %5d tris  size %s  err %d" % [id, mesh.surface_get_array_len(0) / 3, aabb.size.snapped(Vector3.ONE * 0.01), err])
		failed += int(err != OK)
	quit(1 if failed else 0)


func _bake(src: String, scale: float, palette: String, opts: Dictionary, mat: Material) -> ArrayMesh:
	var scene: PackedScene = load(src)
	if scene == null:
		push_error("can't load " + src)
		return null
	var root := scene.instantiate()
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var parts: Array = []
	_collect(root, Transform3D.IDENTITY, opts, parts)
	# Bounds first, for recentring and the base darkening.
	var lo := Vector3.INF
	var hi := -Vector3.INF
	for p in parts:
		for v in (p[1] as PackedVector3Array):
			var w: Vector3 = p[0] * v
			lo = lo.min(w)
			hi = hi.max(w)
	var shift := Vector3.ZERO
	if opts.get("centre", false):
		shift = -(lo + hi) * 0.5
	var height := maxf(hi.y - lo.y, 0.001)
	for p in parts:
		var xf: Transform3D = p[0]
		var verts: PackedVector3Array = p[1]
		var normals: PackedVector3Array = p[2]
		var uvs: PackedVector2Array = p[3]
		var idx: PackedInt32Array = p[4]
		var mat_src: Material = p[5]
		var nb := xf.basis.inverse().transposed()
		for t in range(0, idx.size(), 3):
			if _dropped(opts, [(xf * verts[idx[t]] + shift) * scale, (xf * verts[idx[t + 1]] + shift) * scale, (xf * verts[idx[t + 2]] + shift) * scale]):
				continue
			var col := _source_colour(mat_src, uvs, idx, t)
			col = _remap(col, mat_src.resource_name if mat_src else "", palette)
			for k in 3:
				var i := idx[t + k]
				var w: Vector3 = (xf * verts[i] + shift) * scale
				var c := col
				if opts.get("ao", false):
					var h := clampf((xf * verts[i]).y / height, 0.0, 1.0)
					c = c.darkened(lerpf(0.35, 0.0, sqrt(h)))
				st.set_color(c)
				st.set_normal((nb * normals[i]).normalized())
				st.add_vertex(w)
	root.free()
	var mesh := st.commit()
	if mesh.get_surface_count() == 0:
		push_error("nothing baked from " + src)
		return null
	mesh.surface_set_material(0, mat)
	mesh.resource_name = src.get_file().get_basename()
	return mesh


func _dropped(opts: Dictionary, tri: Array) -> bool:
	var centre: Vector3 = (tri[0] + tri[1] + tri[2]) / 3.0
	var area: float = (tri[1] - tri[0]).cross(tri[2] - tri[0]).length() * 0.5
	for d in opts.get("drop", []):
		if (d[0] as AABB).has_point(centre) and area <= d[1]:
			return true
	return false


## Gathers [transform, verts, normals, uvs, indices, material] per surface.
func _collect(n: Node, parent_xf: Transform3D, opts: Dictionary, out: Array) -> void:
	var xf := parent_xf
	if n is Node3D:
		xf = parent_xf * (n as Node3D).transform
	if n is MeshInstance3D:
		var keep := true
		if opts.has("only"):
			keep = String(n.name) in opts["only"]
		if opts.has("skip") and String(n.name) in opts["skip"]:
			keep = false
		if keep:
			var m: Mesh = n.mesh
			# The car's wheels sit at their node's origin; recentring handles it.
			var local := xf if not opts.get("centre", false) else Transform3D(xf.basis, Vector3.ZERO)
			for s in m.get_surface_count():
				var a := m.surface_get_arrays(s)
				var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX] if a[Mesh.ARRAY_INDEX] != null else PackedInt32Array(range(a[Mesh.ARRAY_VERTEX].size()))
				var uvs: PackedVector2Array = a[Mesh.ARRAY_TEX_UV] if a[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
				var mat: Material = n.get_surface_override_material(s)
				if mat == null:
					mat = m.surface_get_material(s)
				out.append([local, a[Mesh.ARRAY_VERTEX], a[Mesh.ARRAY_NORMAL], uvs, idx, mat])
	for c in n.get_children():
		_collect(c, xf, opts, out)


## Flat colour of one triangle: the material colour, times the atlas texel at
## the triangle's centroid (Kenney atlases are flat swatches, so one sample is
## the whole triangle; corners can sit on a swatch edge, the centroid can't).
func _source_colour(mat: Material, uvs: PackedVector2Array, idx: PackedInt32Array, t: int) -> Color:
	var base := Color.WHITE
	var sm := mat as StandardMaterial3D
	if sm == null:
		return base
	base = sm.albedo_color
	if sm.albedo_texture and not uvs.is_empty():
		var img := _atlas(sm.albedo_texture.resource_path)
		if img:
			var uv := (uvs[idx[t]] + uvs[idx[t + 1]] + uvs[idx[t + 2]]) / 3.0
			var x := clampi(int(fposmod(uv.x, 1.0) * img.get_width()), 0, img.get_width() - 1)
			var y := clampi(int(fposmod(uv.y, 1.0) * img.get_height()), 0, img.get_height() - 1)
			base *= img.get_pixel(x, y)
	return base


## Reads the source PNG rather than the imported (maybe VRAM-compressed) copy.
func _atlas(path: String) -> Image:
	if not _atlas_cache.has(path):
		var src := path
		if path.begins_with("res://.godot/") or path.get_extension() != "png":
			src = CAR + "Textures/colormap.png"
		_atlas_cache[path] = Image.load_from_file(ProjectSettings.globalize_path(src))
	return _atlas_cache[path]


func _remap(c: Color, mat_name: String, palette: String) -> Color:
	match palette:
		"nature":
			return NATURE_PALETTE.get(mat_name, c)
		"racing":
			return RACING_PALETTE.get(mat_name, c)
		"car":
			# Green paint -> livery, keeping the atlas's light-to-dark ramp.
			if c.s > 0.35 and c.h > 0.3 and c.h < 0.5:
				return CAR_PAINT.lightened(clampf((c.v - 0.68) * 1.2, 0.0, 0.3)).darkened(clampf((0.68 - c.v) * 1.5, 0.0, 0.4))
			return c
	return c
