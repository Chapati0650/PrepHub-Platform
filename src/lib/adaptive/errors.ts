export class AdaptiveError extends Error {
  constructor(
    public code:
      | "NO_ACTIVE_SET"
      | "SET_NOT_FOUND"
      | "SLOT_NOT_FOUND"
      | "ALREADY_FINALIZED"
      | "GENERATION_FAILED"
      | "DIAGNOSTIC_NOT_FOUND"
      | "DIAGNOSTIC_ALREADY_COMPLETED"
      | "DIAGNOSTIC_INCOMPLETE"
      | "ATTEMPT_NOT_FOUND"
      | "BLANKS_REMAIN",
    message: string,
  ) {
    super(message);
    this.name = "AdaptiveError";
  }
}
