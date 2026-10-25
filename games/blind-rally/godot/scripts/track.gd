class_name Track
extends Node3D
## Root script every track scene uses. It's the entry-point interface from
## spec §6: the rest of the game only talks to tracks through this, and finds
## the semantic markers by group, never by hard-coded node paths.
##
## Marker groups (one convention for all tracks):
##   track_spawn       Marker3D, exactly one. -Z is the car's facing.
##   track_finish      Area3D, exactly one.
##   track_checkpoint  Area3D, meta "index" = 1..n, traversal order.
##   track_recovery    Marker3D, meta "after_checkpoint" = 0..n (0 = start).
##   track_landmark    Node3D, meta "label". Visible in 3D and on the map.
##                     Landmarks with meta "callout" are the smaller scenery
##                     (fire tower, outhouse...): same group, a map icon each.
##   track_obstacle    StaticBody3D you can hit (buildings, logs, bales). Forest
##                     chunks are Scatter bodies here too, many trees per node.
##   track_road        StaticBody3D with meta "surface" (road, offroad, sand, ice).
##   track_tall        A landmark tall enough to see from far off; meta
##                     "proxy_mesh" is drawn as a haze silhouette (EyeForest).
##   track_egg         Marker3D, meta "kind": where an easter egg can happen
##                     (EasterEggs decides per seed).
##
## Ground: a Terrain child named "Ground" (optional; without one the world is
## flat at y = 0). height_at() is the floor everything stands on.
##
## Physics layers: 1 world, 2 car, 3 triggers, 4 surface probes. Render layers:
## 1 world, 2 car and its effects (the static map camera never draws it),
## 3 map-only overlay (road ribbon, landmark icons; the 3D camera skips it),
## 4 weather (clouds and mist: 3D view only, never the map), 5 easter eggs,
## scenery lights and the fake junction (3D view only, never the map), 6
## shared-stage ghost cars (GhostCars: 3D view only, never the map).

signal checkpoint_entered(index: int, body: Node3D)
signal finish_entered(body: Node3D)

@export var track_id := ""
@export var display_name := ""
@export var revision := 1
## World-space XZ rectangle the course lives in. The map camera frames it and
## world_to_map() converts against it, so pins and replays agree with the map.
@export var bounds := Rect2(-100, -100, 200, 200)
@export_enum("easy", "medium", "hard") var difficulty := "easy"
## Road centreline from start to finish, evenly spaced. For pace notes,
## replays and tests; gameplay never reads it (checkpoints are volumes).
@export var centerline := PackedVector3Array()
@export var length_m := 0.0


func _ready() -> void:
	# Shader detail noise is made at load, not saved into the scene.
	for m in world_materials():
		m.set_shader_parameter("detail", DetailNoise.texture())
	for cp in get_checkpoints():
		var idx: int = cp.get_meta("index")
		cp.body_entered.connect(func(b: Node3D) -> void: checkpoint_entered.emit(idx, b))
	var fin := get_finish()
	if fin:
		fin.body_entered.connect(func(b: Node3D) -> void: finish_entered.emit(b))


## The track's own shader materials (road pieces, ground tiles), for whoever
## feeds them per-frame uniforms (Weather). The palette material isn't here:
## it's a shared resource, not the track's.
func world_materials() -> Array[ShaderMaterial]:
	var out: Array[ShaderMaterial] = []
	var road := get_node_or_null("Road")
	if road:
		for c in road.get_children():
			var mi := c as MeshInstance3D
			if mi and mi.mesh and mi.mesh.surface_get_material(0) is ShaderMaterial and not out.has(mi.mesh.surface_get_material(0)):
				out.append(mi.mesh.surface_get_material(0))
	var ground := get_node_or_null("Ground") as Terrain
	if ground and ground.material:
		out.append(ground.material)
	return out


func get_spawn() -> Marker3D:
	return _first("track_spawn") as Marker3D


func get_finish() -> Area3D:
	return _first("track_finish") as Area3D


## Checkpoints sorted by their "index" meta, so scene order doesn't matter.
func get_checkpoints() -> Array[Area3D]:
	var out: Array[Area3D] = []
	for n in _group("track_checkpoint"):
		out.append(n as Area3D)
	out.sort_custom(func(a: Node, b: Node) -> bool: return a.get_meta("index") < b.get_meta("index"))
	return out


## Recovery anchors sorted by the checkpoint they follow.
func get_recovery_anchors() -> Array[Marker3D]:
	var out: Array[Marker3D] = []
	for n in _group("track_recovery"):
		out.append(n as Marker3D)
	out.sort_custom(func(a: Node, b: Node) -> bool:
		return a.get_meta("after_checkpoint") < b.get_meta("after_checkpoint"))
	return out


## Where a reset lands after `checkpoints_passed` checkpoints. Reset can't skip
## ahead, so it's the last anchor at or before that count.
func recovery_for(checkpoints_passed: int) -> Marker3D:
	var best: Marker3D = null
	for a in get_recovery_anchors():
		if int(a.get_meta("after_checkpoint")) <= checkpoints_passed:
			best = a
	return best if best else get_spawn()


## Ground height at world (x, z): the same surface the car drives on.
func height_at(x: float, z: float) -> float:
	var t := get_node_or_null("Ground") as Terrain
	return t.height_at(x, z) if t else 0.0


func get_landmarks() -> Array[Node3D]:
	var out: Array[Node3D] = []
	for n in _group("track_landmark"):
		out.append(n as Node3D)
	return out


## World XZ -> normalized map coords (0..1, +x right, +z down). The map camera
## looks straight down with north (-Z) up, so this matches its pixels.
func world_to_map(p: Vector3) -> Vector2:
	var side := maxf(bounds.size.x, bounds.size.y)
	var c := bounds.get_center()
	return Vector2((p.x - c.x) / side + 0.5, (p.z - c.y) / side + 0.5)


func _group(g: String) -> Array[Node]:
	# Scope to this track; a scene could host more than one in the future.
	var out: Array[Node] = []
	for n in get_tree().get_nodes_in_group(g):
		if is_ancestor_of(n):
			out.append(n)
	return out


func _first(g: String) -> Node:
	var g_nodes := _group(g)
	return g_nodes[0] if not g_nodes.is_empty() else null
