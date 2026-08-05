import { describe, expect, it } from "vitest";
import { signUpSchema, loginSchema, confirmPasswordResetSchema } from "@/lib/validation/auth";

const validSignUp = {
  firstName: "Ada",
  email: "ada@example.com",
  password: "hunter22",
  grade: 11,
  ageConfirmed: true,
  tosAccepted: true,
  privacyAccepted: true,
};

describe("signUpSchema", () => {
  it("accepts a fully valid signup", () => {
    expect(signUpSchema.safeParse(validSignUp).success).toBe(true);
  });

  it.each([9, 10, 11, 12])("accepts grade %i", (grade) => {
    expect(signUpSchema.safeParse({ ...validSignUp, grade }).success).toBe(true);
  });

  it.each([8, 13, 0, -1])("rejects grade %i (PRD-001: only 9-12)", (grade) => {
    expect(signUpSchema.safeParse({ ...validSignUp, grade }).success).toBe(false);
  });

  it("rejects a password under 8 characters", () => {
    expect(signUpSchema.safeParse({ ...validSignUp, password: "short1" }).success).toBe(false);
  });

  it("rejects an empty first name", () => {
    expect(signUpSchema.safeParse({ ...validSignUp, firstName: "  " }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(signUpSchema.safeParse({ ...validSignUp, email: "not-an-email" }).success).toBe(false);
  });

  it("lowercases and trims the email", () => {
    const result = signUpSchema.safeParse({ ...validSignUp, email: "  ADA@Example.com  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("ada@example.com");
  });

  it.each(["ageConfirmed", "tosAccepted", "privacyAccepted"] as const)(
    "rejects when %s is not checked",
    (field) => {
      expect(signUpSchema.safeParse({ ...validSignUp, [field]: false }).success).toBe(false);
    },
  );
});

describe("loginSchema", () => {
  it("accepts valid credentials", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("confirmPasswordResetSchema", () => {
  it("rejects a new password under 8 characters", () => {
    expect(
      confirmPasswordResetSchema.safeParse({ token: "abc", password: "short1" }).success,
    ).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(
      confirmPasswordResetSchema.safeParse({ token: "", password: "longenough1" }).success,
    ).toBe(false);
  });
});
