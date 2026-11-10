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
## plain ground over its blend width. The width grows with the step from
## padY to the ground at padR, so the ramp adds at most BLEND_SLOPE to the
## hill's own slope instead of a fixed 10 m squeezing 13 m into a wall.
const MIN_BLEND := 10.0
const MAX_BLEND := 50.0
const BLEND_SLOPE := 30.0 # degrees
## The widening rule (see _blend_for): along each way a trail comes in, a
## 1 m step may climb at most RING_CLIMB wherever the plain ground climbs at
## most RING_PLAIN. 33°, not the buggy's 35°, leaves room for trails that
## bend off the straight line in. TRAIL_LOOK is how much of a trail's end
## that covers.
const RING_CLIMB := 33.0
const RING_PLAIN := 30.0
const RING_STEP := 5.0
const TRAIL_LOOK := 24.0
## Mirrors shared/trails.ts. The dirt strip is this wide each side of the
## line; the detail noise fades out over one metre more.
const TRAIL_HALF_WIDTH := 2.0
const TRAIL_REACH := TRAIL_HALF_WIDTH + 1.0
const DIRT := Color("#8a6a48")
## The pad and trail lookup grid is the macro grid's own cells (32 m),
## keyed by the cell's low-corner vertex, so height_at gets the key for free.
const HAS_PAD := 1
const HAS_TRAIL := 2
const PAD_STRIDE := 5

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
## Pads as [x, z, padY, padR, blend] and trail segments as [ax, az, bx, bz], flat.
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
		var o := k * PAD_STRIDE
		var dx := x - _pads[o]
		var dz := z - _pads[o + 1]
		var r := _pads[o + 3]
		if dx * dx + dz * dz <= r * r:
			return _pads[o + 2]
	var h := _bare(c, what, x, z, m)
	# The blend ring: the pad's step at its edge, straight out from the
	# middle, eased away by padR + blend. Carrying the step (not easing the
	# height towards padY) leaves the hill's own slope alone, so the ramp
	# adds at most 1.5 · step / blend to it. Easing the height instead
	# steepens a falling hillside 1.7×, whatever the width.
	for k in pads:
		var o := k * PAD_STRIDE
		var r := _pads[o + 3]
		var e := r + _pads[o + 4]
		var dx := x - _pads[o]
		var dz := z - _pads[o + 1]
		var d := sqrt(dx * dx + dz * dz)
		if d < e:
			var ex := _pads[o] + dx / d * r
			var ez := _pads[o + 1] + dz / d * r
			h += (_pads[o + 2] - _bare_at(ex, ez)) * (1.0 - smoothstep(r, e, d))
	return h


## The ground with no pads: macro plus detail, faded on trails.
func _bare(c: int, what: int, x: float, z: float, m: float) -> float:
	if m <= DETAIL_FLOOR:
		return m
	var fade := smoothstep(DETAIL_FLOOR, DETAIL_FULL, m)
	if what & HAS_TRAIL:
		fade *= smoothstep(0.0, TRAIL_REACH, _trail_distance_in(c, x, z))
	return m + _noise.get_noise_2d(x, z) * DETAIL_AMP * fade if fade > 0.0 else m


func _bare_at(x: float, z: float) -> float:
	var c := _hash_cell(x, z)
	return _bare(c, _flags[c], x, z, macro_height(x, z))


## Piece k's blend width, in metres (layout order).
func pad_blend(k: int) -> float:
	return _pads[k * PAD_STRIDE + 4]


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
	for p: Dictionary in pieces:
		var x := float(p.x)
		var z := float(p.z)
		var y := float(p.padY)
		var r := float(p.padR)
		_pads.append_array([x, z, y, r, _blend_for(x, z, y, r, _trail_ways(trails, x, z, r))])
	# Pieces are 150 m apart and padR is at most 18, so even two 50 m blends
	# leave room. If that ever changes, the overlap would blend twice: say so.
	var n := _pads.size() / PAD_STRIDE
	for k in n:
		var o := k * PAD_STRIDE
		for q in range(k + 1, n):
			var oq := q * PAD_STRIDE
			var gap := Vector2(_pads[o] - _pads[oq], _pads[o + 1] - _pads[oq + 1]).length()
			var reach := _pads[o + 3] + _pads[o + 4] + _pads[oq + 3] + _pads[oq + 4]
			if gap < reach:
				push_error("TerrainField: pads %d and %d overlap (%.0f m apart, rings reach %.0f)" % [k, q, gap, reach])
			assert(gap >= reach, "pad blend rings overlap")
	for k in n:
		var o := k * PAD_STRIDE
		_file(_cell_pads, HAS_PAD, k, _pads[o], _pads[o + 1], _pads[o], _pads[o + 1], _pads[o + 3] + _pads[o + 4])


## How wide a pad's ring must be. At least the step at padR spread so the
## ramp alone peaks at BLEND_SLOPE: clamp(1.5 · step / tan 30°, 10, 50).
## The ramp adds to the hill's own slope, though, and on a 20–29° hillside
## that sum passes the buggy's 35°. So where trails come in (`ways`, angles
## from the middle) it widens in RING_STEP steps until each of those ways
## keeps to RING_CLIMB, or it reaches MAX_BLEND. Elsewhere a wider ring
## only reaches further into the hills, so it isn't widened.
func _blend_for(x: float, z: float, y: float, r: float, ways: PackedFloat64Array) -> float:
	var drop := 0.0
	for a in 16:
		drop = maxf(drop, absf(y - _bare_at(x + cos(TAU * a / 16.0) * r, z + sin(TAU * a / 16.0) * r)))
	var b := clampf(1.5 * drop / tan(deg_to_rad(BLEND_SLOPE)), MIN_BLEND, MAX_BLEND)
	if ways.is_empty():
		return b
	const N := int(MAX_BLEND) + 1 # samples 1 m apart, padR .. padR + MAX_BLEND
	var plain := PackedFloat64Array()
	plain.resize(ways.size() * N)
	for w in ways.size():
		var ux := cos(ways[w])
		var uz := sin(ways[w])
		for i in N:
			plain[w * N + i] = _bare_at(x + ux * (r + i), z + uz * (r + i))
	var climb := tan(deg_to_rad(RING_CLIMB))
	var flat := tan(deg_to_rad(RING_PLAIN))
	while b < MAX_BLEND and not _ring_ok(plain, N, ways.size(), y, b, climb, flat):
		b = minf(MAX_BLEND, b + RING_STEP)
	return b


## Whether a ring b wide keeps every 1 m step in under `climb` where the
## plain step is under `flat`. plain is one row of n heights per way, from
## padR out.
static func _ring_ok(plain: PackedFloat64Array, n: int, ways: int, y: float, b: float, climb: float, flat: float) -> bool:
	var last := mini(n - 1, ceili(b) + 1)
	for w in ways:
		var o := w * n
		var step := y - plain[o]
		var prev := y
		for i in range(1, last + 1):
			var h := plain[o + i] + step * (1.0 - smoothstep(0.0, b, float(i)))
			if absf(plain[o + i] - plain[o + i - 1]) <= flat and absf(h - prev) > climb:
				return false
			prev = h
	return true


## The angles, from (x, z), of the last TRAIL_LOOK m of every trail that
## ends within padR + 4 of it (the trail rule in trails.ts), every 2 m.
static func _trail_ways(trails: Array, x: float, z: float, r: float) -> PackedFloat64Array:
	var out := PackedFloat64Array()
	var c := Vector2(x, z)
	for tr: Dictionary in trails:
		var pts: Array = tr.get("pts", [])
		if pts.size() < 2:
			continue
		for e in [[0, 1], [pts.size() - 1, -1]]:
			var j: int = e[0]
			if Vector2(pts[j][0], pts[j][1]).distance_to(c) > r + 4.0:
				continue
			var walked := 0.0
			while walked < TRAIL_LOOK and j + e[1] >= 0 and j + e[1] < pts.size():
				var a := Vector2(pts[j][0], pts[j][1])
				var b := Vector2(pts[j + e[1]][0], pts[j + e[1]][1])
				var s := 0.0
				while s < a.distance_to(b):
					var q := a + (b - a).normalized() * s - c
					out.append(atan2(q.y, q.x))
					s += 2.0
				walked += a.distance_to(b)
				j += e[1]
	return out


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
