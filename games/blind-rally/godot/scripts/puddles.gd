class_name Puddles
extends RefCounted
## Where the rain pools: about one puddle per 120 m of road, the same for
## every team (the room seed and the stage decide them, nothing else).
##
## Walk the centreline, one candidate every SPACING m, slid up to JITTER m
## along it and up to SIDE m across. A candidate stays only if a ray down
## the surface-probe layer (physics layer 4, what the car's SurfaceRay reads)
## lands on road or tarmac, so a puddle never sits on the verge, a bridge
## deck that isn't road, or the ground. Snow stages get none: rain falls as
## snow there.
##
## Each is (x, z, radius). Weather draws them (weather.gdshaderinc
## puddle_at), and CarController drags in them while the road is wet.

const PUDDLE_MAX := 24 ## weather.gdshaderinc PUDDLE_MAX
const SPACING := 120.0
const JITTER := 30.0
const SIDE := 1.2 ## metres off the centreline: in a wheel track, give or take
const RADIUS := Vector2(1.6, 2.8)
const SURFACES := ["road", "tarmac"]
const PROBE_MASK := 8 ## physics layer 4


static func place(track: Track, seed_in: int, snowy: bool) -> PackedVector3Array:
	var out := PackedVector3Array()
	var c := track.centerline
	if snowy or c.size() < 3 or not track.is_inside_tree():
		return out
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("%d:puddles" % seed_in)
	var along := PackedFloat32Array([0.0])
	for i in range(1, c.size()):
		along.append(along[i - 1] + c[i].distance_to(c[i - 1]))
	var total := along[along.size() - 1]
	var space := track.get_world_3d().direct_space_state
	var i := 0
	var k := 1
	while k * SPACING < total and out.size() < PUDDLE_MAX:
		# Draw all three numbers every time, so one rejected candidate
		# never shifts the next.
		var m := k * SPACING + rng.randf_range(-JITTER, JITTER)
		var side := rng.randf_range(-SIDE, SIDE)
		var r := rng.randf_range(RADIUS.x, RADIUS.y)
		k += 1
		if m <= 10.0 or m >= total - 10.0:
			continue
		while i < along.size() - 2 and along[i + 1] < m:
			i += 1
		var a := c[i]
		var b := c[i + 1]
		var f := clampf((m - along[i]) / maxf(along[i + 1] - along[i], 1e-6), 0.0, 1.0)
		var dir := Vector3(b.x - a.x, 0, b.z - a.z).normalized()
		var p := a.lerp(b, f) + Vector3(-dir.z, 0, dir.x) * side
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(p + Vector3.UP * 4.0, p + Vector3.DOWN * 4.0, PROBE_MASK))
		if hit.is_empty() or not String(hit.collider.get_meta("surface", "")) in SURFACES:
			continue
		out.append(Vector3(p.x, p.z, r))
	return out
