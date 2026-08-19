export class ContentError extends Error {
  constructor(
    public code:
      | "INVALID_INPUT"
      | "QUESTION_NOT_FOUND"
      | "FAMILY_NOT_FOUND"
      | "REVISION_NOT_FOUND"
      | "MEDIA_NOT_FOUND"
      | "MEDIA_NOT_READY"
      | "NOT_DRAFT"
      | "NOT_PUBLISHED"
      | "NOT_ARCHIVABLE"
      | "PREVIEW_REQUIRED"
      | "PUBLISH_VALIDATION_FAILED"
      | "FAMILY_INELIGIBLE_CATEGORY"
      | "FAMILY_FULL"
      | "FAMILY_INCOMPLETE"
      | "FAMILY_MISMATCH"
      | "ALREADY_IN_FAMILY"
      | "HAS_REFERENCES"
      | "UNSUPPORTED_FILE_TYPE"
      | "FILE_TOO_LARGE"
      | "MEDIA_PROCESSING_FAILED"
      | "TRANSCRIPTION_FAILED"
      | "EXPLANATION_GENERATION_FAILED"
      | "ANSWER_DETECTION_FAILED"
      | "CATEGORY_CLASSIFICATION_FAILED"
      | "DIFFICULTY_CLASSIFICATION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "ContentError";
  }
}
