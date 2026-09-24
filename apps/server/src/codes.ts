import { secureRandomInt } from "@games/game-core";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@games/protocol";

// The alphabet has vowels, so some codes would spell things. Four letters leaves
// only so many ways to be rude; this catches the ones people would actually read.
const BLOCKLIST = [
  "ANAL", "ANUS", "ARSE", "CLIT", "COCK", "COON", "CUNT", "DAMN", "DICK", "DYKE",
  "FAG", "FUCK", "FUK", "GOOK", "HELL", "JISM", "JIZZ", "KIKE", "KKK", "NAZI",
  "NIG", "PAKI", "PISS", "POOP", "PORN", "PUSS", "RAPE", "SEX", "SHAT", "SHIT",
  "SLUT", "SPIC", "TITS", "TWAT", "WANK",
];

export function isOffensive(code: string): boolean {
  return BLOCKLIST.some((word) => code.includes(word));
}

export function generateRoomCode(randomInt = secureRandomInt): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!isOffensive(code)) return code;
  }
}
