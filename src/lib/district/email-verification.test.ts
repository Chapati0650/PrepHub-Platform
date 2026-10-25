import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { scheduleSubscriptionNonRenewal } from "@/lib/billing";
import { ensureDistrictMembership, findDistrictMatch } from "@/lib/district/enrollment";
import {
  confirmEmailVerification,
  inspectEmailVerification,
  resendFromExpiredLink,
  sendDistrictVerificationEmail,
} from "@/lib/district/email-verification";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    emailVerificationToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/billing", () => ({ scheduleSubscriptionNonRenewal: vi.fn() }));
vi.mock("@/lib/entitlements", () => ({ invalidateAccessContext: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/district/enrollment", () => ({
  ensureDistrictMembership: vi.fn(),
  findDistrictMatch: vi.fn(),
}));

const mocked = prisma as unknown as {
  user: Record<string, ReturnType<typeof vi.fn>>;
  emailVerificationToken: Record<string, ReturnType<typeof vi.fn>>;
};
const mockedSend = sendEmail as unknown as ReturnType<typeof vi.fn>;
const mockedMatch = findDistrictMatch as unknown as ReturnType<typeof vi.fn>;
const mockedEnsure = ensureDistrictMembership as unknown as ReturnType<typeof vi.fn>;

const MATCH = {
  kind: "MATCH",
  via: "DOMAIN_MATCH",
  organizationId: "school1",
  organizationName: "Northwest High School",
  schoolId: "school1",
  schoolName: "Northwest High School",
  graduationYear: null,
};

function storedToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    userId: "s1",
    email: "kid@nisd.net",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: "s1", email: "Kid@NISD.net", firstName: "Ada", deletedAt: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ ok: true });
  mockedMatch.mockResolvedValue(MATCH);
});

describe("sendDistrictVerificationEmail", () => {
  it("sends a hashed-at-rest, single-use link to the account's own address", async () => {
    mocked.user.findUnique.mockResolvedValue({ email: "kid@nisd.net", emailVerified: null, firstName: "Ada", role: "STUDENT", deletedAt: null });

    expect(await sendDistrictVerificationEmail("s1")).toBe("SENT");

    const sent = mockedSend.mock.calls[0][0];
    expect(sent.to).toBe("kid@nisd.net");
    expect(sent.subject).toContain("Northwest High School");
    const raw = sent.text.match(/\/verify-email\/([0-9a-f]{64})/)?.[1];
    expect(raw).toBeTruthy();
    // Only the hash is stored: a database read can't be turned into a link.
    const stored = mocked.emailVerificationToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(createHash("sha256").update(raw!).digest("hex"));
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.email).toBe("kid@nisd.net");
  });

  it("sends nothing when no district would act on the address", async () => {
    mocked.user.findUnique.mockResolvedValue({ email: "kid@gmail.com", emailVerified: null, firstName: "Ada", role: "STUDENT", deletedAt: null });
    mockedMatch.mockResolvedValue({ kind: "NONE" });

    expect(await sendDistrictVerificationEmail("s1")).toBe("NOT_ELIGIBLE");
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mocked.emailVerificationToken.create).not.toHaveBeenCalled();
  });

  it("sends nothing to an address that's already verified, or to a non-student", async () => {
    mocked.user.findUnique.mockResolvedValue({ email: "kid@nisd.net", emailVerified: new Date(), firstName: "Ada", role: "STUDENT", deletedAt: null });
    expect(await sendDistrictVerificationEmail("s1")).toBe("ALREADY_VERIFIED");
    mocked.user.findUnique.mockResolvedValue({ email: "t@nisd.net", emailVerified: null, firstName: "T", role: "TEACHER", deletedAt: null });
    expect(await sendDistrictVerificationEmail("s1")).toBe("NOT_ELIGIBLE");
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("reports a failed send rather than claiming it went out", async () => {
    mocked.user.findUnique.mockResolvedValue({ email: "kid@nisd.net", emailVerified: null, firstName: "Ada", role: "STUDENT", deletedAt: null });
    mockedSend.mockResolvedValue({ ok: false, reason: "provider down" });

    expect(await sendDistrictVerificationEmail("s1")).toBe("FAILED");
  });
});

describe("inspectEmailVerification", () => {
  it("is read-only — a mail scanner opening the page changes nothing", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(storedToken());

    expect(await inspectEmailVerification("raw")).toMatchObject({ state: "READY", userId: "s1", firstName: "Ada", match: MATCH });
    expect(mocked.emailVerificationToken.updateMany).not.toHaveBeenCalled();
    expect(mocked.user.updateMany).not.toHaveBeenCalled();
  });

  it("treats a link for an address the account no longer has as invalid", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(
      storedToken({ user: { id: "s1", email: "new@gmail.com", firstName: "Ada", deletedAt: null } }),
    );
    expect(await inspectEmailVerification("raw")).toEqual({ state: "INVALID" });
  });

  it("distinguishes unknown, used and expired links", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(null);
    expect((await inspectEmailVerification("raw")).state).toBe("INVALID");
    mocked.emailVerificationToken.findUnique.mockResolvedValue(storedToken({ usedAt: new Date() }));
    expect((await inspectEmailVerification("raw")).state).toBe("USED");
    mocked.emailVerificationToken.findUnique.mockResolvedValue(storedToken({ expiresAt: new Date(Date.now() - 1) }));
    expect((await inspectEmailVerification("raw")).state).toBe("EXPIRED");
  });
});

describe("confirmEmailVerification", () => {
  it("marks the link used and the address verified, then enrolls with the chosen campus", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(storedToken());
    mockedEnsure.mockResolvedValue("CREATED");

    expect(await confirmEmailVerification("raw", { schoolId: "campus2" })).toEqual({
      ok: true,
      userId: "s1",
      email: "kid@nisd.net",
      outcome: "CREATED",
    });
    // Both writes are guarded, so two simultaneous presses can't double-apply.
    expect(mocked.emailVerificationToken.updateMany.mock.calls[0][0].where).toEqual({ id: "t1", usedAt: null });
    expect(mocked.user.updateMany.mock.calls[0][0].where).toEqual({ id: "s1", emailVerified: null });
    expect(mockedEnsure).toHaveBeenCalledWith("s1", { schoolId: "campus2" });
    // A subscription bought while waiting is set not to renew (PRD-003 §16).
    expect(scheduleSubscriptionNonRenewal).toHaveBeenCalledWith("s1");
  });

  it("is idempotent: a second press reports where enrollment stands without writing again", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(storedToken({ usedAt: new Date() }));
    mockedEnsure.mockResolvedValue("ALREADY_MEMBER");

    expect(await confirmEmailVerification("raw")).toMatchObject({ ok: true, outcome: "ALREADY_MEMBER" });
    expect(mocked.emailVerificationToken.updateMany).not.toHaveBeenCalled();
    expect(mocked.user.updateMany).not.toHaveBeenCalled();
    expect(scheduleSubscriptionNonRenewal).not.toHaveBeenCalled();
  });

  it("verifies nothing from an expired link", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(storedToken({ expiresAt: new Date(Date.now() - 1) }));

    expect(await confirmEmailVerification("raw")).toEqual({ ok: false, reason: "EXPIRED" });
    expect(mocked.user.updateMany).not.toHaveBeenCalled();
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it("verifies nothing from an unknown link", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(null);
    expect(await confirmEmailVerification("raw")).toEqual({ ok: false, reason: "INVALID" });
    expect(mocked.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("resendFromExpiredLink", () => {
  it("sends the new link to the account the old one was for, never anywhere else", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue({ userId: "s1" });
    mocked.user.findUnique.mockResolvedValue({ email: "kid@nisd.net", emailVerified: null, firstName: "Ada", role: "STUDENT", deletedAt: null });

    expect(await resendFromExpiredLink("raw")).toBe("SENT");
    expect(mockedSend.mock.calls[0][0].to).toBe("kid@nisd.net");
  });

  it("does nothing for an unknown link", async () => {
    mocked.emailVerificationToken.findUnique.mockResolvedValue(null);
    expect(await resendFromExpiredLink("raw")).toBe("NOT_ELIGIBLE");
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
