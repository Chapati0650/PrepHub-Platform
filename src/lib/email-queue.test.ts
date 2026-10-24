import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainEmailQueue, enqueueEmails, getQueueHealth, queueRows } from "@/lib/email-queue";
import { sendBulkEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/email", () => ({
  sendBulkEmail: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    queuedEmail: { createMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const mocked = prisma as unknown as {
  queuedEmail: Record<string, ReturnType<typeof vi.fn>>;
  $queryRaw: ReturnType<typeof vi.fn>;
};
const mockedSendBulkEmail = sendBulkEmail as unknown as ReturnType<typeof vi.fn>;

type Row = { id: string; kind: string; to: string; subject: string; body: string };

function row(id: string, overrides: Partial<Row> = {}): Row {
  return { id, kind: "announcement", to: `${id}@school.edu`, subject: "Snow day", body: "No school.", ...overrides };
}

/** Claims `batches` in order, then nothing — what an emptying queue looks like. */
function givenClaims(...batches: Row[][]) {
  let call = 0;
  mocked.$queryRaw.mockImplementation(() => Promise.resolve(batches[call++] ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSendBulkEmail.mockResolvedValue({ sent: 0, failed: 0 });
  mocked.queuedEmail.count.mockResolvedValue(0);
  mocked.queuedEmail.findFirst.mockResolvedValue(null);
  mocked.queuedEmail.updateMany.mockResolvedValue({ count: 0 });
  mocked.queuedEmail.createMany.mockResolvedValue({ count: 0 });
  givenClaims();
});

describe("queueRows", () => {
  it("drops duplicates and anything that isn't an address", () => {
    const rows = queueRows("announcement", ["a@x.edu", "a@x.edu", "", "not-an-email"], {
      subject: "s",
      text: "t",
    });
    expect(rows.map((r) => r.to)).toEqual(["a@x.edu"]);
  });

  it("carries the body as the row's body, so a later edit can't change mail already queued", () => {
    const rows = queueRows("announcement", ["a@x.edu"], { subject: "s", text: "original" });
    expect(rows[0]).toEqual({ kind: "announcement", to: "a@x.edu", subject: "s", body: "original" });
  });
});

describe("enqueueEmails", () => {
  it("writes nothing and asks the database for nothing when there are no valid recipients", async () => {
    expect(await enqueueEmails("announcement", ["", "nope"], { subject: "s", text: "t" })).toBe(0);
    expect(mocked.queuedEmail.createMany).not.toHaveBeenCalled();
  });
});

describe("drainEmailQueue", () => {
  it("marks a successfully sent batch sent and clears its claim", async () => {
    givenClaims([row("a"), row("b")]);

    const result = await drainEmailQueue({});

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(mocked.queuedEmail.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] } },
      data: { sentAt: expect.any(Date), claimedAt: null, lastError: null },
    });
  });

  it("sends one provider call per distinct message, not one per row", async () => {
    givenClaims([
      row("a", { subject: "Snow day" }),
      row("b", { subject: "Snow day" }),
      row("c", { subject: "Picture day", body: "Wear a shirt." }),
    ]);

    await drainEmailQueue({});

    expect(mockedSendBulkEmail).toHaveBeenCalledTimes(2);
    expect(mockedSendBulkEmail).toHaveBeenCalledWith(
      ["a@school.edu", "b@school.edu"],
      { subject: "Snow day", text: "No school." },
    );
  });

  it("releases the claim instead of marking sent when the provider rejects the batch", async () => {
    givenClaims([row("a")]);
    mockedSendBulkEmail.mockResolvedValue({ sent: 0, failed: 1 });

    const result = await drainEmailQueue({});

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    // Released, never marked sent — so the next run retries it. The attempt
    // counter was already incremented by the claim, which is what eventually
    // retires a permanently bad address.
    expect(mocked.queuedEmail.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] } },
      data: { claimedAt: null, lastError: "provider rejected 1 of 1" },
    });
  });

  it("keeps claiming until the queue is empty", async () => {
    givenClaims([row("a")], [row("b")], []);

    const result = await drainEmailQueue({});

    expect(result.sent).toBe(2);
    expect(mocked.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("stops at the claim limit rather than draining a whole district in one run", async () => {
    givenClaims([row("a"), row("b")], [row("c")]);

    const result = await drainEmailQueue({ limit: 2 });

    expect(result.sent).toBe(2);
    // Claimed once, stopped, and never asked for the second batch.
    expect(mocked.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("stops once the time budget is spent, leaving the rest for the scheduled run", async () => {
    givenClaims([row("a")], [row("b")], [row("c")]);
    // Each send takes longer than the whole budget, so exactly one batch goes.
    mockedSendBulkEmail.mockImplementation(async () => {
      vi.advanceTimersByTime(50);
      return { sent: 1, failed: 0 };
    });
    vi.useFakeTimers();

    const result = await drainEmailQueue({ budgetMs: 10 });
    vi.useRealTimers();

    expect(result.sent).toBe(1);
    expect(mocked.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("asks the provider for nothing when the queue is empty", async () => {
    const result = await drainEmailQueue({});

    expect(result).toEqual({ sent: 0, failed: 0, remaining: 0 });
    expect(mockedSendBulkEmail).not.toHaveBeenCalled();
  });
});

describe("getQueueHealth", () => {
  it("separates still-retryable rows from ones that have exhausted their attempts", async () => {
    mocked.queuedEmail.count.mockResolvedValueOnce(7).mockResolvedValueOnce(2);
    mocked.queuedEmail.findFirst.mockResolvedValue({ createdAt: new Date("2026-10-21") });

    expect(await getQueueHealth()).toMatchObject({
      pending: 7,
      deadLettered: 2,
      oldestPendingAt: new Date("2026-10-21"),
    });
  });

  it("reports how long the oldest row has waited, so a stalled schedule is visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:30:00Z"));
    mocked.queuedEmail.findFirst.mockResolvedValue({ createdAt: new Date("2026-10-21T12:00:00Z") });

    const health = await getQueueHealth();
    vi.useRealTimers();

    expect(health.oldestPendingMinutes).toBe(30);
  });

  it("reports zero minutes rather than a bogus age when nothing is waiting", async () => {
    const health = await getQueueHealth();

    expect(health.oldestPendingAt).toBeNull();
    expect(health.oldestPendingMinutes).toBe(0);
  });
});
