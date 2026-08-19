import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createAccount,
  requestPasswordReset,
  confirmPasswordReset,
  logOutAllDevices,
  deleteAccount,
} from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { sendEmail } from "@/lib/email";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    passwordResetToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    account: { deleteMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

const mockedSendEmail = sendEmail as ReturnType<typeof vi.fn>;

const mockedPrisma = prisma as unknown as {
  user: Record<string, ReturnType<typeof vi.fn>>;
  passwordResetToken: Record<string, ReturnType<typeof vi.fn>>;
  account: Record<string, ReturnType<typeof vi.fn>>;
  session: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

const validSignUp = {
  firstName: "Ada",
  email: "ada@example.com",
  password: "hunter22",
  ageConfirmed: true as const,
  tosAccepted: true as const,
  privacyAccepted: true as const,
};

describe("createAccount", () => {
  it("creates a user with a hashed password and a legal acceptance record", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: "u1", ...validSignUp });

    await createAccount(validSignUp);

    expect(mockedPrisma.user.create).toHaveBeenCalledTimes(1);
    const call = mockedPrisma.user.create.mock.calls[0][0];
    expect(call.data.email).toBe("ada@example.com");
    expect(call.data.passwordHash).not.toBe("hunter22"); // must be hashed, not plaintext
    expect(call.data.legalAcceptances.create).toHaveLength(1);
  });

  it("throws EMAIL_TAKEN when the email is already registered", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(createAccount(validSignUp)).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
    });
    expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("sends a welcome email to the new account exactly once", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    mockedPrisma.user.create.mockResolvedValue({ id: "u1", firstName: "Ada", email: "ada@example.com" });

    await createAccount(validSignUp);

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    const call = mockedSendEmail.mock.calls[0][0];
    expect(call.to).toBe("ada@example.com");
    expect(call.subject).toBe("Welcome to PrepHub");
    expect(call.text).toContain("Hi Ada,");
  });
});

describe("requestPasswordReset", () => {
  it("creates a reset token when the user exists", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ada@example.com",
      deletedAt: null,
    });
    mockedPrisma.passwordResetToken.create.mockResolvedValue({});

    await requestPasswordReset("ada@example.com");

    expect(mockedPrisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
  });

  it("silently no-ops for an unknown email (avoids account enumeration)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    await expect(requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();
    expect(mockedPrisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it("silently no-ops for a deleted account", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "ada@example.com",
      deletedAt: new Date(),
    });

    await requestPasswordReset("ada@example.com");
    expect(mockedPrisma.passwordResetToken.create).not.toHaveBeenCalled();
  });
});

describe("confirmPasswordReset", () => {
  it("updates the password and bumps tokenVersion, then marks the token used", async () => {
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60),
    });
    mockedPrisma.user.update.mockResolvedValue({});
    mockedPrisma.passwordResetToken.update.mockResolvedValue({});

    await confirmPasswordReset("raw-token", "newpassword1");

    expect(mockedPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
    expect(mockedPrisma.passwordResetToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" } }),
    );
  });

  it("rejects a missing or already-used token", async () => {
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(confirmPasswordReset("bad-token", "newpassword1")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });

    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60),
    });
    await expect(confirmPasswordReset("used-token", "newpassword1")).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
  });

  it("rejects an expired token", async () => {
    mockedPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(confirmPasswordReset("expired-token", "newpassword1")).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("logOutAllDevices", () => {
  it("increments the user's tokenVersion", async () => {
    mockedPrisma.user.update.mockResolvedValue({});
    await logOutAllDevices("u1");
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { tokenVersion: { increment: 1 } },
    });
  });
});

describe("deleteAccount", () => {
  it("verifies the password, anonymizes the user, and clears sessions/accounts atomically", async () => {
    const passwordHash = await hashPassword("correct-password");
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "u1",
      passwordHash,
      deletedAt: null,
    });
    mockedPrisma.user.update.mockResolvedValue({});
    mockedPrisma.account.deleteMany.mockResolvedValue({});
    mockedPrisma.session.deleteMany.mockResolvedValue({});

    await deleteAccount("u1", "correct-password");

    const updateCall = mockedPrisma.user.update.mock.calls[0][0];
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    expect(updateCall.data.email).toContain("deleted-u1");
    expect(updateCall.data.passwordHash).toBeNull();
    expect(mockedPrisma.account.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(mockedPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("rejects an incorrect password without touching the account", async () => {
    const passwordHash = await hashPassword("correct-password");
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "u1", passwordHash, deletedAt: null });

    await expect(deleteAccount("u1", "wrong-password")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects deleting an account that doesn't exist or is already deleted", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    await expect(deleteAccount("ghost", "anything")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });

    mockedPrisma.user.findUnique.mockResolvedValue({ id: "u1", deletedAt: new Date() });
    await expect(deleteAccount("u1", "anything")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("skips password verification for Google-only accounts (no passwordHash)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "u1", passwordHash: null, deletedAt: null });
    mockedPrisma.user.update.mockResolvedValue({});
    mockedPrisma.account.deleteMany.mockResolvedValue({});
    mockedPrisma.session.deleteMany.mockResolvedValue({});

    await expect(deleteAccount("u1", "")).resolves.toBeUndefined();
  });
});
