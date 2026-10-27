import { normalizeGuess } from "@games/words";
import { isWord } from "@games/words/dictionary";
import { describe, expect, it } from "vitest";
import { WORDS } from "../server/words.ts";
import { cleanDefinition, cleanFake, definitionShapeProblem, displayDefinition, fakeShapeProblem, nearSame } from "../shared/rules.ts";
import { bluffDefinitionsSettingFields, fakeWordSettingFields } from "../shared/rules-text.ts";

describe("words", () => {
  it("has 60+, none twice, every one in the dictionary, a–z, 3–18 letters", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(WORDS.map((e) => e.word)).size).toBe(WORDS.length);
    for (const { word } of WORDS) {
      expect(word, word).toMatch(/^[a-z]{3,18}$/);
      expect(isWord(word), word).toBe(true);
    }
  });

  it("has meanings of 15–180 characters, already in display form, that never name their word", () => {
    for (const { word, definition, notes } of WORDS) {
      expect(definition.length, word).toBeGreaterThanOrEqual(15);
      expect(definition.length, word).toBeLessThanOrEqual(180);
      expect(displayDefinition(definition), word).toBe(definition);
      expect(cleanDefinition(definition), word).toBe(definition);
      expect(normalizeGuess(definition).includes(word), word).toBe(false);
      expect(notes.length, word).toBeGreaterThan(10);
    }
  });

  it("has no two meanings close enough to be taken for each other", () => {
    for (let i = 0; i < WORDS.length; i++) {
      for (let j = i + 1; j < WORDS.length; j++) expect(nearSame(WORDS[i]!.definition, WORDS[j]!.definition), WORDS[i]!.word).toBe(false);
    }
  });
});

describe("fake words", () => {
  it("are trimmed and lowercased", () => {
    expect(cleanFake("  Glorp ")).toBe("glorp");
  });

  it("are 3–18 letters, a to z", () => {
    expect(fakeShapeProblem("")).toMatch(/Type/);
    expect(fakeShapeProblem("ab")).toMatch(/3/);
    expect(fakeShapeProblem("a".repeat(19))).toMatch(/18/);
    expect(fakeShapeProblem("glorp blat")).toMatch(/Letters/);
    expect(fakeShapeProblem("glörp")).toMatch(/Letters/);
    expect(fakeShapeProblem("www.x.com")).toMatch(/Letters/);
    expect(fakeShapeProblem("glorp")).toBeNull();
    expect(fakeShapeProblem("a".repeat(18))).toBeNull();
  });
});

describe("definitions", () => {
  it("are one line, 180 at most, 15 at least", () => {
    expect(cleanDefinition("  a small\n  dog ")).toBe("a small dog");
    expect(cleanDefinition("x".repeat(400))).toHaveLength(180);
    expect(definitionShapeProblem("")).toMatch(/Type/);
    expect(definitionShapeProblem("a small dog")).toMatch(/15/);
    expect(definitionShapeProblem("a small, angry dog")).toBeNull();
  });

  it("all look the same on the board: lowercase start, no full stop", () => {
    expect(displayDefinition("A small dog.")).toBe("a small dog");
    expect(displayDefinition("a small dog...  ")).toBe("a small dog");
    expect(displayDefinition("A small dog!")).toBe("a small dog!");
    expect(displayDefinition("NASA's dog")).toBe("nASA's dog");
  });

  it("near-identical ones are caught; different bluffs aren't", () => {
    const real = "a blind or shutter made of angled slats";
    expect(nearSame("A blind or shutter made of angled slats.", real)).toBe(true);
    expect(nearSame("a blind or shuter made of angled slats", real)).toBe(true);
    expect(nearSame("a blind or shutter made of angled planks", real)).toBe(true);
    expect(nearSame("a blind made of angled wooden slats", real)).toBe(false);
    expect(nearSame("a small, jealous dog from southern France", real)).toBe(false);
  });
});

describe("settings fields", () => {
  it("offer 3 or 5 rounds, with the current pick selected", () => {
    const [f] = fakeWordSettingFields({ rounds: 3 });
    expect(f!.options.map((o) => o.label)).toEqual(["3", "5"]);
    expect(f!.selected).toBe(0);
    expect(bluffDefinitionsSettingFields(null)[0]!.selected).toBe(1);
    expect(f!.hint).toMatch(/min/);
  });
});
