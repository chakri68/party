// Rally's five car classes (rally-spec.md). This is the lobby's half: ids,
// names and the bars the grid screen draws. What each class does on the road
// lives in Godot's presets; keep the ids in step with it. VEHICLE_IDS stays
// on one line because a Godot test reads it.

export const VEHICLE_IDS = ["hatch", "4x4", "rwd", "truck", "tractor"] as const;
export type VehicleId = (typeof VEHICLE_IDS)[number];

/** Today's car. Blind Rally always drives it, and so does anyone who never chose. */
export const DEFAULT_VEHICLE: VehicleId = "hatch";

export const isVehicleId = (v: unknown): v is VehicleId => VEHICLE_IDS.includes(v as VehicleId);

type Bar = 1 | 2 | 3 | 4 | 5;

export interface VehicleInfo {
  name: string;
  blurb: string;
  /** 1 to 5, for the grid screen. Not physics: a rough guide to how the car feels. */
  bars: { speed: Bar; grip: Bar; offroad: Bar; weight: Bar };
}

export const VEHICLES: Record<VehicleId, VehicleInfo> = {
  hatch: { name: "Hatchback", blurb: "Good at everything. A safe first choice.", bars: { speed: 3, grip: 3, offroad: 3, weight: 2 } },
  "4x4": { name: "4x4", blurb: "Slow, but grips on every road. Mud and snow do not stop it.", bars: { speed: 2, grip: 5, offroad: 4, weight: 4 } },
  rwd: { name: "RWD Classic", blurb: "Fast, and the back slides a lot. Best on tarmac.", bars: { speed: 4, grip: 2, offroad: 2, weight: 2 } },
  truck: { name: "Rally Truck", blurb: "Very fast on straight roads. Brake early for turns.", bars: { speed: 5, grip: 2, offroad: 3, weight: 5 } },
  tractor: { name: "Tractor", blurb: "Very slow. But it can drive across fields.", bars: { speed: 1, grip: 4, offroad: 5, weight: 5 } },
};
