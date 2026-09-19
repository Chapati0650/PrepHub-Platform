export type ClubErrorCode = "NO_QUESTIONS" | "SLOT_NOT_FOUND" | "SESSION_NOT_FOUND" | "SESSION_COMPLETED" | "BLANKS_REMAIN";

export class ClubError extends Error {
  constructor(
    public readonly code: ClubErrorCode,
    message: string,
    public readonly details: Record<string, number> = {},
  ) {
    super(message);
    this.name = "ClubError";
  }
}
