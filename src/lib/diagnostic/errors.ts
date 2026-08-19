export class DiagnosticError extends Error {
  constructor(
    public code:
      | "SESSION_NOT_FOUND"
      | "ALREADY_COMPLETED"
      | "ATTEMPT_NOT_FOUND"
      | "ANSWER_REQUIRED"
      | "QUESTIONS_REMAIN",
    message: string,
  ) {
    super(message);
    this.name = "DiagnosticError";
  }
}
