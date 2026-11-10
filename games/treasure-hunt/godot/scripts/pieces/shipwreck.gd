extends RefCounted
## Shipwreck (templates.ts): a hull of length L along Z, bow at −Z, beam
## B = 0.3 L, H = 0.25 L high. `buried` sinks it by that share of H, and
## `tilt` (degrees) rolls it about Z around its keel. Everything sits on the
## hull's centreline or inside its box, so a 20° roll moves nothing out past
## B/2 cos 20° + H sin 20°, which is under the 2 m templates.ts allows.


static func build(p: Dictionary, label: int) -> Node3D:
	var root := Node3D.new()
	var L := float(p.get("length", 16))
	var B := L * 0.3
	var H := L * 0.25
	var hull := Node3D.new()
	hull.name = "Hull"
	hull.position.y = -float(p.get("buried", 0)) * H
	hull.rotation.z = deg_to_rad(float(p.get("tilt", 0)))
	root.add_child(hull)

	var paint := PieceKit.mat(PieceKit.label_colour("shipwreck", label))
	var wood := PieceKit.mat(PieceKit.WOOD)
	var dark := PieceKit.mat(PieceKit.METAL)
	var bow := B * 0.9 # the pointed part, at the front of the length
	PieceKit.box(hull, Vector3(B, H, L - bow), Vector3(0, H * 0.5, bow * 0.5), paint)
	var prism := PrismMesh.new()
	prism.size = Vector3(B, bow, H) # apex up, then turned to point at −Z
	PieceKit.mesh(hull, prism, Transform3D(Basis(Vector3.RIGHT, -PI / 2), Vector3(0, H * 0.5, -L * 0.5 + bow * 0.5)), paint)
	# Deck, a stern cabin, a broken mast, and a hole stove in on the −X side.
	PieceKit.box(hull, Vector3(B - 0.4, 0.15, L - bow - 0.6), Vector3(0, H + 0.075, bow * 0.5), wood)
	PieceKit.box(hull, Vector3(B * 0.5, 1.6, 2.5), Vector3(0, H + 0.8, L * 0.5 - 2.0), wood)
	PieceKit.cylinder(hull, 0.16, 0.22, L * 0.25, Vector3(0, H + L * 0.125, -L * 0.1), wood)
	PieceKit.box(hull, Vector3(0.1, H * 0.4, L * 0.15), Vector3(-B * 0.5 - 0.02, H * 0.45, L * 0.1), dark)

	var b := PieceKit.body(hull)
	# The box behind the bow, and the bow's own wedge, so there's no
	# invisible wall either side of the point.
	PieceKit.box_shape(b, Vector3(B, H, L - bow), Vector3(0, H * 0.5, bow * 0.5))
	var root_z := -L * 0.5 + bow
	PieceKit.convex_shape(b, PackedVector3Array([
		Vector3(-B * 0.5, 0, root_z), Vector3(B * 0.5, 0, root_z), Vector3(0, 0, -L * 0.5),
		Vector3(-B * 0.5, H, root_z), Vector3(B * 0.5, H, root_z), Vector3(0, H, -L * 0.5)]))
	PieceKit.box_shape(b, Vector3(B * 0.5, 1.6, 2.5), Vector3(0, H + 0.8, L * 0.5 - 2.0))
	PieceKit.cylinder_shape(b, 0.22, L * 0.25, Vector3(0, H + L * 0.125, -L * 0.1))
	return root
