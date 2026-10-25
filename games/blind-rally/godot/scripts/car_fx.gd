class_name CarFx
extends Node3D
## The car's visual feedback: dust and gravel off the rear wheels, tyre marks
## while sliding, speed streaks near the top end, a little body roll, and the
## front wheels steering. Everything is a pooled MultiMesh in world space (one
## draw call each), on render layer 2 so the static map never sees it.
##
## CPUParticles3D can't scale its emission rate continuously in 4.7 (no
## amount_ratio), so the dust is a hand-rolled pool: spawn rate follows speed
## and slip exactly, and puffs face the camera because we orient them.

const LAYER := 2
const PUFFS := 220 ## dust + gravel pool
const MARKS := 1400 ## tyre-mark quads; the oldest get overwritten
const STREAKS := 14

@export var enabled := true:
	set(v):
		enabled = v
		for mm in [_puff_mmi, _streak_mmi]:
			if mm:
				mm.visible = v
## Phones get half the dust.
@export var density := 1.0

## Wheel contact points in the car's frame (-Z forward).
var wheels := [Vector3(-0.59, 0, -1.12), Vector3(0.59, 0, -1.12), Vector3(-0.59, 0, 1.12), Vector3(0.59, 0, 1.12)]
var marks_placed := 0 ## total ever, for tests

var _car: CarController
var _visual: Node3D
var _wheel_nodes: Array[Node3D] = []
var _rng := RandomNumberGenerator.new()

var _puff_mm: MultiMesh
var _puff_mmi: MultiMeshInstance3D
var _p_pos := PackedVector3Array()
var _p_vel := PackedVector3Array()
var _p_age := PackedFloat32Array()
var _p_life := PackedFloat32Array()
var _p_size := PackedVector2Array() # start, end
var _p_col := PackedColorArray()
var _p_grav := PackedFloat32Array()
var _p_next := 0
var _emit_acc := [0.0, 0.0] # dust per rear wheel
var _grit_acc := [0.0, 0.0]
var _buf := PackedFloat32Array()
var _puffs_live := false

var _mark_mm: MultiMesh
var _mark_next := 0
var _mark_last: Array = [null, null, null, null] # last contact per wheel, or null

var _streak_mm: MultiMesh
var _streak_mmi: MultiMeshInstance3D
var _s_pos := PackedVector3Array()
var _s_age := PackedFloat32Array()
var _s_next := 0
var _streak_acc := 0.0
var _spin := 0.0
var _xray: Node3D
var _xray_mat: StandardMaterial3D
var _xray_a := 0.0
var _probe := SphereShape3D.new()
var _ground_up := Vector3.UP


func _ready() -> void:
	_car = get_parent() as CarController
	_visual = _car.get_node("Visual")
	for w in ["WheelFL", "WheelFR", "WheelRL", "WheelRR"]:
		_wheel_nodes.append(_visual.get_node(w))
	_rng.seed = 1234
	_xray = _car.get_node("XRay")
	_xray_mat = (_xray.get_node("Ring") as MeshInstance3D).mesh.surface_get_material(0)
	_probe.radius = 1.4
	_build_puffs()
	_build_marks()
	_build_streaks()


func _build_puffs() -> void:
	# A soft disc: opaque centre fading to a transparent rim, no texture needed.
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	const SEG := 10
	for i in SEG:
		var a := TAU * i / SEG
		var b := TAU * (i + 1) / SEG
		for v in [[Vector3.ZERO, 1.0], [Vector3(cos(b), sin(b), 0) * 0.5, 0.0], [Vector3(cos(a), sin(a), 0) * 0.5, 0.0]]:
			st.set_color(Color(1, 1, 1, v[1]))
			st.set_normal(Vector3.BACK)
			st.add_vertex(v[0])
	var mesh := st.commit()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.vertex_color_use_as_albedo = true
	mat.vertex_color_is_srgb = true
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mesh.surface_set_material(0, mat)
	_puff_mm = MultiMesh.new()
	_puff_mm.transform_format = MultiMesh.TRANSFORM_3D
	_puff_mm.use_colors = true
	_puff_mm.mesh = mesh
	_puff_mm.instance_count = PUFFS
	_puff_mmi = _world_mmi("Dust", _puff_mm)
	for arr in [_p_pos, _p_vel]:
		arr.resize(PUFFS)
	for arr in [_p_age, _p_life, _p_grav]:
		arr.resize(PUFFS)
	_p_size.resize(PUFFS)
	_p_col.resize(PUFFS)
	_p_age.fill(1.0)
	_p_life.fill(1.0)
	_buf.resize(PUFFS * 16)
	_buf.fill(0.0)
	_puff_mm.buffer = _buf


func _build_marks() -> void:
	var quad := PlaneMesh.new()
	quad.size = Vector2(1, 1)
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 1.0
	quad.material = mat
	_mark_mm = MultiMesh.new()
	_mark_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mark_mm.use_colors = true
	_mark_mm.mesh = quad
	_mark_mm.instance_count = MARKS
	_mark_mm.visible_instance_count = 0
	var mmi := _world_mmi("TyreMarks", _mark_mm)
	# Marks live on the ground forever; the AABB must cover the whole stage.
	mmi.custom_aabb = AABB(Vector3(-5000, -10, -5000), Vector3(10000, 20, 10000))


func _build_streaks() -> void:
	var box := BoxMesh.new()
	box.size = Vector3(0.05, 0.05, 1.0)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.vertex_color_use_as_albedo = true
	box.material = mat
	_streak_mm = MultiMesh.new()
	_streak_mm.transform_format = MultiMesh.TRANSFORM_3D
	_streak_mm.use_colors = true
	_streak_mm.mesh = box
	_streak_mm.instance_count = STREAKS
	_streak_mmi = _world_mmi("Streaks", _streak_mm)
	_s_pos.resize(STREAKS)
	_s_age.resize(STREAKS)
	_s_age.fill(99.0)
	for i in STREAKS:
		_streak_mm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))


func _world_mmi(n: String, mm: MultiMesh) -> MultiMeshInstance3D:
	var mmi := MultiMeshInstance3D.new()
	mmi.name = n
	mmi.multimesh = mm
	mmi.layers = LAYER
	mmi.top_level = true # world space; the car moving doesn't drag its dust along
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	mmi.global_transform = Transform3D.IDENTITY
	return mmi


## After a teleport: don't draw a mark from the old spot to the new one.
func reset_trail() -> void:
	_mark_last = [null, null, null, null]


## Wipes marks and dust, e.g. on a new race.
func clear() -> void:
	_mark_mm.visible_instance_count = 0
	_mark_next = 0
	_mark_last = [null, null, null, null]
	_p_age.fill(99.0)


func _process(dt: float) -> void:
	if not _car:
		return
	var xf := _car.global_transform
	var speed := Vector2(_car.velocity.x, _car.velocity.z).length()
	var speed_k := clampf(speed / _car.max_speed, 0.0, 1.0)
	var lat := absf(_car.lateral_speed)
	var on_road := _car.surface == "road"
	_animate_visual(dt, speed)
	if dt <= 0.0:
		return
	_update_xray(dt)
	if enabled:
		_emit_dust(dt, xf, speed, speed_k, lat, on_road)
	_step_puffs(dt)
	_tyre_marks(xf, speed, lat, on_road)
	if enabled:
		_streaks(dt, xf, speed_k)


func _animate_visual(dt: float, speed: float) -> void:
	# Front wheels steer; all spin (barely visible, but it's cheap).
	_spin = fmod(_spin + _car.forward_speed * dt / 0.41, TAU)
	for i in 4:
		var w := _wheel_nodes[i]
		var steer := -_car.steer_actual * 0.45 if i < 2 else 0.0
		var flip := PI if (i % 2 == 1) else 0.0
		w.rotation = Vector3(-_spin if flip == 0.0 else _spin, steer + flip, 0)
	# Body rolls out of the slide and squats under power. Small and damped.
	var roll := clampf(_car.yaw_rate * speed * 0.004 + _car.lateral_speed * 0.006, -0.07, 0.07)
	var pitch := clampf((_car.throttle_input - _car.brake_input) * 0.025 * clampf(speed / 8.0, 0.0, 1.0), -0.03, 0.03)
	var body: Node3D = _visual.get_node("Body")
	var k := 1.0 - exp(-8.0 * dt)
	# Sit on the slope: tilt the whole visual to the ground under it. The
	# physics body stays upright (it's a box sliding on a heightfield); only
	# what you see follows the hill.
	if _car.is_on_floor():
		_ground_up = _car.global_basis.inverse() * _car.get_floor_normal()
	var tilt := Basis(Quaternion(Vector3.UP, _ground_up.normalized()))
	_visual.basis = Basis(_visual.basis.get_rotation_quaternion().slerp(Quaternion(tilt * Basis(Vector3.UP, PI)), k))
	body.rotation.z = lerpf(body.rotation.z, -roll, k)
	body.rotation.x = lerpf(body.rotation.x, -pitch, k)


func _emit_dust(dt: float, xf: Transform3D, speed: float, speed_k: float, lat: float, road: bool) -> void:
	var slide_k := clampf((lat - 1.0) / 6.0, 0.0, 1.0)
	var spin_k := clampf(_car.throttle_input * (1.0 - speed / 10.0), 0.0, 1.0) if speed > 0.5 else 0.0
	# Puffs per second, per rear wheel.
	var rate := (pow(speed_k, 1.3) * 30.0 + slide_k * 80.0 + spin_k * 25.0) * density
	var grit_rate := (_car.throttle_input * speed_k * 10.0 + slide_k * 30.0 + spin_k * 25.0) * density
	if speed < 2.0:
		rate = 0.0
		grit_rate *= spin_k
	# Paler than the road it comes off, or it vanishes against it from above.
	var dust_col := Color("e3d4b4") if road else Color("a8957a")
	var fwd := -xf.basis.z
	var right := xf.basis.x
	for w in 2:
		var contact: Vector3 = xf * wheels[2 + w]
		_emit_acc[w] += rate * dt
		while _emit_acc[w] >= 1.0:
			_emit_acc[w] -= 1.0
			var v := _car.velocity * 0.25 - fwd * _rng.randf_range(0.5, 2.0) + right * _rng.randf_range(-1.0, 1.0) * (1.0 + slide_k * 2.0) + Vector3.UP * _rng.randf_range(0.6, 1.6)
			var big := 1.0 + slide_k * 0.8
			_spawn(contact + Vector3(0, 0.3, 0), v, _rng.randf_range(1.0, 1.9) * big, Vector2(0.9, _rng.randf_range(3.0, 4.4) * big), dust_col.lightened(_rng.randf_range(-0.04, 0.08)), 0.0, 0.55 + 0.25 * slide_k)
		_grit_acc[w] += grit_rate * dt
		while _grit_acc[w] >= 1.0:
			_grit_acc[w] -= 1.0
			# Gravel flung back and out, mostly away from the slide.
			var side := signf(_car.lateral_speed) if lat > 1.0 else (1.0 if w == 1 else -1.0)
			var v := _car.velocity * 0.4 - fwd * _rng.randf_range(2.0, 5.0) + right * side * _rng.randf_range(0.5, 3.0) + Vector3.UP * _rng.randf_range(2.0, 4.5)
			var s := _rng.randf_range(0.12, 0.22)
			_spawn(contact + Vector3(0, 0.15, 0), v, _rng.randf_range(0.35, 0.6), Vector2(s, s), Color("4a4136"), 9.8, 1.0)


func _spawn(p: Vector3, v: Vector3, life: float, size: Vector2, col: Color, grav: float, alpha: float) -> void:
	var i := _p_next
	_p_next = (_p_next + 1) % PUFFS
	_p_pos[i] = p
	_p_vel[i] = v
	_p_age[i] = 0.0
	_p_life[i] = life
	_p_size[i] = size
	col.a = alpha
	_p_col[i] = col
	_p_grav[i] = grav


func _step_puffs(dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	var face := cam.global_basis if cam else Basis.IDENTITY
	var any := false
	for i in PUFFS:
		var o := i * 16
		if _p_age[i] >= _p_life[i]:
			if _buf[o] != 0.0 or _buf[o + 5] != 0.0:
				for k in 12:
					_buf[o + k] = 0.0
			continue
		any = true
		_p_age[i] += dt
		var t := clampf(_p_age[i] / _p_life[i], 0.0, 1.0)
		var v := _p_vel[i]
		v.y -= _p_grav[i] * dt
		v *= 1.0 - (2.2 if _p_grav[i] == 0.0 else 0.4) * dt # dust hangs, grit flies
		var p := _p_pos[i] + v * dt
		var floor_y := _car.global_position.y + 0.05 # near enough: grit lives half a second
		if p.y < floor_y and _p_grav[i] > 0.0:
			p.y = floor_y
			v = Vector3.ZERO
		_p_pos[i] = p
		_p_vel[i] = v
		var s := lerpf(_p_size[i].x, _p_size[i].y, 1.0 - pow(1.0 - t, 2.0))
		var b := face.scaled(Vector3(s, s, s))
		# Transform3D buffer layout: basis rows with origin as the 4th column.
		_buf[o] = b.x.x; _buf[o + 1] = b.y.x; _buf[o + 2] = b.z.x; _buf[o + 3] = p.x
		_buf[o + 4] = b.x.y; _buf[o + 5] = b.y.y; _buf[o + 6] = b.z.y; _buf[o + 7] = p.y
		_buf[o + 8] = b.x.z; _buf[o + 9] = b.y.z; _buf[o + 10] = b.z.z; _buf[o + 11] = p.z
		var c := _p_col[i]
		var fade := (1.0 - t) * minf(1.0, t * 8.0)
		_buf[o + 12] = c.r; _buf[o + 13] = c.g; _buf[o + 14] = c.b; _buf[o + 15] = c.a * fade
	if any or _puffs_live:
		_puff_mm.buffer = _buf
	_puffs_live = any


func _tyre_marks(xf: Transform3D, speed: float, lat: float, road: bool) -> void:
	# Marks while sliding, braking hard, or spinning up from a standstill.
	var braking := _car.brake_input > 0.5 and _car.forward_speed > 6.0
	var spinning := _car.throttle_input > 0.8 and speed > 1.0 and speed < 9.0
	var slide := lat > 2.2
	var on := slide or braking or spinning
	var strength := clampf(maxf((lat - 2.2) / 5.0, 0.35 if (braking or spinning) else 0.0), 0.0, 1.0)
	for w in 4:
		var front := w < 2
		# Fronts only mark in a big slide or under braking.
		var mark := on and (not front or lat > 4.5 or braking)
		var p: Vector3 = xf * wheels[w]
		p.y += 0.05 # on the ground under the wheel; the car follows the terrain
		if not mark:
			_mark_last[w] = null
			continue
		if _mark_last[w] == null:
			_mark_last[w] = p
			continue
		var last: Vector3 = _mark_last[w]
		var d := p.distance_to(last)
		if d < 0.45:
			continue
		var dir := (p - last) / d
		# x = up × dir keeps the basis right-handed; mirrored quads get culled.
		var side := Vector3(dir.z, 0, -dir.x)
		var basis := Basis(side * 0.32, Vector3.UP, dir * (d + 0.06))
		var i := _mark_next
		_mark_next = (_mark_next + 1) % MARKS
		_mark_mm.set_instance_transform(i, Transform3D(basis, (p + last) * 0.5))
		var col := Color(0.16, 0.12, 0.08, lerpf(0.25, 0.55, strength)) if road else Color(0.12, 0.1, 0.06, lerpf(0.3, 0.6, strength))
		_mark_mm.set_instance_color(i, col)
		_mark_mm.visible_instance_count = mini(_mark_mm.visible_instance_count + 1, MARKS) if _mark_mm.visible_instance_count < MARKS else MARKS
		_mark_last[w] = p
		marks_placed += 1


## A faint ring that fades in only while the canopy (or a building) sits
## between the camera and the car, so it's never lost under the trees. Three
## sphere probes up the view ray stand in for "is a crown in the way".
func _update_xray(dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	var hidden := false
	if cam:
		var space := _car.get_world_3d().direct_space_state
		var q := PhysicsShapeQueryParameters3D.new()
		q.shape = _probe
		q.collision_mask = 1
		var up := cam.global_basis.z
		for d in [3.0, 6.5, 10.0]:
			q.transform = Transform3D(Basis.IDENTITY, _car.global_position + Vector3(0, 0.8, 0) + up * d)
			if not space.intersect_shape(q, 1).is_empty():
				hidden = true
				break
	_xray_a = move_toward(_xray_a, 0.55 if hidden else 0.0, dt * 3.0)
	_xray.visible = _xray_a > 0.01
	_xray_mat.albedo_color.a = _xray_a


## Faint streaks that the car rushes past, only in the last 15% of top speed.
func _streaks(dt: float, xf: Transform3D, speed_k: float) -> void:
	var k := smoothstep(0.85, 1.0, speed_k)
	var fwd := -xf.basis.z
	var right := xf.basis.x
	_streak_acc += k * 30.0 * dt
	while _streak_acc >= 1.0:
		_streak_acc -= 1.0
		var i := _s_next
		_s_next = (_s_next + 1) % STREAKS
		var side := -1.0 if _rng.randf() < 0.5 else 1.0
		_s_pos[i] = xf.origin + fwd * _rng.randf_range(8.0, 16.0) + right * side * _rng.randf_range(2.0, 6.0) + Vector3.UP * _rng.randf_range(0.4, 2.2)
		_s_age[i] = 0.0
	var len := 1.0 + 4.0 * k
	var basis := Basis.looking_at(fwd, Vector3.UP).scaled(Vector3(1, 1, len))
	for i in STREAKS:
		_s_age[i] += dt
		var t := _s_age[i] / 0.45
		if t >= 1.0:
			_streak_mm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO), Vector3.ZERO))
			continue
		_streak_mm.set_instance_transform(i, Transform3D(basis, _s_pos[i]))
		_streak_mm.set_instance_color(i, Color(1, 1, 1, 0.3 * k * sin(t * PI)))
