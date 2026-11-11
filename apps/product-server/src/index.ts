import { createFetch, RoomBase } from "@games/server/worker";
import { handleAdmin } from "./admin.ts";
import { handleAuth, realDeps } from "./auth.ts";
import { PRODUCT_LIMITS, productGames } from "./catalog.ts";
import { handleConfig } from "./config.ts";
import { maskProfanity } from "./filter.ts";
import { prune } from "./prune.ts";
import { handleUpgrade, productPolicy, realRoomDeps, realUpgradeDeps, recordRoom } from "./rooms.ts";

export class Room extends RoomBase {
  protected override games() {
    const env = this.env as unknown as Env;
    return productGames({ blindRally: env.BLIND_RALLY === "1", treasureHunt: env.TREASURE_HUNT === "1" });
  }
  protected override tierLimits() {
    return PRODUCT_LIMITS;
  }
  protected override filterText() {
    return maskProfanity;
  }
}

export default {
  async fetch(request, env) {
    const auth = await handleAuth(request, env, realDeps(env));
    if (auth) return auth;
    const config = handleConfig(request, env);
    if (config) return config;
    const admin = await handleAdmin(request, env);
    if (admin) return admin;
    const upgrade = await handleUpgrade(request, env, realUpgradeDeps);
    if (upgrade) return upgrade;
    return createFetch({
      policy: productPolicy(realRoomDeps),
      brand: "CouchParty",
      // Not "/play.html": assets answer that with a 307 to /play (html_handling).
      shellPath: "/play",
      onRoomCreated: recordRoom(env.DB, env.IP_HASH_KEY),
    })(request, env);
  },
  // wrangler.jsonc "triggers.crons": hourly cleanup of old rows.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(prune(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
