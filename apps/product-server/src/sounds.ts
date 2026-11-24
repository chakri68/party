// CouchParty host sounds: a signed-in account's library is lib/<user id>/ in
// the SOUNDS bucket. Adding sounds needs Host Pass. A lapsed Pass keeps its
// sounds and can still list, play, rename and remove them.
import { indexKey, isLibraryId } from "@games/server/host-sounds";
import type { SoundOwner } from "@games/server/policy";
import { userWithTier } from "./auth.ts";
import type { ProductEnv } from "./env.ts";

/**
 * Whose sounds this request may see and change. Every page load asks (GET
 * /api/sounds), so it stays cheap: no cookie is no database trip, a Pass user
 * is one trip, and only a signed-in free user also costs one R2 head.
 */
export async function productSoundOwner(request: Request, env: ProductEnv, now: number): Promise<SoundOwner | null> {
  const user = await userWithTier(env.DB, request, now);
  if (!user) return null;
  if (user.tier === "pass") return { library: user.id, active: true };
  // Without a Pass, only someone who saved sounds before sees them.
  if (!env.SOUNDS || !(await env.SOUNDS.head(indexKey(user.id)))) return null;
  return { library: user.id, active: false };
}

/**
 * Delete every key under lib/<library>/: the index, every file, and files a lost
 * race left behind. It lists all pages first and deletes after, so a delete never
 * moves a list cursor. R2 deletes at most 1000 keys per call.
 */
export async function deleteLibrary(bucket: Pick<R2Bucket, "list" | "delete">, library: string): Promise<void> {
  // Never a prefix wider than one library ("" would be all of lib/).
  if (!isLibraryId(library)) return;
  const prefix = `lib/${library}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const o of page.objects) keys.push(o.key);
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
}
