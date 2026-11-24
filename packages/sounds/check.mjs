// The rules for a sound board pack entry. Plain JS with no imports, so the
// server, the `pnpm sound` command and the tests all use the same checks.

export const SOUND_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SOUND_ID_MAX = 32;
export const MAX_SOUND_MS = 3000;
export const SOUND_NAME_MAX = 24;

const V_RE = /^[0-9a-f]{10}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export const HOST_PACK = "host";
export const HOST_SLOTS = 6;
export const HOST_SOUND_MAX_BYTES = 65536;

/** True for exactly "1" to "6". */
export function isHostSlot(v) {
  return typeof v === "string" && /^[1-6]$/.test(v);
}

/** The trimmed name, or null when it is not 1 to 24 characters without control characters. */
export function cleanSoundName(v) {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name.length < 1 || name.length > SOUND_NAME_MAX || CONTROL_RE.test(name) ? null : name;
}

/** A kebab-case id from a name. Returns "" when nothing is left. */
export function soundId(name) {
  const id = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id.slice(0, SOUND_ID_MAX).replace(/-+$/, "");
}

/** One plain line per problem. An empty list means the entries are good. */
export function checkEntries(entries, opts) {
  const { pack, fileExists } = opts;
  const problems = [];
  if (pack !== "free" && pack !== "memes") problems.push(`pack ${String(pack)}: the pack must be free or memes`);
  const seen = new Set();
  entries.forEach((entry, i) => {
    const e = entry && typeof entry === "object" ? entry : {};
    const id = typeof e.id === "string" && e.id !== "" ? e.id : null;
    const who = id ?? `entry ${i + 1}`;
    const bad = (text) => problems.push(`${who}: ${text}`);
    if (id === null) bad("needs an id");
    else {
      if (seen.has(id)) bad("the id is used twice");
      seen.add(id);
      if (!SOUND_ID_RE.test(id) || id.length > SOUND_ID_MAX) {
        bad(`the id must be lower case words joined by dashes, at most ${SOUND_ID_MAX} characters`);
      }
    }
    if (cleanSoundName(e.name) === null) {
      bad(`the name must be 1 to ${SOUND_NAME_MAX} characters, with no control characters`);
    }
    if (id !== null && e.file !== `${id}.mp3`) bad(`the file must be ${id}.mp3`);
    if (!Number.isInteger(e.ms) || e.ms < 1 || e.ms > MAX_SOUND_MS) {
      bad(`ms must be a whole number from 1 to ${MAX_SOUND_MS}`);
    }
    if (typeof e.source !== "string" || e.source.trim() === "") bad("needs a source");
    if (pack === "free" && (typeof e.licence !== "string" || e.licence.trim() === "")) bad("needs a licence");
    if (pack === "memes" && (typeof e.v !== "string" || !V_RE.test(e.v))) {
      bad("v must be 10 hex characters");
    }
    if (fileExists && typeof e.file === "string" && !fileExists(e.file)) bad(`the file ${e.file} is missing`);
  });
  return problems;
}
