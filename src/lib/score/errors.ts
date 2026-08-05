export class ScoreError extends Error {
  constructor(
    public code: "DIAGNOSTIC_INCOMPLETE" | "CATEGORY_STATE_MISSING" | "INVALID_ABILITY" | "SET_INCOMPLETE" | "PREDICTION_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ScoreError";
  }
}
