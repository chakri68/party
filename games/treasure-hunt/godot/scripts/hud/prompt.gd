class_name PickupPrompt
extends Label
## "Press E to pick up", low in the middle, while a cache is in reach and
## you're on foot. main decides when; this is just how it looks.

const TEXT := "Press E to pick up"


func _init() -> void:
	text = TEXT
	visible = false
	mouse_filter = MOUSE_FILTER_IGNORE
	horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var ls := LabelSettings.new()
	ls.font_size = 20
	ls.outline_size = 6
	ls.outline_color = Color(0, 0, 0, 0.85)
	label_settings = ls
	set_anchors_preset(PRESET_CENTER_BOTTOM)
	offset_left = -160.0
	offset_right = 160.0
	offset_top = -120.0
	offset_bottom = -90.0
