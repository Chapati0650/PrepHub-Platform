export class OwnerError extends Error {
  constructor(
    public code:
      | "INVALID_INPUT"
      | "CONTRACT_NOT_STARTED"
      | "CONTRACT_EXPIRED"
      | "ORGANIZATION_NOT_FOUND"
      | "NOT_A_DISTRICT"
      | "EMAIL_TAKEN"
      | "ADMINISTRATOR_NOT_FOUND"
      | "MEMBERSHIP_NOT_FOUND"
      | "ALREADY_HAS_MEMBERSHIP"
      | "STUDENT_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "OwnerError";
  }
}
