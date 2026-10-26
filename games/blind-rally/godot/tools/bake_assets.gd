extends SceneTree
## Bakes the Kenney glTF sources in assets/kenney_*/ into palette meshes.
## Run after an import: godot --headless --path . --script res://tools/bake_assets.gd [-- id ...]
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
const SPACE := "res://assets/kenney_space-kit/"
const SURVIVAL := "res://assets/kenney_survival-kit/"
const HOLIDAY := "res://assets/kenney_holiday-kit/"

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
## The camper's tent and fire ring: an orange tent reads against the pines.
const CAMP_PALETTE := {
	"colorRed": Color("d9642b"),
	"wood": Color("8a6440"),
	"stone": Color("8c8b84"),
}
## Scrap: the abandoned sedan is all rust, the skidder faded yellow going
## rusty. Picked per triangle from a hash of its centre, so the patches are
## stable from bake to bake.
const RUST := [Color("7a3b1e"), Color("8e4a22"), Color("5e3220"), Color("9a5a2e")]
const SKIDDER_PAINT := Color("c08f2a")
const GLASS_DEAD := Color("2a3034")
const SCRAP_DARK := Color("3a3735")

## Dust Devil (desert canyon). Rocks go red sandstone with sand-dusted tops
## (Kenney's "grass" is the moss on top), scrub sage, grass bleached, the
## cactus a dusty green.
const DESERT_PALETTES := {
	"sandstone": {"dirt": Color("a9583a"), "grass": Color("d29a64"), "_defaultMat": Color("c07a4c")},
	"pale_rock": {"dirt": Color("c98d5c"), "grass": Color("e0b583"), "_defaultMat": Color("d39c6a")},
	"scrub": {"grass": Color("7c8457")},
	"dry_grass": {"grass": Color("bfa463")},
	"cactus": {"leafsGreen": Color("5a7f45")},
	# Space Kit: fuel drums in faded red and rust, the dish and mast kit
	# white and grey, the crater scorched, the alien as Kenney made him.
	"drum": {"metalRed": Color("b5432c"), "metal": Color("b9b2a1"), "metalDark": Color("5e5850")},
	"drum_yellow": {"metalRed": Color("d6a128"), "metal": Color("b9b2a1"), "metalDark": Color("5e5850")},
	"dish": {"metal": Color("d6d9dc"), "metalDark": Color("8a9096"), "metalRed": Color("d8322a"), "dark": Color("3a3d42"), "_defaultMat": Color("d6d9dc")},
	"crater": {"rockDark": Color("4a3226"), "rock": Color("8a5a3c")},
	"bone": {"bone": Color("e9dfc8")},
	"alien": {"crystal": Color("6ff0b8"), "metal": Color("cfd6dc"), "metalRed": Color("e39a3a"), "metalDark": Color("8a9096"), "dark": Color("2f343c")},
}

## id: [source, scale, palette, options]. Options: "only" = node names to keep,
## "skip" = node names to drop, "centre" = recentre on the AABB, "ao" = darken
## toward the base (cheap contact shading for things that stand on the ground),
## "drop" = [AABB, max area]: small triangles whose centre lands in the box
## (baked, scaled space) are left out. "centre_xz" = recentre in plan and sit
## the base on y = 0 (the Space Kit models are modelled off-origin). "atlas"
## = the colormap the triangles sample (Survival Kit), kept as it is.
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
	# Scenery callouts (build_pine_panic.gd _scenery). The wreck sits on its
	# belly, so no wheels.
	"wreck": [CAR + "sedan.glb", 1.75, "rust", {"only": ["body"]}],
	"skidder": [CAR + "tractor-shovel.glb", 2.2, "skidder", {}],
	"tent_camp": [NATURE + "tent_detailedOpen.glb", 4.6, "camp", {}],
	"fire_ring": [NATURE + "campfire_stones.glb", 3.2, "camp", {}],
	# Dust Devil (build_dust_devil.gd).
	"saguaro": [NATURE + "cactus_tall.glb", 9.0, "cactus", {"ao": true}],
	"cactus_short": [NATURE + "cactus_short.glb", 5.5, "cactus", {"ao": true}],
	"red_rock_b": [NATURE + "rock_largeB.glb", 6.0, "sandstone", {"ao": true}],
	"red_rock_d": [NATURE + "rock_largeD.glb", 5.0, "sandstone", {"ao": true}],
	"red_rock_e": [NATURE + "rock_largeE.glb", 5.0, "pale_rock", {"ao": true}],
	"hoodoo_b": [NATURE + "rock_tallB.glb", 9.0, "sandstone", {"ao": true}],
	"hoodoo_g": [NATURE + "rock_tallG.glb", 11.0, "pale_rock", {"ao": true}],
	"hoodoo_h": [NATURE + "rock_tallH.glb", 9.0, "sandstone", {"ao": true}],
	"hoodoo_e": [NATURE + "rock_tallE.glb", 8.0, "sandstone", {"ao": true}],
	"pebble": [NATURE + "rock_smallC.glb", 3.5, "sandstone", {}],
	"flat_rock": [NATURE + "rock_smallFlatA.glb", 4.0, "pale_rock", {}],
	"scrub": [NATURE + "plant_bushSmall.glb", 5.0, "scrub", {"ao": true}],
	"scrub_tri": [NATURE + "plant_bushTriangle.glb", 4.5, "scrub", {"ao": true}],
	"dry_grass": [NATURE + "grass.glb", 4.0, "dry_grass", {}],
	"sand_rock_a": [SURVIVAL + "rock-sand-a.glb", 4.0, "atlas", {"atlas": SURVIVAL + "Textures/colormap.png"}],
	"sand_rock_b": [SURVIVAL + "rock-sand-b.glb", 4.0, "atlas", {"atlas": SURVIVAL + "Textures/colormap.png"}],
	"signpost": [SURVIVAL + "signpost.glb", 4.6, "atlas", {"atlas": SURVIVAL + "Textures/colormap.png"}],
	"drums": [SPACE + "barrels.glb", 4.5, "drum", {"centre_xz": true}],
	"drum": [SPACE + "barrel.glb", 4.5, "drum", {"centre_xz": true}],
	"drum_yellow": [SPACE + "barrel.glb", 4.5, "drum_yellow", {"centre_xz": true}],
	"dish": [SPACE + "satelliteDish_detailed.glb", 5.0, "dish", {"centre_xz": true}],
	"radio_box": [SPACE + "machine_wireless.glb", 3.0, "dish", {"centre_xz": true}],
	"crater": [SPACE + "crater.glb", 30.0, "crater", {"centre_xz": true}],
	"bones": [SPACE + "bones.glb", 3.0, "bone", {"centre_xz": true}],
	"alien": [SPACE + "alien.glb", 3.2, "alien", {"centre_xz": true}],
	# Snowblind (build_snowblind.gd). Holiday Kit's atlas, moved off its
	# pastels: the teal pines go dark spruce, the lilac rocks granite, the
	# blue-white snow a cooler, flatter white, the orange trunks bark.
	"snow_pine_a": [HOLIDAY + "tree-snow-a.glb", 6.0, "snow_tree", {"atlas": HOLIDAY + "Textures/colormap.png", "ao": true}],
	"snow_pine_b": [HOLIDAY + "tree-snow-b.glb", 5.0, "snow_tree", {"atlas": HOLIDAY + "Textures/colormap.png", "ao": true}],
	"snow_pine_c": [HOLIDAY + "tree-snow-c.glb", 4.4, "snow_tree", {"atlas": HOLIDAY + "Textures/colormap.png", "ao": true}],
	"snow_pine_small": [HOLIDAY + "tree-snow-c.glb", 3.0, "snow_tree", {"atlas": HOLIDAY + "Textures/colormap.png", "ao": true}],
	"granite_l": [HOLIDAY + "rocks-large.glb", 3.6, "snow_atlas", {"atlas": HOLIDAY + "Textures/colormap.png", "ao": true}],
	"granite_m": [HOLIDAY + "rocks-medium.glb", 2.6, "snow_atlas", {"atlas": HOLIDAY + "Textures/colormap.png", "ao": true}],
	"granite_s": [HOLIDAY + "rocks-small.glb", 2.0, "snow_atlas", {"atlas": HOLIDAY + "Textures/colormap.png"}],
	"snow_pile": [HOLIDAY + "snow-pile.glb", 3.0, "snow_atlas", {"atlas": HOLIDAY + "Textures/colormap.png"}],
	"lantern": [HOLIDAY + "lantern.glb", 1.4, "snow_atlas", {"atlas": HOLIDAY + "Textures/colormap.png"}],
	"bench": [HOLIDAY + "bench.glb", 1.7, "snow_atlas", {"atlas": HOLIDAY + "Textures/colormap.png"}],
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
	# `-- id id ...` bakes just those (a new stage's meshes without touching the rest).
	var only := OS.get_cmdline_user_args()
	for id in JOBS:
		if not only.is_empty() and not only.has(id):
			continue
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
	elif opts.get("centre_xz", false):
		shift = Vector3(-(lo.x + hi.x) * 0.5, -lo.y, -(lo.z + hi.z) * 0.5)
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
			var col := _source_colour(mat_src, uvs, idx, t, opts.get("atlas", ""))
			var key := xf * ((verts[idx[t]] + verts[idx[t + 1]] + verts[idx[t + 2]]) / 3.0)
			col = _remap(col, mat_src.resource_name if mat_src else "", palette, key)
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
func _source_colour(mat: Material, uvs: PackedVector2Array, idx: PackedInt32Array, t: int, atlas := "") -> Color:
	var base := Color.WHITE
	var sm := mat as StandardMaterial3D
	if sm == null:
		return base
	base = sm.albedo_color
	if sm.albedo_texture and not uvs.is_empty():
		var img := _atlas(atlas if atlas != "" else sm.albedo_texture.resource_path)
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


## Holiday Kit swatches -> Snowblind. By hue and value, so each swatch's
## light-to-dark ramp (Kenney shades faces with neighbouring swatches) survives.
static func snow_remap(c: Color, tree: bool) -> Color:
	if c.s < 0.25 and c.v > 0.72:
		# Snow: cooler and flatter than Kenney's sky-blue white, same ramp.
		var k := clampf((c.v - 0.72) / 0.28, 0.0, 1.0)
		return Color("c9d3dc").lerp(Color("f1f4f6"), k)
	if c.h > 0.35 and c.h < 0.52 and c.s > 0.3:
		# Teal pine -> dark spruce.
		return Color("1f3a2a").lerp(Color("3e6447"), clampf((c.v - 0.5) / 0.3, 0.0, 1.0))
	if c.h > 0.58 and c.h < 0.72 and c.v < 0.7:
		# Lilac stone -> granite.
		var g := clampf((c.v - 0.35) / 0.3, 0.0, 1.0)
		return Color("4e5156").lerp(Color("8a8d90"), g)
	if tree and c.h < 0.1 and c.s > 0.4:
		return Color("3e2b20").lerp(Color("5e4230"), clampf((c.v - 0.75) / 0.2, 0.0, 1.0))
	return c


func _remap(c: Color, mat_name: String, palette: String, at := Vector3.ZERO) -> Color:
	if palette == "snow_tree" or palette == "snow_atlas":
		return snow_remap(c, palette == "snow_tree")
	if DESERT_PALETTES.has(palette):
		return DESERT_PALETTES[palette].get(mat_name, c)
	match palette:
		"atlas":
			return c
		"camp":
			return CAMP_PALETTE.get(mat_name, c)
		"rust", "skidder":
			# Car Kit atlas: pale and cool = glass, near-black = tyres and
			# trim, everything else is bodywork (paint, bumpers, lamps).
			var h := fposmod(sin(at.x * 12.9898 + at.y * 4.1414 + at.z * 78.233) * 43758.5453, 1.0)
			if c.v > 0.6 and c.b > c.r and c.s < 0.4:
				return GLASS_DEAD
			if c.v < 0.3:
				return SCRAP_DARK.lightened(h * 0.08)
			if palette == "skidder" and h > 0.3:
				return SKIDDER_PAINT.darkened(h * 0.15)
			return RUST[int(h * 97.0) % RUST.size()]
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
