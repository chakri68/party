import type { GameClientApi } from "@games/ui";
import { createNavigatorView } from "../navigator/host.ts";
import type { RoleView } from "../role.ts";
import { LocalDrive } from "./drive.ts";

/** The Navigator's screen, driven from this device: no Driver, no network between your thumbs and the car. */
export function createRallySeat(api: GameClientApi): RoleView {
  return createNavigatorView(api, { addon: (bridge, a) => new LocalDrive(bridge, a) });
}
