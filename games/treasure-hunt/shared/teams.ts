// Team colours (§8). A copy of Blind Rally's table, not an import: games never
// import each other. Same keys, same order, so a player's colour means the
// same thing in both.

export type TeamColorKey = "orange" | "sky" | "green" | "purple" | "yellow" | "blue" | "red" | "white";

export interface TeamColor {
  key: TeamColorKey;
  name: string;
  hex: string;
  /** Never colour alone: every team also has a shape. */
  shape: "circle" | "square" | "triangle" | "diamond" | "pentagon" | "hexagon" | "star" | "cross";
}

/**
 * Okabe–Ito picks: they stay apart under the common colour blindnesses, and on
 * black. Its black is left out and an off-white takes the eighth place. The
 * order matters, so only ever append.
 */
export const TEAM_COLORS: readonly TeamColor[] = [
  { key: "orange", name: "Orange", hex: "#e69f00", shape: "circle" },
  { key: "sky", name: "Sky", hex: "#56b4e9", shape: "square" },
  { key: "green", name: "Green", hex: "#009e73", shape: "triangle" },
  { key: "purple", name: "Purple", hex: "#cc79a7", shape: "diamond" },
  { key: "yellow", name: "Yellow", hex: "#f0e442", shape: "pentagon" },
  { key: "blue", name: "Blue", hex: "#0072b2", shape: "hexagon" },
  { key: "red", name: "Red", hex: "#d55e00", shape: "star" },
  { key: "white", name: "White", hex: "#e8e6e1", shape: "cross" },
];

export const teamColor = (key: TeamColorKey): TeamColor => TEAM_COLORS.find((c) => c.key === key) ?? TEAM_COLORS[0]!;

export const isTeamColorKey = (v: unknown): v is TeamColorKey => TEAM_COLORS.some((c) => c.key === v);
