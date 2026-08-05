export class AuthError extends Error {
  constructor(
    public code: "EMAIL_TAKEN" | "INVALID_CREDENTIALS" | "INVALID_TOKEN" | "TOKEN_EXPIRED",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
