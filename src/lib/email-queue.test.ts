import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, drainEmailQueue, enqueueEmails, getQueueHealth, isPlausibleEmailAddress, queueRows } from "@/lib/email-queue";
import { sendEmailBatch } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { logEmailDeliveryFailure } from "@/lib/logger";

vi.mock("@/lib/email", () => ({
  sendEmailBatch: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
  BATCH_PAUSE_MS: 0,
}));

vi.mock("@/lib/logger", () => ({ logEmailDeliveryFailure: vi.fn() }));

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
const mockedSendEmailBatch = sendEmailBatch as unknown as ReturnType<typeof vi.fn>;

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
  mockedSendEmailBatch.mockResolvedValue({ sent: 0, failed: 0 });
  mocked.queuedEmail.count.mockResolvedValue(0);
  mocked.queuedEmail.findFirst.mockResolvedValue(null);
  mocked.queuedEmail.updateMany.mockResolvedValue({ count: 0 });
  mocked.queuedEmail.createMany.mockResolvedValue({ count: 0 });
  givenClaims();
});

describe("isPlausibleEmailAddress", () => {
  it.each(["ada@school.edu", "ada.lovelace+sat@mail.district.k12.tx.us", "o'brien@x.org", "a@xn--bcher-kva.example"])(
    "accepts %s",
    (address) => {
      expect(isPlausibleEmailAddress(address)).toBe(true);
    },
  );

  it.each([
    "not-an-email",
    "ada@",
    "@school.edu",
    "ada@@school.edu",
    "ada@school",
    "ada @school.edu",
    "ada@school..edu",
    "ada@school.e",
    ".ada@school.edu",
    "ada..l@school.edu",
    "ada@school.edu, bob@school.edu",
    "Ada <ada@school.edu>",
    "ada@-school.edu",
  ])("rejects %s, which would make the provider refuse its whole batch", (address) => {
    expect(isPlausibleEmailAddress(address)).toBe(false);
  });
});

describe("queueRows", () => {
  it("drops duplicates and anything that isn't an address", () => {
    const rows = queueRows("announcement", ["a@x.edu", "a@x.edu", "", "not-an-email"], {
      subject: "s",
      text: "t",
    });
    expect(rows.map((r) => r.to)).toEqual(["a@x.edu"]);
  });

  it("trims before checking, so a roster's stray space doesn't cost the student their email", () => {
    const rows = queueRows("roster_invite", [" a@x.edu ", "a@x.edu", "b@x.edu\t"], { subject: "s", text: "t" });
    expect(rows.map((r) => r.to)).toEqual(["a@x.edu", "b@x.edu"]);
  });

  it("counts what it left out without ever logging an address", () => {
    queueRows("announcement", ["ok@x.edu", "broken@", "also broken@x.edu"], { subject: "s", text: "t" });

    expect(logEmailDeliveryFailure).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify((logEmailDeliveryFailure as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(logged).toContain('"dropped":2');
    expect(logged).not.toContain("broken");
    expect(logged).not.toContain("ok@x.edu");
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

  it("sends a claimed batch as one provider call, even when its messages differ", async () => {
    givenClaims([
      row("a", { subject: "Snow day" }),
      row("b", { subject: "Snow day" }),
      row("c", { kind: "daily_reminder", subject: "Today's set", body: "Hi Ada" }),
    ]);

    await drainEmailQueue({});

    expect(mockedSendEmailBatch).toHaveBeenCalledTimes(1);
    expect(mockedSendEmailBatch).toHaveBeenCalledWith([
      { to: "a@school.edu", subject: "Snow day", text: "No school." },
      { to: "b@school.edu", subject: "Snow day", text: "No school." },
      { to: "c@school.edu", subject: "Today's set", text: "Hi Ada" },
    ]);
  });

  it("releases the claim instead of marking sent when the provider rejects the batch", async () => {
    givenClaims([row("a")]);
    mockedSendEmailBatch.mockResolvedValue({ sent: 0, failed: 1 });

    const result = await drainEmailQueue({});

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    // Released, never marked sent — so the next run retries it. The attempt
    // counter was already incremented by the claim, which is what eventually
    // retires a permanently bad address.
    expect(mocked.queuedEmail.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a"] } },
      data: { claimedAt: null, lastError: "provider rejected this address" },
    });
  });

  it("delivers everyone else when the provider refuses a batch over one address", async () => {
    // Resend refuses the whole request for one bad address. Splitting finds it
    // and sends the rest, instead of retrying the same hundred until all of
    // them are given up on.
    const rows = Array.from({ length: 8 }, (_, i) => row(`r${i}`));
    givenClaims(rows);
    mockedSendEmailBatch.mockImplementation(async (messages: { to: string }[]) =>
      messages.some((m) => m.to === "r5@school.edu")
        ? { sent: 0, failed: messages.length }
        : { sent: messages.length, failed: 0 },
    );

    const result = await drainEmailQueue({});

    expect(result).toMatchObject({ sent: 7, failed: 1 });
    const sentIds = mocked.queuedEmail.updateMany.mock.calls
      .filter((call) => call[0].data.sentAt)
      .flatMap((call) => call[0].where.id.in);
    expect(sentIds.sort()).toEqual(["r0", "r1", "r2", "r3", "r4", "r6", "r7"]);
    expect(mocked.queuedEmail.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["r5"] } },
      data: { claimedAt: null, lastError: "provider rejected this address" },
    });
    // 8 → 4+4 → 2+2 → 1+1: one call per half on the way down.
    expect(mockedSendEmailBatch).toHaveBeenCalledTimes(7);
  });

  it("stops splitting during a provider outage instead of turning one batch into a flood of calls", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(`r${i}`));
    givenClaims(rows);
    mockedSendEmailBatch.mockImplementation(async (messages: unknown[]) => ({ sent: 0, failed: messages.length }));

    const result = await drainEmailQueue({});

    expect(mockedSendEmailBatch).toHaveBeenCalledTimes(16);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(100);
    // Everything not individually refused is released together for the next run.
    const released = mocked.queuedEmail.updateMany.mock.calls.flatMap((call) => call[0].where.id.in);
    expect(new Set(released).size).toBe(100);
  });

  it("retires a malformed address already in the queue without spending a provider call on it", async () => {
    givenClaims([row("good"), row("bad", { to: "bad@@school.edu" })]);
    mockedSendEmailBatch.mockResolvedValue({ sent: 1, failed: 0 });

    const result = await drainEmailQueue({});

    expect(result).toMatchObject({ sent: 1, failed: 1 });
    expect(mocked.queuedEmail.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["bad"] } },
      data: { claimedAt: null, attempts: MAX_ATTEMPTS, lastError: "malformed address" },
    });
    expect(mockedSendEmailBatch).toHaveBeenCalledWith([{ to: "good@school.edu", subject: "Snow day", text: "No school." }]);
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
    mockedSendEmailBatch.mockImplementation(async () => {
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
    expect(mockedSendEmailBatch).not.toHaveBeenCalled();
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
