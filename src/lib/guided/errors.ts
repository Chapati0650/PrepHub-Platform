export class GuidedError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "NOT_IN_CLASS"
      | "ENDED"
      | "NOT_NOW"
      | "NO_CONTENT"
      | "INVALID_INPUT"
      | "CLASS_CLOSED",
    message: string,
  ) {
    super(message);
    this.name = "GuidedError";
  }
}
