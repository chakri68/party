class_name GhostCars
extends Node3D
## Shared stage (spec §7.4, §8.2): the other teams' cars, drawn from their
## Navigators' snapshots as the server relays them. A ghost is only a picture:
## no collision body at all, so nothing of ours can touch it (or it us), and
## nothing reads it but the renderer.
##
## - Team colour and the team's roof plate (shape plus number), so it isn't
##   colour alone (§10).
## - Render layer 6, which the static map's camera never draws; the
##   Navigator's camera draws every layer but the map overlay, so ghosts show
##   in top-down, chase and bonnet alike.
## - Drawn DELAY behind the newest snapshot and interpolated between the two
##   around that moment. Snapshots come at ~10 Hz, so 120 ms keeps one in hand
##   most of the time; a late one is bridged by a short extrapolation.
## - Faded as it closes on your own car, so yours always reads on top.
## - Gone after TIMEOUT without a snapshot (finished, dropped, DNF).
##
## Cost per ghost: one merged mesh (drawn twice: depth prepass and colour)
## and one Label3D for the number. No shadow.

const LAYER := 32 ## render layer 6
const DELAY := 0.12
const MAX_EXTRAPOLATE := 0.15
const TIMEOUT := 2.0
const MAX_GHOSTS := 7 ## the server's MAX_TEAMS is 4; this is a cap on junk, not a rule
const KEEP := 8 ## snapshots kept per ghost
## Fade with flat distance to your own car: faintest inside x metres, full by y.
const FADE := Vector2(4.0, 14.0)
const ALPHA := Vector2(0.22, 0.8)
const SHADER := preload("res://shaders/ghost.gdshader")

## Ours: the fade measures from it, and the ghost meshes copy its layout.
var car: Node3D
var weather: Weather
## Our own team: its relays are dropped if one ever arrives.
var own_team := -1
var enabled := true
## Seconds, advanced in _process. Arrival times and the render clock both
## use it, so a stalled tab doesn't make every ghost leap on the next frame.
var clock := 0.0

var _ghosts := {} ## team id -> Ghost


class Ghost:
	var node: Node3D
	var body: MeshInstance3D
	var tag: Label3D
	var mat: ShaderMaterial
	var color := ""
	var samples: Array = [] ## [arrival time, Vector3, yaw]
	var last_at := 0.0


## One rival snapshot (wire.ts GhostRelay as a Dictionary: teamId, color,
## tick, position [x,y,z], heading, speed). Malformed ones are dropped.
func receive(team_id: int, g: Dictionary) -> void:
	if not enabled or team_id == own_team or car == null:
		return
	var p: Variant = g.get("position")
	if not (p is Array and p.size() == 3 and _nums(p)) or not _num(g.get("heading")):
		return
	var pos := Vector3(float(p[0]), float(p[1]), float(p[2]))
	if not pos.is_finite():
		return
	var gh: Ghost = _ghosts.get(team_id)
	if gh == null:
		if _ghosts.size() >= MAX_GHOSTS:
			return
		gh = _spawn(team_id)
	var col := String(g.get("color", ""))
	if col != gh.color:
		_paint(gh, col)
	gh.samples.append([clock, pos, float(g["heading"])])
	if gh.samples.size() > KEEP:
		gh.samples.pop_front()
	gh.last_at = clock
	if gh.samples.size() == 1:
		_place(gh)


func count() -> int:
	return _ghosts.size()


func ghost_node(team_id: int) -> Node3D:
	var gh: Ghost = _ghosts.get(team_id)
	return gh.node if gh else null


func ghost_alpha(team_id: int) -> float:
	var gh: Ghost = _ghosts.get(team_id)
	return float(gh.mat.get_shader_parameter("alpha")) if gh else -1.0


func clear() -> void:
	for id in _ghosts.keys():
		_despawn(id)


func _process(dt: float) -> void:
	clock += dt
	for id in _ghosts.keys():
		var gh: Ghost = _ghosts[id]
		if clock - gh.last_at > TIMEOUT:
			_despawn(id)
		else:
			_place(gh)


## Pose at clock - DELAY, from the snapshots either side of it.
func pose_at(gh: Ghost, t: float) -> Array:
	var s := gh.samples
	if t <= s[0][0]:
		return [s[0][1], s[0][2]]
	for i in range(s.size() - 1, 0, -1):
		var a: Array = s[i - 1]
		var b: Array = s[i]
		if t >= a[0] and t <= b[0]:
			var k: float = 0.0 if b[0] <= a[0] else (t - a[0]) / (b[0] - a[0])
			return [a[1].lerp(b[1], k), lerp_angle(a[2], b[2], k)]
	# Past the newest: carry on along the last step a little, then wait.
	var last: Array = s[-1]
	if s.size() < 2:
		return [last[1], last[2]]
	var prev: Array = s[-2]
	var span: float = last[0] - prev[0]
	if span <= 0.0:
		return [last[1], last[2]]
	var k := minf(t - last[0], MAX_EXTRAPOLATE) / span
	return [last[1] + (last[1] - prev[1]) * k, last[2] + angle_difference(prev[2], last[2]) * k]


func _place(gh: Ghost) -> void:
	var pose := pose_at(gh, clock - DELAY)
	gh.node.global_transform = Transform3D(Basis(Vector3.UP, pose[1]), pose[0])
	var d := Vector2(pose[0].x - car.global_position.x, pose[0].z - car.global_position.z).length()
	var a := lerpf(ALPHA.x, ALPHA.y, smoothstep(FADE.x, FADE.y, d))
	gh.mat.set_shader_parameter("alpha", a)
	gh.tag.modulate.a = a


func _spawn(team_id: int) -> Ghost:
	var gh := Ghost.new()
	gh.node = Node3D.new()
	gh.node.name = "Ghost%d" % team_id
	add_child(gh.node)
	gh.mat = ShaderMaterial.new()
	gh.mat.shader = SHADER
	if weather:
		weather.register(gh.mat)
	gh.body = MeshInstance3D.new()
	gh.body.name = "Body"
	gh.body.layers = LAYER
	gh.body.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	gh.body.material_override = gh.mat
	gh.node.add_child(gh.body)
	gh.tag = Label3D.new()
	gh.tag.name = "Number"
	gh.tag.layers = LAYER
	gh.tag.text = str(team_id)
	gh.tag.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var src := car.get_node_or_null("Visual/Body/Roundel/Number") as Label3D
	if src:
		gh.tag.transform = car.global_transform.affine_inverse() * src.global_transform
		gh.tag.pixel_size = src.pixel_size
		gh.tag.font_size = src.font_size
		gh.tag.modulate = src.modulate
		gh.tag.outline_size = 0
	gh.node.add_child(gh.tag)
	_ghosts[team_id] = gh
	return gh


func _paint(gh: Ghost, hex: String) -> void:
	gh.color = hex
	var c := Color.from_string(hex, Color("888888"))
	var shape := CarPaint.shape_for(hex)
	gh.body.mesh = CarPaint.ghost_mesh(car, c, shape)
	if shape == "triangle":
		gh.tag.font_size = 72


func _despawn(team_id: int) -> void:
	var gh: Ghost = _ghosts[team_id]
	if weather:
		weather.unregister(gh.mat)
	gh.node.queue_free()
	_ghosts.erase(team_id)


func _nums(a: Array) -> bool:
	for v in a:
		if not _num(v):
			return false
	return true


func _num(v: Variant) -> bool:
	return (v is float or v is int) and is_finite(float(v))
