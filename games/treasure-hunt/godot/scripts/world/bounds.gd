class_name Bounds
extends StaticBody3D
## The invisible wall, 20 m into the edge ring (spec §4.4). By the time you
## touch it you've already climbed something you shouldn't have.

const THICK := 10.0
const TALL := 400.0
## Bottom of the walls: under the sea floor.
const FLOOR := -100.0


func _init() -> void:
	name = "Bounds"
	collision_layer = 1
	collision_mask = 0
	var half := float(TerrainField.WALL_HALF)
	var span := 2.0 * (half + THICK) # overlap at the corners
	var y := FLOOR + TALL * 0.5
	for side in 4:
		var box := BoxShape3D.new()
		var cs := CollisionShape3D.new()
		var out := half + THICK * 0.5
		match side:
			0: # north
				box.size = Vector3(span, TALL, THICK)
				cs.position = Vector3(0, y, -out)
			1: # east
				box.size = Vector3(THICK, TALL, span)
				cs.position = Vector3(out, y, 0)
			2: # south
				box.size = Vector3(span, TALL, THICK)
				cs.position = Vector3(0, y, out)
			_: # west
				box.size = Vector3(THICK, TALL, span)
				cs.position = Vector3(-out, y, 0)
		cs.name = ["North", "East", "South", "West"][side]
		cs.shape = box
		add_child(cs)
