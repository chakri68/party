class_name Biome
extends Resource
## What a stage looks like, as opposed to where its road goes (map: "Future:
## biomes"). A track scene points at one (Track.biome); main.gd, the ground
## and road shaders, EyeForest, Weather and CarFx read it. Pine Panic is the
## forest, Dust Devil the desert canyon, Snowblind the alpine snow;
## Cliffhanger gets its own .tres in res://biomes/.
##
## Light isn't here: the sun and ambient are nodes in the track scene (Sun,
## Environment), which the stage builder sets.
##
## Everything has the forest's value as its default, so a track without a
## biome (or a field a biome doesn't set) looks exactly as Pine Panic always
## has.

@export var id := "forest"

@export_group("Sky and haze (eye-level cameras)")
@export var sky_top := Color(0.36, 0.52, 0.72)
@export var sky_horizon := Color(0.78, 0.83, 0.86)
## Depth fog, and the colour of everything EyeForest draws in the haze
## (treeline ring, far landmark silhouettes).
@export var fog := Color(0.69, 0.74, 0.77)
@export var fog_begin := 24.0
@export var fog_end := 108.0
@export var fog_curve := 1.25
## Perspective far plane; keep it just past fog_end.
@export var persp_far := 118.0

@export_group("Ground and road")
## Shader uniform overrides for shaders/ground.gdshader and road.gdshader
## (name -> value). Empty = the shader defaults, which are the forest's.
@export var ground_params := {}
@export var road_params := {}

@export_group("Eye-level scenery (EyeForest)")
## "pines": tall scatter gets an 18-triangle pine impostor past near_r.
## "none": no impostors; everything tall is streamed out to near_r and the
## fog takes it from there (sparse scatter, where that's cheaper).
@export_enum("pines", "none") var impostors := "pines"
## Detail -> impostor (or -> nothing) radius, horizontal metres.
@export var near_r := 50.0
## The ring on the horizon: "pines" (a ragged treeline) or "mesas" (flat
## topped buttes and the odd spire).
@export_enum("pines", "mesas") var ring := "pines"

@export_group("Weather")
## What the seeded weather banks are: "mist" (pale, slow, in the treetops),
## "dust" (warm, faster, low and streaky) or "snow" (blowing snow, low and
## fast like dust, plus falling flakes as thick as the clouds). Same system,
## same seed rules.
@export_enum("mist", "dust", "snow") var weather := "mist"
@export var weather_tint := Color(0.8, 0.83, 0.85)
## Wind speed multiplier for the banks.
@export var wind := 1.0

@export_group("Car effects")
## Dust off the road / off anything else. Paler than what it comes off, or it
## vanishes against it from above.
@export var dust_road := Color("e3d4b4")
@export var dust_off := Color("a8957a")
## Size, life and rate of the dust plume (1 = the forest's gravel).
@export var plume := 1.0
## What the wheels fling (gravel, or clumps of snow) and the tyre marks' colour.
@export var grit := Color("4a4136")
@export var marks := Color(0.16, 0.12, 0.08)

@export_group("Trees far off")
## How white the impostor pines' tips go (0 = bare green, 1 = snow-capped).
@export var tree_snow := 0.0


static var _forest: Biome


## The forest, for tracks that don't name a biome.
static func forest() -> Biome:
	if _forest == null:
		_forest = Biome.new()
	return _forest
