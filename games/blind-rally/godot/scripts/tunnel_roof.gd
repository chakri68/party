class_name TunnelRoof
extends MeshInstance3D
## The rock over a tunnel (Cliffhanger's sea tunnel), and what it does for
## the top-down camera: it dissolves while the car is in or near the bore,
## so the Navigator sees the road, the walls and the car under it, and
## comes back once the car is clear. A dithered cut, not alpha: the roof
## stays opaque (no sorting, no blending), it just drops a growing share of
## its pixels in a fixed screen pattern; at most CUT_MAX of them, so a faint
## stipple says "you're under rock" without hiding anything.
##
## Chase and bonnet never cut it: they're in the tunnel with the car, and
## its dark is the point. The static map doesn't need it either: the road
## ribbon draws 30 m above everything, and the map renders once at the
## start, roof whole.
##
## The fade is camera state, not world state: it's the same tunnel for every
## team, and nothing here touches physics.

const CUT_MAX := 0.88
const FADE_S := 0.35 ## seconds to dissolve or come back

## The bore's centreline, portal to portal (world).
@export var line := PackedVector3Array()
## Metres from the bore's line where the cut starts, and where it's full.
@export var reach := Vector2(26.0, 14.0)

var cut := 0.0 ## 0 whole .. 1 cut as far as it goes; for tests


func _process(dt: float) -> void:
	var want := 0.0
	var cam := get_viewport().get_camera_3d() as FollowCamera
	if cam and cam.mode == FollowCamera.Mode.TOP_DOWN and cam.target:
		want = 1.0 - smoothstep(reach.y, reach.x, distance_to_bore(cam.target.global_position))
	cut = move_toward(cut, want, dt / FADE_S)
	var m := mesh.surface_get_material(0) as ShaderMaterial if mesh else null
	if m:
		m.set_shader_parameter("cut", cut * CUT_MAX)


## Flat distance from p to the bore's line.
func distance_to_bore(p: Vector3) -> float:
	var q := Vector2(p.x, p.z)
	var best := INF
	for i in line.size() - 1:
		var a := Vector2(line[i].x, line[i].z)
		var b := Vector2(line[i + 1].x, line[i + 1].z)
		var ab := b - a
		var t := clampf((q - a).dot(ab) / maxf(ab.length_squared(), 1e-6), 0.0, 1.0)
		best = minf(best, q.distance_to(a + ab * t))
	return best
