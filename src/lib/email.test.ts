import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const batchSend = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
    batch = { send: batchSend };
  },
}));
vi.mock("@/lib/logger", () => ({ logEmailDeliveryFailure: vi.fn() }));

// The Resend client is built when the module loads, from the environment, so
// each case loads a fresh copy with a key present.
async function loadWithKey() {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  return import("@/lib/email");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("isUndeliverableAddress", () => {
  it.each([
    "student@example.com",
    "Student@EXAMPLE.org",
    "a@example.net",
    "a@mail.example.com",
    "a@school.test",
    "a@demo.example",
    "a@nowhere.invalid",
    "a@box.localhost",
  ])("treats %s as reserved", async (address) => {
    const { isUndeliverableAddress } = await loadWithKey();
    expect(isUndeliverableAddress(address)).toBe(true);
  });

  it.each(["kid@nisd.net", "kid@gmail.com", "a@examples.com", "a@notexample.com", "a@testing.org"])(
    "treats %s as a real address",
    async (address) => {
      const { isUndeliverableAddress } = await loadWithKey();
      expect(isUndeliverableAddress(address)).toBe(false);
    },
  );
});

describe("sending through Resend", () => {
  it("never calls the provider for a reserved test address, and reports it handled", async () => {
    const { sendEmail } = await loadWithKey();
    expect(await sendEmail({ to: "student@example.com", subject: "s", text: "t" })).toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends to a real address", async () => {
    const { sendEmail } = await loadWithKey();
    send.mockResolvedValue({ error: null });
    expect(await sendEmail({ to: "kid@nisd.net", subject: "s", text: "t" })).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drops reserved addresses from a bulk send, counting them as handled so the queue won't retry them", async () => {
    const { sendBulkEmail } = await loadWithKey();
    batchSend.mockResolvedValue({ error: null });

    const result = await sendBulkEmail(["a@example.com", "kid@nisd.net", "b@demo.test", "kid2@nisd.net"], {
      subject: "s",
      text: "t",
    });

    expect(result).toEqual({ sent: 4, failed: 0 });
    expect(batchSend).toHaveBeenCalledTimes(1);
    expect(batchSend.mock.calls[0][0].map((m: { to: string }) => m.to)).toEqual(["kid@nisd.net", "kid2@nisd.net"]);
  });

  it("makes no provider call at all when every recipient is reserved", async () => {
    const { sendBulkEmail } = await loadWithKey();
    expect(await sendBulkEmail(["a@example.com", "b@example.com"], { subject: "s", text: "t" })).toEqual({
      sent: 2,
      failed: 0,
    });
    expect(batchSend).not.toHaveBeenCalled();
  });
});
