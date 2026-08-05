export class DiagnosticError extends Error {
  constructor(
    public code:
      | "SESSION_NOT_FOUND"
      | "ALREADY_COMPLETED"
      | "GENERATION_FAILED"
      | "ATTEMPT_NOT_FOUND"
      | "ANSWER_REQUIRED"
      | "QUESTIONS_REMAIN",
    message: string,
  ) {
    super(message);
    this.name = "DiagnosticError";
  }
}
