import { beforeEach, describe, expect, it, vi } from "vitest";
import { processBulkUploadImage, processBulkUploadPdfPage } from "./bulk-upload";
import { createQuestion, findQuestionIdByExactText, findQuestionIdsByImageHash, updateDraftContent } from "./questions";
import { transcribeQuestionImage, transcribeQuestionPage } from "./transcribe";
import { determineCorrectAnswer } from "./determine-answer";
import { classifyQuestionCategory } from "./classify-category";
import { classifyQuestionDifficulty } from "./classify-difficulty";
import { generateExplanationText, generateDistractorExplanations } from "./generate-explanation";
import { DEFAULT_BULK_UPLOAD_DIFFICULTY } from "./constants";

vi.mock("./questions", () => ({
  createQuestion: vi.fn(),
  updateDraftContent: vi.fn(),
  findQuestionIdsByImageHash: vi.fn(),
  findQuestionIdByExactText: vi.fn(),
}));
vi.mock("./transcribe", () => ({ transcribeQuestionImage: vi.fn(), transcribeQuestionPage: vi.fn() }));
vi.mock("./determine-answer", () => ({ determineCorrectAnswer: vi.fn() }));
vi.mock("./classify-category", () => ({ classifyQuestionCategory: vi.fn() }));
vi.mock("./classify-difficulty", () => ({ classifyQuestionDifficulty: vi.fn() }));
vi.mock("./generate-explanation", () => ({
  generateExplanationText: vi.fn(),
  generateDistractorExplanations: vi.fn(),
}));

const mockedCreateQuestion = createQuestion as ReturnType<typeof vi.fn>;
const mockedUpdateDraftContent = updateDraftContent as ReturnType<typeof vi.fn>;
const mockedFindByHash = findQuestionIdsByImageHash as ReturnType<typeof vi.fn>;
const mockedFindByText = findQuestionIdByExactText as ReturnType<typeof vi.fn>;
const mockedTranscribe = transcribeQuestionImage as ReturnType<typeof vi.fn>;
const mockedTranscribePage = transcribeQuestionPage as ReturnType<typeof vi.fn>;
const mockedDetermineAnswer = determineCorrectAnswer as ReturnType<typeof vi.fn>;
const mockedClassifyCategory = classifyQuestionCategory as ReturnType<typeof vi.fn>;
const mockedClassifyDifficulty = classifyQuestionDifficulty as ReturnType<typeof vi.fn>;
const mockedGenerateExplanation = generateExplanationText as ReturnType<typeof vi.fn>;
const mockedGenerateDistractors = generateDistractorExplanations as ReturnType<typeof vi.fn>;

const baseInput = {
  buffer: Buffer.from("fake-image"),
  mimeType: "image/png",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedFindByHash.mockResolvedValue([]); // no existing duplicate by default
  mockedFindByText.mockResolvedValue(null); // no existing duplicate by default
  mockedCreateQuestion.mockResolvedValue({ id: "q1" });
  mockedUpdateDraftContent.mockResolvedValue({ id: "q1" });
  mockedTranscribe.mockResolvedValue({
    questionText: "What is 2 + 2?",
    answerChoices: ["3", "4", "5", "6"],
    questionImageId: null,
  });
  mockedClassifyCategory.mockResolvedValue("ALGEBRA");
  mockedClassifyDifficulty.mockResolvedValue({ difficulty: "MEDIUM", reasoning: "Single-step arithmetic." });
  mockedDetermineAnswer.mockResolvedValue({
    correctChoiceIndex: 1,
    acceptedAnswers: [],
    confidence: "high",
    reasoning: "2 + 2 = 4.",
  });
  mockedGenerateExplanation.mockResolvedValue([{ text: "Add 2 and 2 to get 4." }]);
  mockedGenerateDistractors.mockResolvedValue([
    { choiceIndex: 0, explanation: "You may have subtracted instead of adding." },
    { choiceIndex: 2, explanation: "This doesn't match any step of the correct method." },
    { choiceIndex: 3, explanation: "This is off by a common miscount." },
  ]);
});

describe("processBulkUploadImage — multiple choice (detected from 4 answer choices)", () => {
  it("runs the full pipeline and returns the created questionId", async () => {
    const result = await processBulkUploadImage(baseInput);
    expect(result).toEqual({ questionId: "q1" });
  });

  it("creates the question with the detected MULTIPLE_CHOICE type, classified category, and classified difficulty", async () => {
    mockedClassifyDifficulty.mockResolvedValue({ difficulty: "HARD", reasoning: "Multi-step." });
    await processBulkUploadImage(baseInput);
    expect(mockedCreateQuestion).toHaveBeenCalledWith({
      questionType: "MULTIPLE_CHOICE",
      category: "ALGEBRA",
      difficulty: "HARD",
      sourceImageHash: expect.any(String),
    });
  });

  it("classifies category from the transcribed question text and choices", async () => {
    await processBulkUploadImage(baseInput);
    expect(mockedClassifyCategory).toHaveBeenCalledWith({
      questionText: "What is 2 + 2?",
      answerChoices: ["3", "4", "5", "6"],
    });
  });

  it("uses whatever category classification returns, not a hardcoded default", async () => {
    mockedClassifyCategory.mockResolvedValue("GEOMETRY_TRIGONOMETRY");
    await processBulkUploadImage(baseInput);
    expect(mockedCreateQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ category: "GEOMETRY_TRIGONOMETRY" }),
    );
    expect(mockedDetermineAnswer).toHaveBeenCalledWith(expect.objectContaining({ category: "GEOMETRY_TRIGONOMETRY" }));
    expect(mockedGenerateExplanation).toHaveBeenCalledWith(expect.objectContaining({ category: "GEOMETRY_TRIGONOMETRY" }));
  });

  it("never creates a question if category classification fails", async () => {
    mockedClassifyCategory.mockRejectedValue(new Error("classification unavailable"));
    const result = await processBulkUploadImage(baseInput);
    expect(result).toEqual({ error: "classification unavailable" });
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
  });

  it("falls back to the flat default difficulty, without failing the question, when difficulty classification fails", async () => {
    mockedClassifyDifficulty.mockRejectedValue(new Error("difficulty classification unavailable"));
    const result = await processBulkUploadImage(baseInput);
    expect(result).toEqual({ questionId: "q1" });
    expect(mockedCreateQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty: DEFAULT_BULK_UPLOAD_DIFFICULTY }),
    );
  });

  it("includes the difficulty reasoning alongside the answer reasoning shown for Owner review", async () => {
    mockedClassifyDifficulty.mockResolvedValue({ difficulty: "HARD", reasoning: "Requires a hidden substitution." });
    await processBulkUploadImage(baseInput);
    const updateCalls = mockedUpdateDraftContent.mock.calls;
    const answerUpdateCall = updateCalls.find((call) => call[1].aiAnswerReasoning !== undefined);
    expect(answerUpdateCall?.[1].aiAnswerReasoning).toContain("Requires a hidden substitution.");
  });

  it("marks the content-fill patch as aiGenerated with the reasoning attached", async () => {
    await processBulkUploadImage(baseInput);
    const contentCall = mockedUpdateDraftContent.mock.calls[0];
    expect(contentCall[0]).toBe("q1");
    expect(contentCall[1]).toMatchObject({
      questionText: "What is 2 + 2?",
      aiGenerated: true,
      answerChoices: [
        { text: "3", imageId: null, isCorrect: false },
        { text: "4", imageId: null, isCorrect: true },
        { text: "5", imageId: null, isCorrect: false },
        { text: "6", imageId: null, isCorrect: false },
      ],
    });
    expect(contentCall[1].aiAnswerReasoning).toContain("2 + 2 = 4.");
  });

  it("writes the explanation steps in a second patch", async () => {
    await processBulkUploadImage(baseInput);
    const explanationCall = mockedUpdateDraftContent.mock.calls[1];
    expect(explanationCall[1]).toEqual({ explanationSteps: [{ text: "Add 2 and 2 to get 4.", imageId: null }] });
  });

  it("returns an error, not a throw, when transcription finds an unusable number of choices", async () => {
    mockedTranscribe.mockResolvedValue({ questionText: "...", answerChoices: ["only one"], questionImageId: null });
    const result = await processBulkUploadImage(baseInput);
    expect(result).toHaveProperty("error");
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
    expect(mockedDetermineAnswer).not.toHaveBeenCalled();
  });

  it("returns an error when answer detection can't determine a choice", async () => {
    mockedDetermineAnswer.mockResolvedValue({ correctChoiceIndex: null, acceptedAnswers: [], confidence: "low", reasoning: "unsure" });
    const result = await processBulkUploadImage(baseInput);
    expect(result).toHaveProperty("error");
    expect(mockedGenerateExplanation).not.toHaveBeenCalled();
  });

  it("returns an error instead of throwing when a downstream call rejects", async () => {
    mockedGenerateExplanation.mockRejectedValue(new Error("API down"));
    const result = await processBulkUploadImage(baseInput);
    expect(result).toEqual({ error: "API down" });
  });

  it("does not attempt answer detection if question creation itself fails (transcription already ran)", async () => {
    mockedCreateQuestion.mockRejectedValue(new Error("db unavailable"));
    const result = await processBulkUploadImage(baseInput);
    expect(result).toEqual({ error: "db unavailable" });
    expect(mockedTranscribe).toHaveBeenCalled();
    expect(mockedDetermineAnswer).not.toHaveBeenCalled();
  });

  it("returns an error, not a throw, when transcription itself rejects", async () => {
    mockedTranscribe.mockRejectedValue(new Error("network blip"));
    const result = await processBulkUploadImage(baseInput);
    expect(result).toEqual({ error: "network blip" });
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
  });

  it("generates distractor explanations using the just-generated correct steps as context", async () => {
    await processBulkUploadImage(baseInput);
    expect(mockedGenerateDistractors).toHaveBeenCalledWith({
      questionText: "What is 2 + 2?",
      category: "ALGEBRA",
      answerChoices: ["3", "4", "5", "6"],
      correctChoiceIndex: 1,
      correctExplanationSteps: ["Add 2 and 2 to get 4."],
    });
  });

  it("saves distractor explanations in a third patch, keyed to the right choice, correct choice untouched", async () => {
    await processBulkUploadImage(baseInput);
    const distractorCall = mockedUpdateDraftContent.mock.calls[2];
    expect(distractorCall[0]).toBe("q1");
    expect(distractorCall[1]).toEqual({
      answerChoices: [
        { text: "3", imageId: null, isCorrect: false, distractorExplanation: "You may have subtracted instead of adding." },
        { text: "4", imageId: null, isCorrect: true, distractorExplanation: null },
        { text: "5", imageId: null, isCorrect: false, distractorExplanation: "This doesn't match any step of the correct method." },
        { text: "6", imageId: null, isCorrect: false, distractorExplanation: "This is off by a common miscount." },
      ],
    });
  });

  it("still returns success when distractor generation fails — best-effort, not blocking", async () => {
    mockedGenerateDistractors.mockRejectedValue(new Error("API down"));
    const result = await processBulkUploadImage(baseInput);
    expect(result).toEqual({ questionId: "q1" });
  });
});

describe("processBulkUploadImage — open-ended numeric (detected from null answer choices)", () => {
  beforeEach(() => {
    mockedTranscribe.mockResolvedValue({ questionText: "What is 1/2 as a decimal?", answerChoices: null, questionImageId: null });
    mockedDetermineAnswer.mockResolvedValue({ correctChoiceIndex: null, acceptedAnswers: ["0.5", ".5"], confidence: "high", reasoning: "1/2 = 0.5" });
  });

  it("creates the question with the detected OPEN_ENDED_NUMERIC type", async () => {
    await processBulkUploadImage(baseInput);
    expect(mockedCreateQuestion).toHaveBeenCalledWith({
      questionType: "OPEN_ENDED_NUMERIC",
      category: "ALGEBRA",
      difficulty: DEFAULT_BULK_UPLOAD_DIFFICULTY,
      sourceImageHash: expect.any(String),
    });
  });

  it("fills acceptedAnswers instead of answerChoices", async () => {
    await processBulkUploadImage(baseInput);
    const contentCall = mockedUpdateDraftContent.mock.calls[0];
    expect(contentCall[1]).toMatchObject({ acceptedAnswers: ["0.5", ".5"] });
    expect(contentCall[1].answerChoices).toBeUndefined();
  });

  it("returns an error when answer detection finds no accepted answers", async () => {
    mockedDetermineAnswer.mockResolvedValue({ correctChoiceIndex: null, acceptedAnswers: [], confidence: "low", reasoning: "unsure" });
    const result = await processBulkUploadImage(baseInput);
    expect(result).toHaveProperty("error");
  });

  it("never attempts distractor generation — no answer choices to explain", async () => {
    await processBulkUploadImage(baseInput);
    expect(mockedGenerateDistractors).not.toHaveBeenCalled();
  });
});

describe("processBulkUploadImage — mixed batch (one call each, same category/difficulty)", () => {
  it("detects each image's type independently within the same batch", async () => {
    mockedTranscribe.mockResolvedValueOnce({
      questionText: "MC question",
      answerChoices: ["a", "b", "c", "d"],
      questionImageId: null,
    });
    await processBulkUploadImage(baseInput);
    expect(mockedCreateQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ questionType: "MULTIPLE_CHOICE" }),
    );

    mockedTranscribe.mockResolvedValueOnce({
      questionText: "Open-ended question",
      answerChoices: null,
      questionImageId: null,
    });
    mockedDetermineAnswer.mockResolvedValueOnce({
      correctChoiceIndex: null,
      acceptedAnswers: ["7"],
      confidence: "high",
      reasoning: "...",
    });
    await processBulkUploadImage(baseInput);
    expect(mockedCreateQuestion).toHaveBeenLastCalledWith(
      expect.objectContaining({ questionType: "OPEN_ENDED_NUMERIC" }),
    );
  });
});

describe("duplicate detection — processBulkUploadImage", () => {
  // Regression coverage for a real incident: a (since-fixed) false "Failed"
  // status led to the same file being re-uploaded repeatedly, producing 125
  // duplicate questions. The fix checks for an existing question with the
  // same source-image hash *before* spending any AI call.
  it("skips reprocessing and returns the existing question when this exact image was already uploaded", async () => {
    mockedFindByHash.mockResolvedValue(["existing-q1"]);

    const result = await processBulkUploadImage(baseInput);

    expect(result).toEqual({ questionId: "existing-q1", skipped: true });
    expect(mockedTranscribe).not.toHaveBeenCalled();
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
    expect(mockedClassifyCategory).not.toHaveBeenCalled();
  });

  it("proceeds normally, tagging the new question with the image's hash, when no match is found", async () => {
    mockedFindByHash.mockResolvedValue([]);

    await processBulkUploadImage(baseInput);

    expect(mockedTranscribe).toHaveBeenCalled();
    expect(mockedCreateQuestion).toHaveBeenCalledWith(expect.objectContaining({ sourceImageHash: expect.any(String) }));
  });

  it("hashes identical bytes identically, regardless of how the buffer object was constructed", async () => {
    await processBulkUploadImage({ buffer: Buffer.from("fake-image"), mimeType: "image/png" });
    const firstHash = mockedFindByHash.mock.calls[0][0];

    vi.clearAllMocks();
    mockedFindByHash.mockResolvedValue([]);
    mockedCreateQuestion.mockResolvedValue({ id: "q1" });
    mockedUpdateDraftContent.mockResolvedValue({ id: "q1" });
    mockedTranscribe.mockResolvedValue({ questionText: "x", answerChoices: ["3", "4", "5", "6"], questionImageId: null });
    mockedClassifyCategory.mockResolvedValue("ALGEBRA");
    mockedDetermineAnswer.mockResolvedValue({ correctChoiceIndex: 1, acceptedAnswers: [], confidence: "high", reasoning: "" });
    mockedGenerateExplanation.mockResolvedValue([{ text: "step" }]);

    await processBulkUploadImage({ buffer: Buffer.from("fake-image"), mimeType: "image/png" });
    const secondHash = mockedFindByHash.mock.calls[0][0];

    expect(secondHash).toBe(firstHash);
  });

  it("hashes different bytes differently", async () => {
    await processBulkUploadImage({ buffer: Buffer.from("fake-image"), mimeType: "image/png" });
    const firstHash = mockedFindByHash.mock.calls[0][0];

    vi.clearAllMocks();
    mockedFindByHash.mockResolvedValue([]);
    mockedCreateQuestion.mockResolvedValue({ id: "q1" });
    mockedUpdateDraftContent.mockResolvedValue({ id: "q1" });
    mockedTranscribe.mockResolvedValue({ questionText: "x", answerChoices: ["3", "4", "5", "6"], questionImageId: null });
    mockedClassifyCategory.mockResolvedValue("ALGEBRA");
    mockedDetermineAnswer.mockResolvedValue({ correctChoiceIndex: 1, acceptedAnswers: [], confidence: "high", reasoning: "" });
    mockedGenerateExplanation.mockResolvedValue([{ text: "step" }]);

    await processBulkUploadImage({ buffer: Buffer.from("a completely different image"), mimeType: "image/png" });
    const secondHash = mockedFindByHash.mock.calls[0][0];

    expect(secondHash).not.toBe(firstHash);
  });
});

describe("duplicate detection — processBulkUploadPdfPage", () => {
  it("skips reprocessing and returns the existing question ids when this exact page was already uploaded", async () => {
    mockedFindByHash.mockResolvedValue(["existing-q1", "existing-q2"]);

    const result = await processBulkUploadPdfPage(baseInput);

    expect(result).toEqual({ questionIds: ["existing-q1", "existing-q2"], errors: [], skipped: true });
    expect(mockedTranscribePage).not.toHaveBeenCalled();
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
  });

  it("tags every question created from the same page with that page's single image hash", async () => {
    mockedFindByHash.mockResolvedValue([]);
    mockedTranscribePage.mockResolvedValue([
      { questionText: "Question A", answerChoices: ["1", "2", "3", "4"], questionImageId: null },
      { questionText: "Question B", answerChoices: null, questionImageId: null },
    ]);
    mockedCreateQuestion.mockResolvedValueOnce({ id: "qa" }).mockResolvedValueOnce({ id: "qb" });
    mockedDetermineAnswer
      .mockResolvedValueOnce({ correctChoiceIndex: 0, acceptedAnswers: [], confidence: "high", reasoning: "..." })
      .mockResolvedValueOnce({ correctChoiceIndex: null, acceptedAnswers: ["5"], confidence: "high", reasoning: "..." });

    await processBulkUploadPdfPage(baseInput);

    const hashesUsed = mockedCreateQuestion.mock.calls.map((call) => call[0].sourceImageHash);
    expect(hashesUsed[0]).toBe(hashesUsed[1]);
    expect(hashesUsed[0]).toEqual(expect.any(String));
  });
});

describe("duplicate detection — text-based fallback (findQuestionIdByExactText)", () => {
  // Regression coverage for a real workflow the Owner described: extracting
  // "the pages that failed" out of an original PDF into a *new* PDF file and
  // re-uploading that. The new file's rendered page bytes don't reliably
  // match the original's, so the sourceImageHash check above can't catch it
  // — this second layer, which compares the *transcribed text*, can.
  it("skips a duplicate image and returns the existing question, without any downstream calls, when the transcribed text already exists", async () => {
    mockedFindByText.mockResolvedValue("existing-q1");

    const result = await processBulkUploadImage(baseInput);

    expect(result).toEqual({ questionId: "existing-q1", skipped: true });
    // Transcription itself still had to run — the text match can only be
    // known after transcribing, unlike the image-hash check above.
    expect(mockedTranscribe).toHaveBeenCalled();
    expect(mockedClassifyCategory).not.toHaveBeenCalled();
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
    expect(mockedDetermineAnswer).not.toHaveBeenCalled();
    expect(mockedGenerateExplanation).not.toHaveBeenCalled();
  });

  it("checks by the transcribed question text, not the source image bytes", async () => {
    mockedFindByText.mockResolvedValue("existing-q1");

    await processBulkUploadImage(baseInput);

    expect(mockedFindByText).toHaveBeenCalledWith("What is 2 + 2?");
  });

  it("proceeds normally when no text match is found, even if the image hash was also new", async () => {
    mockedFindByText.mockResolvedValue(null);

    const result = await processBulkUploadImage(baseInput);

    expect(result).toEqual({ questionId: "q1" });
    expect(mockedCreateQuestion).toHaveBeenCalled();
  });

  it("catches a re-uploaded question on a PDF page too, independently per question on the page", async () => {
    mockedTranscribePage.mockResolvedValue([
      { questionText: "Already uploaded question", answerChoices: ["1", "2", "3", "4"], questionImageId: null },
      { questionText: "Genuinely new question", answerChoices: ["1", "2", "3", "4"], questionImageId: null },
    ]);
    mockedFindByText.mockImplementation(async (text: string) => (text === "Already uploaded question" ? "existing-q1" : null));
    mockedCreateQuestion.mockResolvedValueOnce({ id: "new-q" });
    mockedDetermineAnswer.mockResolvedValueOnce({ correctChoiceIndex: 0, acceptedAnswers: [], confidence: "high", reasoning: "..." });

    const result = await processBulkUploadPdfPage(baseInput);

    expect(result.questionIds).toEqual(expect.arrayContaining(["existing-q1", "new-q"]));
    expect(result.errors).toEqual([]);
    expect(mockedCreateQuestion).toHaveBeenCalledTimes(1);
  });
});

describe("processBulkUploadPdfPage", () => {
  it("creates one question per transcribed question found on the page", async () => {
    mockedTranscribePage.mockResolvedValue([
      { questionText: "Question A", answerChoices: ["1", "2", "3", "4"], questionImageId: null },
      { questionText: "Question B", answerChoices: null, questionImageId: null },
    ]);
    mockedCreateQuestion
      .mockResolvedValueOnce({ id: "qa" })
      .mockResolvedValueOnce({ id: "qb" });
    mockedDetermineAnswer
      .mockResolvedValueOnce({ correctChoiceIndex: 0, acceptedAnswers: [], confidence: "high", reasoning: "..." })
      .mockResolvedValueOnce({ correctChoiceIndex: null, acceptedAnswers: ["5"], confidence: "high", reasoning: "..." });

    const result = await processBulkUploadPdfPage(baseInput);

    expect(result).toEqual({ questionIds: ["qa", "qb"], errors: [] });
    expect(mockedCreateQuestion).toHaveBeenCalledTimes(2);
  });

  it("runs multiple questions on a page concurrently, not one after another", async () => {
    // Regression test for the real production issue: sequential processing
    // meant a page's total time was the *sum* of every question's pipeline,
    // which pushed some pages past the client's timeout even though they
    // were still genuinely succeeding. Gate the first question's answer
    // detection so it never resolves on its own, then confirm the second
    // question's own answer detection still starts — proof they're running
    // concurrently (Promise.all), not in a sequential for-await loop where
    // question 2 could never start until question 1 finished.
    mockedTranscribePage.mockResolvedValue([
      { questionText: "Slow question", answerChoices: ["1", "2", "3", "4"], questionImageId: null },
      { questionText: "Fast question", answerChoices: ["1", "2", "3", "4"], questionImageId: null },
    ]);
    mockedCreateQuestion.mockResolvedValueOnce({ id: "slow" }).mockResolvedValueOnce({ id: "fast" });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondQuestionStarted = false;

    mockedDetermineAnswer.mockImplementationOnce(async () => {
      await firstGate;
      return { correctChoiceIndex: 0, acceptedAnswers: [], confidence: "high", reasoning: "slow" };
    });
    mockedDetermineAnswer.mockImplementationOnce(async () => {
      secondQuestionStarted = true;
      return { correctChoiceIndex: 0, acceptedAnswers: [], confidence: "high", reasoning: "fast" };
    });

    const resultPromise = processBulkUploadPdfPage(baseInput);
    await Promise.resolve().then().then().then().then().then(); // let pending microtasks flush without resolving firstGate

    expect(secondQuestionStarted).toBe(true);

    releaseFirst();
    const result = await resultPromise;
    expect(result.questionIds).toEqual(["slow", "fast"]);
  });

  it("returns an empty result, not an error, when the page has no complete questions", async () => {
    mockedTranscribePage.mockResolvedValue([]);
    const result = await processBulkUploadPdfPage(baseInput);
    expect(result).toEqual({ questionIds: [], errors: [] });
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
  });

  it("collects per-question failures without losing the questions that succeeded", async () => {
    mockedTranscribePage.mockResolvedValue([
      { questionText: "Good question", answerChoices: ["1", "2", "3", "4"], questionImageId: null },
      { questionText: "Bad question", answerChoices: ["only one"], questionImageId: null },
    ]);
    mockedCreateQuestion.mockResolvedValueOnce({ id: "qa" });
    mockedDetermineAnswer.mockResolvedValueOnce({ correctChoiceIndex: 0, acceptedAnswers: [], confidence: "high", reasoning: "..." });

    const result = await processBulkUploadPdfPage(baseInput);

    expect(result.questionIds).toEqual(["qa"]);
    expect(result.errors).toHaveLength(1);
    // The malformed second question never reaches question creation.
    expect(mockedCreateQuestion).toHaveBeenCalledTimes(1);
  });

  it("returns a page-level error, not a throw, when page transcription itself fails", async () => {
    mockedTranscribePage.mockRejectedValue(new Error("vision call failed"));
    const result = await processBulkUploadPdfPage(baseInput);
    expect(result).toEqual({ questionIds: [], errors: ["vision call failed"] });
    expect(mockedCreateQuestion).not.toHaveBeenCalled();
  });
});
