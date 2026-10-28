import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// The walkthrough's "Did this make sense?" posts through a server action,
// which imports Auth.js, which can't load outside Next. Every component test
// that renders a walkthrough would otherwise have to mock it by hand.
vi.mock("@/lib/content/walkthrough-feedback-actions", () => ({ recordWalkthroughFeedbackAction: vi.fn(async () => undefined) }));
