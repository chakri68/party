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
## A set piece's pad is flat at padY out to padR, then eases back to the
## plain ground over this many metres.
const PAD_BLEND := 10.0
## Mirrors shared/trails.ts. The dirt strip is this wide each side of the
## line; the detail noise fades out over one metre more.
const TRAIL_HALF_WIDTH := 2.0
const TRAIL_REACH := TRAIL_HALF_WIDTH + 1.0
const DIRT := Color("#8a6a48")
## The pad and trail lookup grid is the macro grid's own cells (32 m),
## keyed by the cell's low-corner vertex, so height_at gets the key for free.
const HAS_PAD := 1
const HAS_TRAIL := 2

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
## Pads as [x, z, padY, padR] and trail segments as [ax, az, bx, bz], flat.
var _pads := PackedFloat64Array()
var _segs := PackedFloat64Array()
## Per hash cell, the pads and segments whose reach touches it.
var _cell_pads: Array[PackedInt32Array] = []
var _cell_segs: Array[PackedInt32Array] = []
## Per hash cell, HAS_PAD | HAS_TRAIL: 0 means plain ground, the fast path.
var _flags := PackedByteArray()


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
	f._index(layout.get("pieces", []), layout.get("trails", []))
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


## The ground: macro shape plus detail, the detail fading out near the sea
## and on trails, then flattened under set pieces. Everything that asks
## where the ground is (chunks, walker, buggy, spawn, sea rule) asks here,
## per vertex and per tick, so a hash cell with nothing in it costs one
## byte read on top of the plain ground.
func height_at(x: float, z: float) -> float:
	# macro_height, inlined (a script call costs more than the maths). Its
	# cell offset o is also the pad and trail lookup key.
	var fx := clampf((x - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var fz := clampf((z - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var i := mini(MACRO_SIZE - 2, floori(fx))
	var j := mini(MACRO_SIZE - 2, floori(fz))
	var tx := fx - i
	var tz := fz - j
	var o := j * MACRO_SIZE + i
	var ma := _heights[o] * (1 - tx) + _heights[o + 1] * tx
	var mb := _heights[o + MACRO_SIZE] * (1 - tx) + _heights[o + MACRO_SIZE + 1] * tx
	var m := (ma * (1 - tz) + mb * tz) / 10.0
	var what := _flags[o]
	if what != 0:
		return _featured_height(o, what, x, z, m)
	if m <= DETAIL_FLOOR:
		return m
	return m + _noise.get_noise_2d(x, z) * DETAIL_AMP * smoothstep(DETAIL_FLOOR, DETAIL_FULL, m)


## height_at where a pad or trail is near; m is macro_height(x, z).
func _featured_height(c: int, what: int, x: float, z: float, m: float) -> float:
	var pads := _cell_pads[c]
	# On a pad: done, no noise needed.
	for k in pads:
		var o := k * 4
		var dx := x - _pads[o]
		var dz := z - _pads[o + 1]
		var r := _pads[o + 3]
		if dx * dx + dz * dz <= r * r:
			return _pads[o + 2]
	var h := m
	if m > DETAIL_FLOOR:
		var fade := smoothstep(DETAIL_FLOOR, DETAIL_FULL, m)
		if what & HAS_TRAIL:
			fade *= smoothstep(0.0, TRAIL_REACH, _trail_distance_in(c, x, z))
		if fade > 0.0:
			h += _noise.get_noise_2d(x, z) * DETAIL_AMP * fade
	# The blend ring: padY at padR, the plain ground by padR + PAD_BLEND.
	for k in pads:
		var o := k * 4
		var r := _pads[o + 3]
		var d := Vector2(x - _pads[o], z - _pads[o + 1]).length()
		if d < r + PAD_BLEND:
			h = lerpf(_pads[o + 2], h, smoothstep(r, r + PAD_BLEND, d))
	return h


## Distance to the nearest trail, or INF where no trail comes within
## TRAIL_REACH of this hash cell. Past TRAIL_REACH it's only "far enough".
func trail_distance(x: float, z: float) -> float:
	var c := _hash_cell(x, z)
	return _trail_distance_in(c, x, z) if _flags[c] & HAS_TRAIL else INF


func _trail_distance_in(c: int, x: float, z: float) -> float:
	var best := INF
	for k in _cell_segs[c]:
		var o := k * 4
		var ax := _segs[o]
		var az := _segs[o + 1]
		var dx := _segs[o + 2] - ax
		var dz := _segs[o + 3] - az
		var len2 := dx * dx + dz * dz
		var u := 0.0 if len2 == 0.0 else clampf(((x - ax) * dx + (z - az) * dz) / len2, 0.0, 1.0)
		var ex := x - ax - dx * u
		var ez := z - az - dz * u
		best = minf(best, ex * ex + ez * ez)
	return sqrt(best)


## The lookup key under (x, z): the macro cell's offset, as height_at has it.
## Clamped like the macro grid, so past the world's edge the edge cell
## answers, and its exact distance tests stay right.
func _hash_cell(x: float, z: float) -> int:
	var i := mini(MACRO_SIZE - 2, floori(clampf((x - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)))
	var j := mini(MACRO_SIZE - 2, floori(clampf((z - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)))
	return j * MACRO_SIZE + i


## Files each pad (by its blend ring) and each trail segment (by its reach)
## under every hash cell its box touches. Once per layout.
func _index(pieces: Array, trails: Array) -> void:
	_cell_pads.resize(MACRO_SIZE * MACRO_SIZE)
	_cell_segs.resize(MACRO_SIZE * MACRO_SIZE)
	_flags.resize(MACRO_SIZE * MACRO_SIZE)
	_flags.fill(0)
	for c in MACRO_SIZE * MACRO_SIZE:
		_cell_pads[c] = PackedInt32Array()
		_cell_segs[c] = PackedInt32Array()
	for p: Dictionary in pieces:
		var x := float(p.x)
		var z := float(p.z)
		var r := float(p.padR)
		var k := _pads.size() / 4
		_pads.append_array([x, z, float(p.padY), r])
		_file(_cell_pads, HAS_PAD, k, x, z, x, z, r + PAD_BLEND)
	for tr: Dictionary in trails:
		var pts: Array = tr.get("pts", [])
		for i in range(1, pts.size()):
			var ax := float(pts[i - 1][0])
			var az := float(pts[i - 1][1])
			var bx := float(pts[i][0])
			var bz := float(pts[i][1])
			var k := _segs.size() / 4
			_segs.append_array([ax, az, bx, bz])
			_file(_cell_segs, HAS_TRAIL, k, ax, az, bx, bz, TRAIL_REACH)


func _file(cells: Array[PackedInt32Array], flag: int, k: int, ax: float, az: float, bx: float, bz: float, pad: float) -> void:
	const LAST := MACRO_SIZE - 2 # cells, like height_at's i and j, clamp here
	var i0 := clampi(floori((minf(ax, bx) - pad - MACRO_ORIGIN) / MACRO_CELL), 0, LAST)
	var i1 := clampi(floori((maxf(ax, bx) + pad - MACRO_ORIGIN) / MACRO_CELL), 0, LAST)
	var j0 := clampi(floori((minf(az, bz) - pad - MACRO_ORIGIN) / MACRO_CELL), 0, LAST)
	var j1 := clampi(floori((maxf(az, bz) + pad - MACRO_ORIGIN) / MACRO_CELL), 0, LAST)
	for j in range(j0, j1 + 1):
		for i in range(i0, i1 + 1):
			cells[j * MACRO_SIZE + i].append(k)
			_flags[j * MACRO_SIZE + i] |= flag


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
## near the water. Trails are dirt over the top, fading out over 1 m.
func color_at(x: float, z: float, h: float) -> Color:
	var fx := clampf((x - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var fz := clampf((z - MACRO_ORIGIN) / MACRO_CELL, 0.0, MACRO_SIZE - 1)
	var i := mini(MACRO_SIZE - 2, floori(fx))
	var j := mini(MACRO_SIZE - 2, floori(fz))
	var o := j * MACRO_SIZE + i
	var base := SAND
	if h >= SAND_BELOW:
		var a := BIOME_COLORS[_biomes[o]].lerp(BIOME_COLORS[_biomes[o + 1]], fx - i)
		var b := BIOME_COLORS[_biomes[o + MACRO_SIZE]].lerp(BIOME_COLORS[_biomes[o + MACRO_SIZE + 1]], fx - i)
		base = a.lerp(b, fz - j)
	if _flags[o] & HAS_TRAIL:
		var d := _trail_distance_in(o, x, z)
		if d < TRAIL_REACH:
			return DIRT.lerp(base, smoothstep(TRAIL_HALF_WIDTH, TRAIL_REACH, d))
	return base


## The macro twist of cell (i, j), in decimetres: h00 − h10 − h01 + h11.
## Its sign says which diagonal keeps a two-triangle cell under the bilinear
## surface (see FarTerrain).
func macro_twist(i: int, j: int) -> float:
	var o := j * MACRO_SIZE + i
	return _heights[o] - _heights[o + 1] - _heights[o + MACRO_SIZE] + _heights[o + MACRO_SIZE + 1]
