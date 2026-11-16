// Live Rush rooms a visitor can join without an account (Owner, 2026-11-16):
// the Quick duel set up for the Northwest ISD meeting, where the opponent
// opens the link on whatever device is in front of them. Everywhere else a
// friend's link sends a signed-out visitor to sign up (middleware.ts).
//
// A guest gets a throwaway student account (an example.com address nobody
// can reach, a random password nobody is told), named with the first name
// they type, and is put straight into the room. Rooms still take two
// players: the first person to open the link takes the seat.
//
// Edge-safe (no imports): middleware reads it. Remove a code once its demo
// is over.
const GUEST_ROOM_CODES: ReadonlySet<string> = new Set(["X9JJCY"]);

export function isGuestRoomCode(code: string | null | undefined): boolean {
  return !!code && GUEST_ROOM_CODES.has(code.toUpperCase());
}
