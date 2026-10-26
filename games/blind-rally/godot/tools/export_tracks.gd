extends SceneTree
## Writes games/blind-rally/data/tracks.json from the track scenes, in the
## shape shared/track-data.ts checks (map §3.5). The server validates
## checkpoint claims, resets and bounds against it; the Navigator's chrome
## prints its pace notes. Nobody edits that file by hand any more.
##
##   godot --headless --path . --script res://tools/export_tracks.gd
##
## Every *.scn / *.tscn under res://scenes/tracks/ whose root is a Track.
## Coordinates are Godot world space; distances are metres along the
## centreline measured from the spawn, flat (x, z only), which is how the
## car's trip meter counts too. Positions round to 1 cm, headings to 1 mrad,
## distances to the metre.
##
## Pace notes come from the centreline itself: the heading change over a
## 24 m chord gives a radius per sample, runs of tight samples are corners,
## the tightest radius in a run grades it (rally scale, 1 tightest .. 6
## nearly flat; a tight one that turns 90 degrees or more is a HAIRPIN),
## every landmark gets its own line, and every fork (a spur that looks like
## the road) says which way to keep. A
## corner's note sits at its entry, where the co-driver needs to have said
## it. Notes are printed static (spec §4.3); this file never says where the
## car is.

const TRACK_DIR := "res://scenes/tracks/"
## File order is the lobby's card order, and the first track is a new room's
## default, so it's the spec §6 order (easy first), not the alphabet. Scenes
## not listed here follow, alphabetically.
const ORDER := ["pine_panic", "dust_devil", "snowblind", "cliffhanger"]
const OUT := "res://../data/tracks.json"

## Half the chord, in centreline samples, for the radius estimate. The
## builder's samples are 2 m apart, so 6 is a 24 m chord, the same window
## build_pine_panic.gd's corner finder uses.
const CHORD_HALF := 6
## Radius (m) under which a sample counts as cornering at all.
const CORNER_R := 85.0
## Same-direction runs closer than this are one corner.
const MERGE_GAP_M := 20.0
## A corner has to turn at least this much in total to be called.
const MIN_TURN_DEG := 30.0
## Grade by the corner's tightest radius: [under this radius, call].
const GRADES := [[19.0, "1"], [27.0, "2"], [38.0, "3"], [52.0, "4"], [68.0, "5"], [INF, "6"]]
## Tighter than x metres and turning y degrees or more: a hairpin, not a 1.
const HAIRPIN := Vector2(20.0, 90.0)
## A run longer than this is "long".
const LONG_M := 60.0
## How far a landmark's own `distance_m` meta can be from where it projects.
## The road passes near itself in places; the meta picks the right pass.
const META_WINDOW_M := 40.0


func _initialize() -> void:
	_run.call_deferred() # the tree (and groups) only work once it's running


func _run() -> void:
	var tracks: Array = []
	var dir := DirAccess.open(TRACK_DIR)
	var files := Array(dir.get_files())
	files.sort_custom(func(a: String, b: String) -> bool:
		var ia := ORDER.find(a.get_basename())
		var ib := ORDER.find(b.get_basename())
		if ia == -1: ia = ORDER.size()
		if ib == -1: ib = ORDER.size()
		return ia < ib or (ia == ib and a < b))
	for f in files:
		if not (f.ends_with(".scn") or f.ends_with(".tscn")):
			continue
		var scene := load(TRACK_DIR + f) as PackedScene
		var t := scene.instantiate() as Track if scene else null
		if t == null:
			continue
		root.add_child(t)
		await process_frame
		var data := export_track(t)
		if data.is_empty():
			push_error("%s: not a usable track (no spawn?)" % f)
			quit(1)
			return
		tracks.append(data)
		t.free()
	var text := _fmt({"version": 1, "source": "written by godot/tools/export_tracks.gd from godot/scenes/tracks/; don't edit by hand", "tracks": tracks}, "") + "\n"
	var path := ProjectSettings.globalize_path(OUT).simplify_path()
	var fa := FileAccess.open(path, FileAccess.WRITE)
	if fa == null:
		push_error("can't write %s" % path)
		quit(1)
		return
	fa.store_string(text)
	fa.close()
	print("wrote %s: %d track(s)" % [path, tracks.size()])
	quit(0)


## One Track node (in the tree, so groups and global transforms work) as a
## TrackData dictionary.
static func export_track(t: Track) -> Dictionary:
	if t.get_spawn() == null or t.get_finish() == null or t.centerline.size() < 2:
		return {}
	var line := t.centerline
	var cum := cumulative(line)
	var zero := project(line, cum, t.get_spawn().global_position)
	var along := func(n: Node3D) -> float:
		var hint := float(n.get_meta("distance_m", -1.0))
		return project(line, cum, n.global_position, hint) - zero

	var cps: Array = []
	for cp in t.get_checkpoints():
		cps.append({"id": int(cp.get_meta("index")), "position": _v(cp.global_position), "radius": gate_radius(cp), "distance": roundf(along.call(cp))})
	var fin := t.get_finish()
	var length := roundf(along.call(fin))
	var rec: Array = []
	for a in t.get_recovery_anchors():
		rec.append({"afterCheckpoint": int(a.get_meta("after_checkpoint")), "position": _v(a.global_position), "heading": snappedf(a.global_rotation.y, 0.001)})

	var marks: Array = []
	for l in t.get_landmarks():
		marks.append({"id": String(l.name).to_snake_case(), "label": String(l.get_meta("label")), "position": _v(l.global_position), "distance": clampf(roundf(along.call(l)), 0.0, length)})
	marks.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.distance < b.distance)

	# [distance, order, text]: at one distance a corner goes before the
	# landmark beside it, so the sort keeps that order.
	var raw: Array = [[0.0, 0, "START"]]
	for c in corners(line, cum):
		var d := roundf(c.entry - zero)
		if d > 0.0 and d < length:
			raw.append([d, raw.size(), c.text])
	for m in marks:
		raw.append([m.distance, raw.size(), m.label])
	# Forks (group track_fork): which way the stage goes. Said at the fork,
	# after the corner it sits in, so "2 LEFT" then "KEEP LEFT (fork)".
	for f in t.get_forks():
		var d := roundf(along.call(f))
		if d > 0.0 and d < length:
			raw.append([d, raw.size(), "KEEP %s (fork)" % String(f.get_meta("keep", "left")).to_upper()])
	raw.append([length, raw.size(), "FINISH"])
	raw.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0] or (x[0] == y[0] and x[1] < y[1]))
	var notes: Array = []
	for r in raw:
		notes.append({"distance": r[0], "text": r[2]})

	var b := t.bounds
	return {
		"id": t.track_id,
		"revision": t.revision,
		"name": t.display_name,
		"difficulty": t.difficulty,
		"length": length,
		"par_seconds": null,
		"bounds": {"x": snappedf(b.position.x, 0.01), "z": snappedf(b.position.y, 0.01), "width": snappedf(b.size.x, 0.01), "depth": snappedf(b.size.y, 0.01)},
		"spawn": {"position": _v(t.get_spawn().global_position), "heading": snappedf(t.get_spawn().global_rotation.y, 0.001)},
		"checkpoints": cps,
		"finish": {"position": _v(fin.global_position), "radius": gate_radius(fin), "distance": length},
		"recovery": rec,
		"paceNotes": notes,
		"landmarks": marks,
	}


## Flat arc length at each centreline sample.
static func cumulative(line: PackedVector3Array) -> PackedFloat64Array:
	var out := PackedFloat64Array()
	out.resize(line.size())
	for i in range(1, line.size()):
		out[i] = out[i - 1] + _flat(line[i]).distance_to(_flat(line[i - 1]))
	return out


## Arc length of the point on the centreline nearest `p` (flat). With a hint
## (metres from the centreline's start, as the builder stores it), only
## samples within META_WINDOW_M of it are considered.
static func project(line: PackedVector3Array, cum: PackedFloat64Array, p: Vector3, hint := -1.0) -> float:
	var q := _flat(p)
	var best := INF
	var best_d := 0.0
	for i in range(line.size() - 1):
		if hint >= 0.0 and absf(cum[i] - hint) > META_WINDOW_M:
			continue
		var a := _flat(line[i])
		var b := _flat(line[i + 1])
		var ab := b - a
		var k := clampf((q - a).dot(ab) / maxf(ab.length_squared(), 1e-9), 0.0, 1.0)
		var dist := q.distance_squared_to(a + ab * k)
		if dist < best:
			best = dist
			best_d = cum[i] + (cum[i + 1] - cum[i]) * k
	return best_d


## The corners worth a note: [{entry, apex, radius, turn, text}], entry and
## apex in metres from the centreline's start. Runs of tight samples, the
## same way round and less than MERGE_GAP_M apart, are one corner: two
## kinks of a single bend get one call.
static func corners(line: PackedVector3Array, cum: PackedFloat64Array) -> Array:
	var n := line.size()
	var h := CHORD_HALF
	var tans: Array[Vector3] = []
	for i in n:
		var d := line[mini(i + 1, n - 1)] - line[maxi(i - 1, 0)]
		tans.append(Vector3(d.x, 0, d.z).normalized())
	var runs: Array = []
	for i in range(h, n - h):
		var dh := tans[i - h].signed_angle_to(tans[i + h], Vector3.UP)
		var r := (cum[i + h] - cum[i - h]) / maxf(absf(dh), 1e-4)
		if r >= CORNER_R:
			continue
		var side := signf(dh)
		var run: Dictionary = runs.back() if runs.size() else {}
		if run.is_empty() or run.side != side or cum[i] - cum[run.last] > MERGE_GAP_M:
			runs.append({"first": i, "last": i, "apex": i, "r": r, "side": side})
			continue
		run.last = i
		if r < run.r:
			run.r = r
			run.apex = i
	var out: Array = []
	for run in runs:
		# Heading in to heading out, across the run plus half a chord either side.
		var a: int = maxi(run.first - h, 0)
		var b: int = mini(run.last + h, n - 1)
		var turn := absf(rad_to_deg(tans[a].signed_angle_to(tans[b], Vector3.UP)))
		if turn < MIN_TURN_DEG:
			continue
		var dir := "LEFT" if run.side > 0.0 else "RIGHT"
		var text := ""
		if run.r < HAIRPIN.x and turn >= HAIRPIN.y:
			text = "HAIRPIN %s" % dir
		else:
			var grade := "6"
			for g in GRADES:
				if run.r < g[0]:
					grade = g[1]
					break
			text = "%s %s" % [dir, grade]
			if cum[run.last] - cum[run.first] > LONG_M:
				text += " long"
		out.append({"entry": cum[run.first], "apex": cum[run.apex], "radius": run.r, "turn": turn, "text": text})
	return out


## A gate's "at the gate" radius: half its box across the road, plus a metre.
static func gate_radius(area: Area3D) -> float:
	for c in area.get_children():
		var cs := c as CollisionShape3D
		if cs and cs.shape is BoxShape3D:
			return ceilf((cs.shape as BoxShape3D).size.x * 0.5) + 1.0
	return 8.0


static func _flat(p: Vector3) -> Vector2:
	return Vector2(p.x, p.z)


static func _v(p: Vector3) -> Array:
	return [snappedf(p.x, 0.01), snappedf(p.y, 0.01), snappedf(p.z, 0.01)]


# --- JSON in the file's house style: short things on one line ------------------

static func _fmt(v: Variant, indent: String) -> String:
	var flat := _inline(v)
	if flat.length() + indent.length() <= 120 or not (v is Dictionary or v is Array):
		return flat
	var inner := indent + "  "
	var parts: Array[String] = []
	if v is Dictionary:
		for k in v:
			parts.append("%s%s: %s" % [inner, JSON.stringify(String(k)), _fmt(v[k], inner)])
		return "{\n%s\n%s}" % [",\n".join(parts), indent]
	for x in v:
		parts.append(inner + _fmt(x, inner))
	return "[\n%s\n%s]" % [",\n".join(parts), indent]


static func _inline(v: Variant) -> String:
	if v is Dictionary:
		var parts: Array[String] = []
		for k in v:
			parts.append("%s: %s" % [JSON.stringify(String(k)), _inline(v[k])])
		return "{ %s }" % ", ".join(parts) if parts.size() else "{}"
	if v is Array:
		var parts: Array[String] = []
		for x in v:
			parts.append(_inline(x))
		return "[%s]" % ", ".join(parts)
	if v is float:
		var f: float = v
		if f == roundf(f) and absf(f) < 1e15:
			return str(int(f))
		return String.num(f, 3)
	return JSON.stringify(v)
