// Six characters from an alphabet with no 0/O or 1/I, so a code read aloud
// or typed from a phone screen can't be misheard. 32^6 ≈ 1.07 billion —
// plenty for a table that will hold thousands of rows, and the create loop
// retries on the unique constraint anyway.
export const RUSH_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RUSH_CODE_LENGTH = 6;

export function generateRushCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < RUSH_CODE_LENGTH; i++) {
    out += RUSH_CODE_ALPHABET[Math.floor(random() * RUSH_CODE_ALPHABET.length)];
  }
  return out;
}

// What a student typed → what the table stores. Case-insensitive, and
// spaces/dashes are dropped so "abc-234" and "ABC 234" both find ABC234.
// Returns null when the result can't be a code at all, so the caller can
// say "that's not a code" instead of "no challenge found."
export function normalizeRushCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== RUSH_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!RUSH_CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}
