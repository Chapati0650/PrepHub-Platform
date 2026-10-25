import { randomInt } from "node:crypto";

/**
 * Class join codes: what a teacher writes on the board and a student types.
 *
 * Six characters from an alphabet with nothing that can be misread when
 * copied off a projector: no 0/O, no 1/I/L, no 5/S, no 2/Z, no 8/B.
 * Twenty-five characters to the sixth is about 244 million codes, so a
 * collision on the unique index is rare enough that a few retries cover it,
 * and guessing a live code is impractical — and a guessed code only ever
 * puts someone on a class roster its teacher can see and undo.
 */
export const JOIN_CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";
export const JOIN_CODE_LENGTH = 6;

/** Testable with an injected source; crypto-random by default. */
export function generateJoinCode(randomIndex: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) code += JOIN_CODE_ALPHABET[randomIndex(JOIN_CODE_ALPHABET.length)];
  return code;
}

/**
 * What a student typed, as a code: case, spaces and the dash we display don't
 * matter. Null for anything that can't be a code, so it fails before a query.
 */
export function normalizeJoinCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of code) if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** "ACD-EFG": easier to read aloud to a class. Display only. */
export function formatJoinCode(code: string): string {
  return code.length === JOIN_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}
