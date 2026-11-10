class_name Pins
extends Node3D
## Your team's pins: a tall beacon in the team colour on each one, plus a
## flat ring at the base of your own. No colliders; you walk through them.
## Everything is keyed by id, so the list can arrive every update and only
## what changed is rebuilt. main keeps one outside the per-seed world and
## points `field` at the current ground; with no ground it only remembers.

const BEACON_RADIUS := 0.3
const BEACON_HEIGHT := 40.0
const RING_INNER := 0.6
const RING_OUTER := 0.9
## P looks this far, in steps of this size.
const RAY_STEP := 2.0
const RAY_RANGE := 600.0

var field: TerrainField

var _list: Dictionary = {} ## id -> cleaned entry {id, x, z, color, mine}
var _nodes: Dictionary = {} ## id -> Node3D


## Sets the ground. A new one rebuilds from the list we hold; none (a world
## torn down) drops the pins and the list with them: the next list is the
## new map's.
func set_field(f: TerrainField) -> void:
	field = f
	_clear_nodes()
	if f == null:
		_list.clear()
	else:
		_sync_nodes()


## The full list: [{id, x, z, color, mine}]. Entries that aren't well formed
## are dropped. A pin whose fields didn't change is left alone.
func apply(list: Array) -> void:
	_list.clear()
	for e in list:
		var c := _clean(e)
		if not c.is_empty():
			_list[c.id] = c
	_sync_nodes()


func count() -> int:
	return _nodes.size()


func has_pin(id: String) -> bool:
	return _nodes.has(id)


func beacon(id: String) -> MeshInstance3D:
	var n: Node3D = _nodes.get(id)
	return n.get_node_or_null("Beacon") if n else null


## The base ring; only your own pins have one.
func ring(id: String) -> MeshInstance3D:
	var n: Node3D = _nodes.get(id)
	return n.get_node_or_null("Ring") if n else null


## Where a ray from `from` along `dir` meets the ground: stepped 2 m at a
## time up to 600 m until a sample is at or under the surface, then bisected
## once between that sample and the one before. The Vector2 (x, z), or null
## if it never gets there (the sky).
static func ray_hit(f: TerrainField, from: Vector3, dir: Vector3) -> Variant:
	if f == null or dir.length_squared() < 1e-9:
		return null
	var d := dir.normalized()
	var prev := 0.0
	var t := 0.0
	while t <= RAY_RANGE:
		var p := from + d * t
		if p.y <= f.height_at(p.x, p.z):
			var at := t
			if t > 0.0:
				var mid := (prev + t) * 0.5
				var m := from + d * mid
				at = mid if m.y <= f.height_at(m.x, m.z) else t
			var h := from + d * at
			return Vector2(h.x, h.z)
		prev = t
		t += RAY_STEP
	return null


static func _clean(e: Variant) -> Dictionary:
	if not (e is Dictionary):
		return {}
	var id: Variant = e.get("id")
	var color: Variant = e.get("color")
	if not (id is String and id != "" and WebBridge._num(e.get("x")) and WebBridge._num(e.get("z"))):
		return {}
	if not (color is String and Color.html_is_valid(color)):
		return {}
	return {"id": id, "x": float(e.x), "z": float(e.z), "color": color, "mine": e.get("mine") == true}


func _clear_nodes() -> void:
	for n: Node3D in _nodes.values():
		remove_child(n)
		n.queue_free()
	_nodes.clear()


func _sync_nodes() -> void:
	if field == null:
		return
	for id: String in _nodes.keys():
		var gone := not _list.has(id)
		if not gone:
			gone = _nodes[id].get_meta("entry") != _list[id]
		if gone:
			var n: Node3D = _nodes[id]
			remove_child(n)
			n.queue_free()
			_nodes.erase(id)
	for id: String in _list:
		if not _nodes.has(id):
			_nodes[id] = _build(_list[id])


func _build(e: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = "Pin_" + String(e.id).validate_node_name()
	root.set_meta("entry", e)
	var col := Color(e.color)
	var h := field.height_at(e.x, e.z)
	add_child(root)
	root.global_position = Vector3(e.x, h, e.z)
	var cyl := CylinderMesh.new()
	cyl.top_radius = BEACON_RADIUS
	cyl.bottom_radius = BEACON_RADIUS
	cyl.height = BEACON_HEIGHT
	var b := MeshInstance3D.new()
	b.name = "Beacon"
	b.mesh = cyl
	b.material_override = _mat(col)
	b.position.y = BEACON_HEIGHT * 0.5
	b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(b)
	if e.mine:
		var torus := TorusMesh.new()
		torus.inner_radius = RING_INNER
		torus.outer_radius = RING_OUTER
		var r := MeshInstance3D.new()
		r.name = "Ring"
		r.mesh = torus
		r.material_override = _mat(col)
		r.position.y = 0.05
		r.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(r)
	return root


static func _mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c
	return m
