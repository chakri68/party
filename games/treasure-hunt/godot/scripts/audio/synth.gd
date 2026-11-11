class_name Synth
extends RefCounted
## Loop builders for HuntAudio. Pure and seeded: the same seed gives the same
## bytes. Every loop is a mono 16-bit AudioStreamWAV that repeats without a
## click, and the one-shots are the same format without the loop.
##
## Why pre-rendered and not AudioStreamGenerator: the web export plays through
## Web Audio samples, which can't run procedural streams. A loop costs nothing
## per frame; players only move pitch and volume.

const RATE := 22050


static func wav(samples: PackedFloat32Array, loop: bool) -> AudioStreamWAV:
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for i in samples.size():
		data.encode_s16(i * 2, int(clampf(samples[i], -1.0, 1.0) * 32000.0))
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = RATE
	w.stereo = false
	w.data = data
	if loop:
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = samples.size()
	return w


static func _rng(seed_: int) -> RandomNumberGenerator:
	var r := RandomNumberGenerator.new()
	r.seed = seed_
	return r


## Buzz at RATE / period Hz with `h` as the weights of the 1st, 2nd, 3rd, 4th
## and 6th harmonics. A whole number of cycles, so it repeats clean; pitch_scale
## does the revving.
static func engine(period: int, cycles: int, h: Array, grit: float, seed_: int) -> AudioStreamWAV:
	var r := _rng(seed_)
	var s := PackedFloat32Array()
	s.resize(period * cycles)
	var lp := 0.0
	for i in s.size():
		var ph := TAU * float(i % period) / period
		var cyc := i / period
		var lumpy := 1.0 + 0.12 * sin(TAU * cyc / cycles * 3.0)
		var x: float = h[0] * sin(ph) + h[1] * sin(2.0 * ph + 0.4) * lumpy + h[2] * sin(3.0 * ph + 1.1) + h[3] * sin(4.0 * ph) + h[4] * sin(6.0 * ph + 0.5)
		var pulse := pow(maxf(0.0, sin(2.0 * ph)), 6.0) * 0.35
		lp += 0.35 * ((x + pulse + r.randf_range(-1.0, 1.0) * grit) - lp)
		s[i] = lp * 0.55
	return wav(s, true)


## Noise loop. lowpass 0..1 smooths it (gravel rumble); band > 0 adds a
## resonant peak at that frequency. The tail is crossfaded into the head.
static func noise(seconds: float, lowpass: float, band: float, seed_: int) -> AudioStreamWAV:
	var r := _rng(seed_)
	var count := int(seconds * RATE)
	var s := PackedFloat32Array()
	s.resize(count)
	var lp := 0.0
	var y1 := 0.0
	var y2 := 0.0
	var w := TAU * band / RATE
	var rr := 0.985
	for i in count:
		var x := r.randf_range(-1.0, 1.0)
		if band == 0.0 and r.randf() < 0.004:
			x *= 4.0 # crunch: the odd louder grain
		lp += lowpass * (x - lp)
		var out := lp
		if band > 0.0:
			var y := lp + 2.0 * rr * cos(w) * y1 - rr * rr * y2
			y2 = y1
			y1 = y
			out = y * 0.05
		s[i] = out * 0.6
	return wav(_crossfade(s), true)


## Wind: low noise under a slow swell. 2 s, two swells.
static func wind(seed_: int) -> AudioStreamWAV:
	var r := _rng(seed_)
	var count := 2 * RATE
	var s := PackedFloat32Array()
	s.resize(count)
	var lp := 0.0
	var lp2 := 0.0
	for i in count:
		lp += 0.06 * (r.randf_range(-1.0, 1.0) - lp)
		lp2 += 0.2 * (lp - lp2)
		var swell := 0.65 + 0.35 * sin(TAU * 2.0 * i / count)
		s[i] = lp2 * swell * 3.0
	return wav(_crossfade(s), true)


## Birds: three short sine chirps (a rising sweep each) in 1.8 s of quiet.
static func birds(seed_: int) -> AudioStreamWAV:
	var r := _rng(seed_)
	var count := int(1.8 * RATE)
	var s := PackedFloat32Array()
	s.resize(count)
	for c in 3:
		var start := int((0.1 + 0.55 * c + r.randf_range(0.0, 0.1)) * RATE)
		var f0 := r.randf_range(2600.0, 3400.0)
		var up := r.randf_range(900.0, 1500.0)
		var len := int(0.14 * RATE)
		var ph := 0.0
		for i in len:
			var t := float(i) / len
			ph += TAU * (f0 + up * t) / RATE
			var env := sin(PI * t)
			if start + i < count:
				s[start + i] += sin(ph) * env * 0.35
	return wav(s, true)


## Crickets: a high sine gated in bursts of 3 pulses, 4 bursts a second. One
## second, a whole number of both, so it repeats clean.
static func crickets(seed_: int) -> AudioStreamWAV:
	var r := _rng(seed_)
	var count := RATE
	var s := PackedFloat32Array()
	s.resize(count)
	var f := 4400.0 + float(r.randi_range(0, 3)) * 50.0
	for i in count:
		var t := float(i) / RATE
		var burst := fmod(t * 4.0, 1.0)
		var gate := 0.0
		if burst < 0.45:
			gate = pow(maxf(0.0, sin(TAU * burst / 0.15)), 2.0)
		s[i] = sin(TAU * f * t) * gate * 0.3
	return wav(s, true)


## One footstep: a soft lowpassed noise burst, 0.09 s, with a quick decay.
static func step(seed_: int) -> AudioStreamWAV:
	var r := _rng(seed_)
	var count := int(0.09 * RATE)
	var s := PackedFloat32Array()
	s.resize(count)
	var lp := 0.0
	for i in count:
		var t := float(i) / RATE
		lp += 0.3 * (r.randf_range(-1.0, 1.0) - lp)
		s[i] = lp * exp(-t * 45.0) * minf(1.0, t * 800.0) * 1.6
	return wav(s, false)


## One-shot: sine notes back to back, `note` seconds each, the last one ringing
## on for `tail` more. Each note has a 5 ms attack and decays to nothing, so
## nothing clicks.
static func notes(freqs: Array, note: float, tail: float) -> AudioStreamWAV:
	var per := int(note * RATE)
	var ring := int(tail * RATE)
	var s := PackedFloat32Array()
	s.resize(per * freqs.size() + ring)
	for n in freqs.size():
		var len_ := per + (ring if n == freqs.size() - 1 else 0)
		for i in len_:
			var t := float(i) / RATE
			var env := minf(1.0, t / 0.005) * exp(-t * 14.0 / maxf(note + (tail if n == freqs.size() - 1 else 0.0), 0.01) * 2.0)
			s[n * per + i] += sin(TAU * float(freqs[n]) * t) * env * 0.6
	return wav(s, false)


static func _crossfade(s: PackedFloat32Array) -> PackedFloat32Array:
	var count := s.size()
	var fade := int(0.05 * RATE)
	for i in fade:
		var t := float(i) / fade
		s[i] = s[i] * t + s[count - fade + i] * (1.0 - t)
	s.resize(count - fade)
	return s
