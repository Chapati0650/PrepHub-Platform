import { getChallengePreview } from "./runs";

/** Why a guest can't take a guest room's seat right now (src/lib/rush/guest-rooms.ts), or null when they can. */
export async function guestRoomProblem(code: string): Promise<{ hostName: string; questionCount: number; problem: string | null }> {
  const preview = await getChallengePreview("", code);
  if (!preview || !preview.live || preview.mode !== "FRIEND") return { hostName: "", questionCount: 0, problem: "That link doesn't match a live room." };
  const room = { hostName: preview.creatorName, questionCount: preview.questionCount };
  if (preview.liveStatus !== "WAITING" || preview.participants >= 2) {
    return { ...room, problem: "This match already has both players. Ask for a new link." };
  }
  if (!preview.creatorPresent) return { ...room, problem: `${room.hostName} isn't in the room right now. Ask them to open it, then try again.` };
  return { ...room, problem: null };
}
