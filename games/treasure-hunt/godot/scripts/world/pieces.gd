class_name Pieces
extends Node3D
## The layout's set pieces, one child each, named by id. Built once per
## world; about 14 of them, so no time-slicing.

## Past this the pieces fade out. The far terrain still draws the hills.
const RANGE_END := 1100.0


func build_all(layout: Dictionary) -> void:
	clear()
	for p: Dictionary in layout.get("pieces", []):
		var node := PieceKit.build(p)
		if node == null:
			continue
		for g: GeometryInstance3D in node.find_children("*", "GeometryInstance3D", true, false):
			g.visibility_range_end = RANGE_END
		add_child(node)


## Out of the tree now, so a rebuild straight after can reuse the names.
func clear() -> void:
	for c in get_children():
		remove_child(c)
		c.queue_free()


## Lamps on or off: every Lamp<i> light in the pieces, and the glowing
## materials. Pieces built later start in whichever state this left.
func set_lamps(on: bool) -> void:
	PieceKit.set_lamps_on(on)
	for l: Node in find_children("Lamp*", "OmniLight3D", true, false):
		(l as OmniLight3D).visible = on
