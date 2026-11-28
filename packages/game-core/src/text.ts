/** Small text helpers that games share. */

/** 1 → "1st", 3 → "3rd", 12 → "12th", 21 → "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
