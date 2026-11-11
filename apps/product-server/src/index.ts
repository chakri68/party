import { createFetch, RoomBase } from "@games/server/worker";
import { handleAuth, realDeps } from "./auth.ts";
import { PRODUCT_LIMITS, productGames } from "./catalog.ts";
import { maskProfanity } from "./filter.ts";
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
    // Admin routes (B5) slot in here.
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
} satisfies ExportedHandler<Env>;
