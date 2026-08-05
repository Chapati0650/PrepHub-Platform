export class AdminError extends Error {
  constructor(
    public code: "MEMBERSHIP_NOT_FOUND" | "ANNOUNCEMENT_NOT_FOUND" | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}
