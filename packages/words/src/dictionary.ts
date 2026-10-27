// The word list. Server only: the packed list is ~220 KB, and no client or shared
// file may import this (test/guard.test.ts checks).

import { PACKED, WORD_COUNT } from "./packed.ts";

export { WORD_COUNT };

/** Undoes the front-coding in scripts/build-dictionary.mjs: a digit starts a word, that many letters come from the last one. */
export function unpack(packed: string): string[] {
  const words: string[] = [];
  let word = "";
  for (let i = 0; i < packed.length; ) {
    const keep = packed.charCodeAt(i++) - 48;
    let j = i;
    while (j < packed.length && packed.charCodeAt(j) > 57) j++;
    word = word.slice(0, keep) + packed.slice(i, j);
    words.push(word);
    i = j;
  }
  return words;
}

let words: readonly string[] | null = null;
let dictionary: Set<string> | null = null;

/** Sorted, unpacked on first use and kept for the life of the room's isolate. */
export function allWords(): readonly string[] {
  words ??= unpack(PACKED);
  return words;
}

/** Built on first use (a few ms) and kept for the life of the room's isolate. */
export function isWord(word: string): boolean {
  dictionary ??= new Set(allWords());
  return dictionary.has(word);
}
