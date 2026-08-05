export class SchoolVerificationError extends Error {
  constructor(
    public code:
      | "SCHOOL_EMAIL_ALREADY_LINKED"
      | "ALREADY_HAS_MEMBERSHIP"
      | "DOMAIN_NOT_PARTNER"
      | "PARTNERSHIP_INACTIVE"
      | "INVALID_TOKEN"
      | "EXPIRED_TOKEN"
      | "ALREADY_COMPLETED"
      | "WRONG_ACCOUNT"
      | "NEEDS_SCHOOL_SELECTION",
    message: string,
  ) {
    super(message);
    this.name = "SchoolVerificationError";
  }
}
