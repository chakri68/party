class_name CarController
extends CharacterBody3D
## Arcade car. Not a tyre model: a forward speed, a sideways slip that grip
## bleeds off, and a yaw rate that scales with speed. Predictable, slightly
## silly, which is the brief.
##
## Control comes from set_control() (the Driver's phone, via the web bridge)
## or the keyboard when testing locally. Remote control goes neutral after
## CONTROL_TIMEOUT of silence, measured in physics time so a hitching tab
## doesn't make the car coast on a stale throttle.

signal impact(strength: float, collider: Object)

const CONTROL_TIMEOUT := 0.3

## Per-surface multipliers. "offroad" is the ground; anything the surface ray
## doesn't hit counts as offroad too.
const SURFACES := {
	"road": {"drag": 1.0, "grip": 1.0, "top": 1.0},
	"offroad": {"drag": 3.2, "grip": 0.75, "top": 0.5},
	"sand": {"drag": 4.5, "grip": 0.65, "top": 0.4},
	"ice": {"drag": 0.6, "grip": 0.15, "top": 1.0},
}

@export_group("Engine")
@export var engine_accel := 14.0 ## m/s² at full throttle
@export var brake_decel := 26.0
@export var reverse_accel := 7.0
@export var max_speed := 28.0 ## m/s on road, ~100 km/h
@export var max_reverse := 7.0
@export var drag := 0.25 ## linear drag coefficient, 1/s
@export var rolling := 1.2 ## constant rolling resistance, m/s²

@export_group("Steering")
@export var max_yaw_rate := 2.4 ## rad/s at full lock and ideal speed
@export var steer_rate := 4.0 ## how fast the wheel can move, full lock per 1/rate s
@export var full_steer_speed := 6.0 ## below this, steering fades toward zero
@export var high_speed_steer := 0.45 ## fraction of yaw rate left at max_speed

@export_group("Grip")
@export var grip := 9.0 ## how fast lateral slip decays, 1/s
@export var drift_grip := 0.45 ## grip multiplier at full lock and high speed

@export_group("Collision")
@export var impact_threshold := 2.0 ## m/s into the wall before it counts
@export var impact_keep := 0.45 ## fraction of speed kept after a real hit

var keyboard_enabled := true
## Read-only state for HUD, snapshots, tests.
var steer_input := 0.0
var throttle_input := 0.0
var brake_input := 0.0
var steer_actual := 0.0
var forward_speed := 0.0
var surface := "offroad"
var distance_travelled := 0.0 ## trip meter: actual path, detours included
var frozen := false

var _remote := Vector3.ZERO # steer, throttle, brake
var _since_control := INF
var _impact_cooldown := 0.0

@onready var _ray: RayCast3D = $SurfaceRay


## The one external input. Values are clamped; anything else is the bridge's
## problem. Call at any rate; 25-30 Hz is plenty.
func set_control(steer: float, throttle: float, brake: float) -> void:
	_remote = Vector3(clampf(steer, -1, 1), clampf(throttle, 0, 1), clampf(brake, 0, 1))
	_since_control = 0.0


## Instantly neutral, e.g. when the server says the Driver disconnected.
func neutralize() -> void:
	_remote = Vector3.ZERO
	_since_control = INF


## Teleport to a recovery anchor (or spawn) and stop dead.
func reset_to(xf: Transform3D) -> void:
	global_transform = Transform3D(Basis(Vector3.UP, xf.basis.get_euler().y), xf.origin)
	velocity = Vector3.ZERO
	forward_speed = 0.0
	steer_actual = 0.0
	reset_physics_interpolation()


func _physics_process(dt: float) -> void:
	_since_control += dt
	_impact_cooldown = maxf(0.0, _impact_cooldown - dt)
	_read_input()
	_read_surface()
	var s: Dictionary = SURFACES.get(surface, SURFACES["offroad"])

	var fwd := -global_basis.z
	fwd = Vector3(fwd.x, 0, fwd.z).normalized()
	var right := Vector3(-fwd.z, 0, fwd.x)
	var v_fwd := velocity.dot(fwd)
	var v_lat := velocity.dot(right)
	var throttle := 0.0 if frozen else throttle_input
	var brake := 0.0 if frozen else brake_input

	# Longitudinal: throttle forward, brake until stopped, then reverse.
	var top: float = max_speed * s.top
	if throttle > 0.0 and v_fwd < top:
		v_fwd = minf(v_fwd + engine_accel * throttle * dt, top)
	if brake > 0.0:
		if v_fwd > 0.5:
			v_fwd = maxf(v_fwd - brake_decel * brake * dt, 0.0)
		else:
			v_fwd = maxf(v_fwd - reverse_accel * brake * dt, -max_reverse)
	# Drag: linear plus rolling, scaled by surface. Going over the surface's top
	# speed (just drove onto grass at 25 m/s) bleeds off fast but not instantly.
	var d: float = drag * s.drag
	if absf(v_fwd) > top:
		d += 1.5
	v_fwd -= v_fwd * d * dt
	v_fwd = move_toward(v_fwd, 0.0, rolling * s.drag * dt * (0.0 if throttle > 0.0 else 1.0))
	if frozen:
		v_fwd = move_toward(v_fwd, 0.0, brake_decel * dt)

	# Steering: the wheel turns at a limited rate; yaw rate scales with speed,
	# fades out near standstill and tightens at high speed.
	var target_steer := 0.0 if frozen else steer_input
	steer_actual = move_toward(steer_actual, target_steer, steer_rate * dt)
	var speed := absf(v_fwd)
	var low := clampf(speed / full_steer_speed, 0.0, 1.0)
	var high := lerpf(1.0, high_speed_steer, clampf(speed / max_speed, 0.0, 1.0))
	var yaw_rate := -steer_actual * max_yaw_rate * low * high * signf(v_fwd)
	rotate_y(yaw_rate * dt)

	# Grip: kill lateral slip, less so at full lock and speed (mild drift).
	var slide := absf(steer_actual) * clampf(speed / max_speed, 0.0, 1.0)
	var g: float = grip * s.grip * lerpf(1.0, drift_grip, slide)
	v_lat = lerpf(v_lat, 0.0, clampf(g * dt, 0.0, 1.0))

	# Recompose against the old axes; the rotation above means the car now
	# points slightly away from its velocity, which is where drift comes from.
	var vy := velocity.y - 20.0 * dt if not is_on_floor() else -0.5
	var before := fwd * v_fwd + right * v_lat
	velocity = before + Vector3.UP * vy
	var start := global_position
	move_and_slide()
	distance_travelled += Vector2(global_position.x - start.x, global_position.z - start.z).length()

	_handle_collisions(before)
	forward_speed = velocity.dot(-global_basis.z)


func _read_input() -> void:
	var kb := _keyboard() if keyboard_enabled else Vector3.ZERO
	if kb != Vector3.ZERO:
		steer_input = kb.x
		throttle_input = kb.y
		brake_input = kb.z
	elif _since_control <= CONTROL_TIMEOUT:
		steer_input = _remote.x
		throttle_input = _remote.y
		brake_input = _remote.z
	else:
		steer_input = 0.0
		throttle_input = 0.0
		brake_input = 0.0


func _keyboard() -> Vector3:
	var steer := 0.0
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
		steer -= 1.0
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
		steer += 1.0
	var throttle := 1.0 if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP) else 0.0
	var brake := 1.0 if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN) else 0.0
	return Vector3(steer, throttle, brake)


func _read_surface() -> void:
	_ray.force_raycast_update()
	var c := _ray.get_collider()
	surface = String(c.get_meta("surface", "offroad")) if c else "offroad"


## move_and_slide already strips the velocity going into a wall. On top of
## that a real hit costs momentum, so trees hurt instead of acting as rails.
func _handle_collisions(before: Vector3) -> void:
	var worst := 0.0
	var who: Object = null
	for i in get_slide_collision_count():
		var col := get_slide_collision(i)
		var n := col.get_normal()
		if absf(n.y) > 0.6:
			continue # floor
		var into := -before.dot(n)
		if into > worst:
			worst = into
			who = col.get_collider()
	if worst > impact_threshold:
		var keep := lerpf(1.0, impact_keep, clampf(worst / max_speed * 2.0, 0.0, 1.0))
		velocity.x *= keep
		velocity.z *= keep
		if _impact_cooldown == 0.0:
			_impact_cooldown = 0.25
			impact.emit(worst, who)
