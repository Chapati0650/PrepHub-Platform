export type RushErrorCode =
  | "NO_QUESTIONS"
  | "CHALLENGE_NOT_FOUND"
  | "NOT_JOINABLE"
  | "RUN_NOT_FOUND"
  | "RUN_COMPLETED"
  | "NOT_SERVED";

/**
 * What the 1v1 Rush hub says when starting or joining a rush sends a student
 * back to it. The hub is handed only a key (`/rush?error=room-full`), never a
 * sentence: it used to print `?error=` verbatim, so a crafted link could put
 * any text on a real PrepHub page. An unknown key shows nothing.
 */
export const RUSH_HUB_ERRORS = {
  "no-questions": "There aren't enough questions for that rush yet. Try the other section, or check back soon.",
  "bad-code": "A code is six letters and numbers, like ABC234.",
  "no-such-code": "No challenge has that code. Check it and try again.",
  "not-found": "That rush doesn't exist any more.",
  "room-gone": "That room doesn't exist any more.",
  "not-joinable": "That rush isn't open to join.",
  "for-someone-else": "That rematch is for someone else.",
  "already-started": "That rush has already started.",
  "host-away": "Nobody's in that room right now. Ask them to open it again, then try the link.",
  "room-full": "Someone else just joined that room.",
  "already-rematched": "That rush has already been rematched.",
  "no-opponent": "There's nobody to rematch in that rush.",
  "rematch-closed": "That rematch isn't open to you.",
  finished: "That rush is already finished.",
} as const;

export type RushHubErrorKey = keyof typeof RUSH_HUB_ERRORS;

// For the throw sites that never reach the hub, or reach it with nothing more
// specific to say.
const HUB_ERROR_FOR_CODE: Record<RushErrorCode, RushHubErrorKey> = {
  NO_QUESTIONS: "no-questions",
  CHALLENGE_NOT_FOUND: "not-found",
  NOT_JOINABLE: "not-joinable",
  RUN_NOT_FOUND: "not-found",
  RUN_COMPLETED: "finished",
  NOT_SERVED: "not-found",
};

export class RushError extends Error {
  constructor(
    public readonly code: RushErrorCode,
    message: string,
    public readonly hubKey: RushHubErrorKey = HUB_ERROR_FOR_CODE[code],
  ) {
    super(message);
    this.name = "RushError";
  }
}

/** A RushError whose message is the hub's own copy for `key`, so the two can't drift. */
export function rushError(code: RushErrorCode, key: RushHubErrorKey): RushError {
  return new RushError(code, RUSH_HUB_ERRORS[key], key);
}

/** The fixed sentence for a `?error=` key, or null for anything else. */
export function rushHubErrorMessage(key: string | undefined): string | null {
  if (!key || !Object.prototype.hasOwnProperty.call(RUSH_HUB_ERRORS, key)) return null;
  return RUSH_HUB_ERRORS[key as RushHubErrorKey];
}

/**
 * What a runner's server action returns, instead of throwing, for a RushError
 * the student should be told about. A thrown message never reaches the
 * browser in production (Next replaces it with a generic one), so the runners
 * could only ever print "something went wrong"; a returned kind reaches them
 * intact and each maps to fixed copy there. Unexpected errors still throw.
 *
 *   GONE         the run or room isn't this student's, or no longer exists
 *   FINISHED     the rush was completed (another tab, or the last answer landed)
 *   OUT_OF_STEP  an answer for a question this device hadn't been served yet
 */
export type RushProblem = { problem: "GONE" | "FINISHED" | "OUT_OF_STEP" };

export function rushProblem(err: RushError): RushProblem {
  if (err.code === "RUN_COMPLETED") return { problem: "FINISHED" };
  if (err.code === "NOT_SERVED") return { problem: "OUT_OF_STEP" };
  return { problem: "GONE" };
}

export function isRushProblem(value: unknown): value is RushProblem {
  return typeof value === "object" && value !== null && "problem" in value;
}
