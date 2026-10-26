export class TeacherError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "CODE_NOT_FOUND"
      | "CLASS_CLOSED"
      | "ASSIGNMENT_CLOSED"
      | "NOT_IN_CLASS"
      | "HAS_WORK"
      | "LIMIT"
      | "EMAIL_TAKEN"
      | "ALREADY_TEACHER"
      | "BLANKS_REMAIN",
    message: string,
    public details: { unanswered?: number; assignmentId?: string } = {},
  ) {
    super(message);
    this.name = "TeacherError";
  }
}
