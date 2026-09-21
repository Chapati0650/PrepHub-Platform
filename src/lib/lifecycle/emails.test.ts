import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendDailyReminders, sendFinishDiagnosticNudges } from "./emails";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    emailSend: { create: vi.fn() },
    predictionHistoryEntry: { findFirst: vi.fn() },
    categoryState: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

const users = prisma.user.findMany as ReturnType<typeof vi.fn>;
const claim = prisma.emailSend.create as ReturnType<typeof vi.fn>;
const send = sendEmail as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  claim.mockResolvedValue({});
  send.mockResolvedValue(undefined);
});

describe("sendFinishDiagnosticNudges", () => {
  it("emails each candidate once, with their progress in the subject", async () => {
    users.mockResolvedValue([
      { id: "u1", email: "a@x.com", firstName: "Ada", diagnosticSession: { attempts: [{ id: "1" }, { id: "2" }, { id: "3" }] } },
      { id: "u2", email: "b@x.com", firstName: "Ben", diagnosticSession: null },
    ]);
    const sent = await sendFinishDiagnosticNudges(new Date("2026-09-21T22:00:00Z"));
    expect(sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].subject).toBe("You're 3 of 21 questions in");
    expect(send.mock.calls[0][0].text).toContain("remaining 18");
    expect(send.mock.calls[1][0].subject).toBe("Your predicted SAT score is 21 questions away");
    // the claim is written before the send, once per user, for "once"
    expect(claim).toHaveBeenCalledWith({ data: { userId: "u1", kind: "finish_diagnostic", day: "once" } });
  });

  it("skips anyone whose claim row already exists (a re-run)", async () => {
    users.mockResolvedValue([{ id: "u1", email: "a@x.com", firstName: "Ada", diagnosticSession: null }]);
    claim.mockRejectedValueOnce(new Error("unique"));
    expect(await sendFinishDiagnosticNudges()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendDailyReminders", () => {
  it("points paid students at practice and free students at the Daily Challenge, keyed by day", async () => {
    users.mockResolvedValue([
      { id: "p", email: "p@x.com", firstName: "Pat", subscription: { status: "ACTIVE" } },
      { id: "f", email: "f@x.com", firstName: "Fay", subscription: null },
    ]);
    const sent = await sendDailyReminders(new Date("2026-09-21T22:00:00Z"));
    expect(sent).toBe(2);
    expect(send.mock.calls[0][0].text).toContain("/practice");
    expect(send.mock.calls[1][0].text).toContain("/daily");
    expect(claim).toHaveBeenCalledWith({ data: { userId: "f", kind: "daily_reminder", day: "2026-09-21" } });
  });
});
