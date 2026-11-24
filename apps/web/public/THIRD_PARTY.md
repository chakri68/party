# Third-party code

The "My sounds" screen uses an mp3 encoder to save your sounds. It is made of two parts.

## wasm-media-encoders 0.7.0

- Licence: MIT
- Copyright (c) 2020-2024 arseneyr
- Source: https://github.com/arseneyr/wasm-media-encoders
- Licence text: https://github.com/arseneyr/wasm-media-encoders/blob/HEAD/LICENSE

## LAME (built to WebAssembly inside wasm-media-encoders)

- Licence: GNU Lesser General Public License, version 2.0 (LGPL-2.0)
- Source: https://lame.sourceforge.io/ and https://sourceforge.net/projects/lame/files/lame/
- Licence text: https://www.gnu.org/licenses/old-licenses/lgpl-2.0.html

## Swapping the encoder

The encoder is its own file (`assets/encode-*.js`). The app loads it only on the My sounds screen. You can replace that file with your own build of the same code.
