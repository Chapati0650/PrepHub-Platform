export type RushErrorCode =
  | "NO_QUESTIONS"
  | "CHALLENGE_NOT_FOUND"
  | "NOT_JOINABLE"
  | "RUN_NOT_FOUND"
  | "RUN_COMPLETED"
  | "NOT_SERVED";

export class RushError extends Error {
  constructor(
    public readonly code: RushErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RushError";
  }
}
