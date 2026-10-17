export type FocusedErrorCode =
  | "NO_QUESTIONS"
  | "SLOT_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_COMPLETED"
  | "BLANKS_REMAIN";

export class FocusedError extends Error {
  constructor(
    public readonly code: FocusedErrorCode,
    message: string,
    public readonly details: Record<string, number> = {},
  ) {
    super(message);
    this.name = "FocusedError";
  }
}
