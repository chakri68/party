// The letter clusters. Server only; the dictionary itself is @games/words/dictionary.

/**
 * What goes on the bomb. Each has at least 250 dictionary words containing it
 * (test/rules.test.ts checks), and the trivial ones (ES, ED, ER, IN) stay off:
 * a plural shouldn't be a free pass.
 */
export const CLUSTERS: readonly string[] = [
  // two letters
  "tr", "ou", "ch", "sh", "th", "ea", "ai", "oo", "ee", "ck", "pr", "pl", "gr", "br", "cr", "bl", "cl",
  "fl", "sl", "sp", "sc", "ph", "qu", "wh", "ow", "oa", "ue", "ui", "ab", "ac", "ad", "ag", "am", "ap",
  "av", "ex", "id", "im", "ip", "ol", "om", "op", "os", "ot", "ub", "uc", "ud", "ul", "um", "un", "ur",
  "ut", "aw", "ew", "ay", "ey", "ll", "ss", "tt", "nd", "nt", "ze", "ki", "ga", "wa", "fo",
  // three
  "ing", "ent", "ion", "ter", "ate", "ous", "est", "ble", "ght", "con", "com", "pro", "per", "ver",
  "ine", "ive", "ist", "ize", "ish", "ity", "ful", "ack", "ail", "and", "ang", "ant", "art", "ash",
  "ick", "ide", "ill", "int", "ock", "one", "ore", "ort", "ust", "ace", "age", "ake", "ame", "ead",
  "eat", "ell", "end", "ess", "ice", "ite", "ose", "ove", "ure", "ade", "ise", "que", "ard", "ave",
  "are", "ile", "mis", "dis", "pre", "sub", "sur",
];

/** The minimum CLUSTERS promises. */
export const MIN_MATCHES = 250;
