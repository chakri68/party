class_name TerrainField
extends RefCounted
## The ground as a pure function of the layout: macro grid (from the server)
## plus detail noise (made here, from the seed). Nothing in here depends on
## which chunks are loaded, so the camera, spawn and fall checks can ask
## anywhere, any time.

# Mirrors games/treasure-hunt/shared/world.ts. Metres; Godot faces −Z.
const PLAY_HALF := 750
const WORLD_HALF := 950
const SEA_LEVEL := 0
const MACRO_CELL := 32
const MACRO_ORIGIN := -960
const MACRO_SIZE := 61
const WALL_HALF := 770
const BIOMES: Array[String] = ["meadow", "forest", "rocky", "wetland", "snowcap"]

## Detail terrain: 2 m cells in 64 m chunks (33 × 33 vertices).
const CELL := 2.0
const CHUNK := 64.0
const CHUNK_VERTS := 33
## How far the detail noise moves the ground, up or down.
const DETAIL_AMP := 3.0
## Detail is 0 at or below this macro height and full by DETAIL_FULL: beaches stay flat.
const DETAIL_FLOOR := 1.0
const DETAIL_FULL := 3.0
## Below this height the ground is sand, whatever the biome.
const SAND_BELOW := 1.5

const BIOME_COLORS: Array[Color] = [
	Color(0.45, 0.62, 0.30), # meadow
	Color(0.22, 0.42, 0.22), # forest
	Color(0.50, 0.48, 0.45), # rocky
	Color(0.35, 0.45, 0.32), # wetland
	Color(0.92, 0.94, 0.96), # snowcap
]
const SAND := Color(0.80, 0.74, 0.55)

var seed: int
var ring: Array
var spawn: Vector3
var spawn_yaw: float

var _heights := PackedFloat64Array() # decimetres, x fastest
var _biomes := PackedInt32Array()
var _noise := FastNoiseLite.new()


static func from_layout(layout: Dictionary) -> TerrainField:
	var f := TerrainField.new()
	var m: Dictionary = layout.macro
	assert(int(m.size) == MACRO_SIZE and int(m.cell) == MACRO_CELL and int(m.origin) == MACRO_ORIGIN)
	f.seed = int(layout.seed)
	f.ring = (layout.ring as Array).duplicate()
	f._heights = PackedFloat64Array(m.heights)
	f._biomes = PackedInt32Array(m.biomes)
	f._noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	f._noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	f._noise.fractal_octaves = 3
	f._noise.frequency = 1.0 / 40.0
	f._noise.seed = f.seed + 11
	var s: Dictionary = layout.spawn
	f.spawn = Vector3(s.x, f.height_at(s.x, s.z), s.z)
	f.spawn_yaw = s.yaw
	return f


## Bilinear over the macro grid, clamped at its edges: macroHeight in
## shared/generate.ts, step for step, so server and client agree.
func macro_height(x: float, z: float) -> float:
	var fx := clampf((x - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var fz := clampf((z - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var i := mini(MACRO_SIZE - 2, floori(fx))
	var j := mini(MACRO_SIZE - 2, floori(fz))
	var tx := fx - i
	var tz := fz - j
	var o := j * MACRO_SIZE + i
	var a := _heights[o] * (1 - tx) + _heights[o + 1] * tx
	var b := _heights[o + MACRO_SIZE] * (1 - tx) + _heights[o + MACRO_SIZE + 1] * tx
	return (a * (1 - tz) + b * tz) / 10.0


## The ground: macro shape plus detail, the detail fading out near the sea.
func height_at(x: float, z: float) -> float:
	var m := macro_height(x, z)
	if m <= DETAIL_FLOOR:
		return m
	return m + _noise.get_noise_2d(x, z) * DETAIL_AMP * smoothstep(DETAIL_FLOOR, DETAIL_FULL, m)


## Central differences one detail cell apart. Chunks compute the same sum
## from their own height grid, so normals match across seams.
func normal_at(x: float, z: float) -> Vector3:
	return normal_from(height_at(x - CELL, z), height_at(x + CELL, z), height_at(x, z - CELL), height_at(x, z + CELL))


static func normal_from(left: float, right: float, back: float, front: float) -> Vector3:
	return Vector3(left - right, 2.0 * CELL, back - front).normalized()


## The biome index of the nearest macro vertex.
func biome_at(x: float, z: float) -> int:
	var i := clampi(roundi((x - MACRO_ORIGIN) / MACRO_CELL), 0, MACRO_SIZE - 1)
	var j := clampi(roundi((z - MACRO_ORIGIN) / MACRO_CELL), 0, MACRO_SIZE - 1)
	return _biomes[j * MACRO_SIZE + i]


## The ground colour at (x, z), height h: the four corner biomes' colours
## blended bilinearly (nearest-vertex alone shows 32 m squares), or sand
## near the water.
func color_at(x: float, z: float, h: float) -> Color:
	if h < SAND_BELOW:
		return SAND
	var fx := clampf((x - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var fz := clampf((z - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var i := mini(MACRO_SIZE - 2, floori(fx))
	var j := mini(MACRO_SIZE - 2, floori(fz))
	var o := j * MACRO_SIZE + i
	var a := BIOME_COLORS[_biomes[o]].lerp(BIOME_COLORS[_biomes[o + 1]], fx - i)
	var b := BIOME_COLORS[_biomes[o + MACRO_SIZE]].lerp(BIOME_COLORS[_biomes[o + MACRO_SIZE + 1]], fx - i)
	return a.lerp(b, fz - j)


## The macro twist of cell (i, j), in decimetres: h00 − h10 − h01 + h11.
## Its sign says which diagonal keeps a two-triangle cell under the bilinear
## surface (see FarTerrain).
func macro_twist(i: int, j: int) -> float:
	var o := j * MACRO_SIZE + i
	return _heights[o] - _heights[o + 1] - _heights[o + MACRO_SIZE] + _heights[o + MACRO_SIZE + 1]
