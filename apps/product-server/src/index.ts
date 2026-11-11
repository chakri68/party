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
    if (new URL(request.url).pathname === "/play") {
      return env.ASSETS.fetch(new Request(new URL("/play.html", request.url), request));
    }
    return createFetch({
      policy: productPolicy(realRoomDeps),
      brand: "CouchParty",
      shellPath: "/play.html",
      onRoomCreated: recordRoom(env.DB),
    })(request, env);
  },
  // wrangler.jsonc "triggers.crons": hourly cleanup of old rows.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(prune(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;
