import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("verifies a password it just hashed", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  // Lowering the work factor must not lock anyone out: an existing hash still
  // carries its own cost and has to keep verifying.
  it("still verifies a hash made at the old, higher work factor", async () => {
    const legacy = await bcrypt.hash("hunter2222", 12);
    await expect(verifyPassword("hunter2222", legacy)).resolves.toBe(true);
  });
});

describe("needsRehash", () => {
  it("leaves a hash at the current work factor alone", async () => {
    expect(needsRehash(await hashPassword("x"))).toBe(false);
  });

  it("flags a hash made at a higher work factor", async () => {
    expect(needsRehash(await bcrypt.hash("x", 12))).toBe(true);
  });

  it("flags a hash made at a lower work factor, so the setting can be raised too", async () => {
    expect(needsRehash(await bcrypt.hash("x", 8))).toBe(true);
  });

  it("leaves an unparseable value alone rather than rewriting it", () => {
    expect(needsRehash("not-a-bcrypt-hash")).toBe(false);
    expect(needsRehash("")).toBe(false);
  });
});
