class_name DetailNoise
extends RefCounted
## One small tiling noise texture, made once at load and shared by the ground,
## road and weather shaders. Procedural, so the export ships no image, and
## seeded with a constant: the ground looks the same for everyone. (Weather
## varies by scrolling and thresholding it, not by regenerating it.)

const SIZE := 256

static var _tex: ImageTexture


static func texture() -> ImageTexture:
	if _tex:
		return _tex
	var n := FastNoiseLite.new()
	n.seed = 7
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	n.frequency = 0.02
	n.fractal_type = FastNoiseLite.FRACTAL_FBM
	n.fractal_octaves = 3
	# Seamless, so world-space UVs can tile it forever. R and G are two
	# unrelated fields, B a finer one: three lookups' worth in one fetch.
	var a := n.get_seamless_image(SIZE, SIZE)
	n.seed = 19
	var b := n.get_seamless_image(SIZE, SIZE)
	n.seed = 31
	n.frequency = 0.06
	n.fractal_octaves = 2
	var c := n.get_seamless_image(SIZE, SIZE)
	var img := Image.create_empty(SIZE, SIZE, false, Image.FORMAT_RGB8)
	for y in SIZE:
		for x in SIZE:
			img.set_pixel(x, y, Color(a.get_pixel(x, y).r, b.get_pixel(x, y).r, c.get_pixel(x, y).r))
	img.generate_mipmaps()
	_tex = ImageTexture.create_from_image(img)
	return _tex
