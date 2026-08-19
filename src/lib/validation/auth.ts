import { z } from "zod";

// PRD-001 doesn't specify an exact complexity policy beyond "secure" — 8 characters
// is a reasonable, common minimum. Revisit if a later PRD/security doc specifies more.
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const signUpSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: passwordSchema,
  ageConfirmed: z.literal(true, {
    error: "You must confirm you are 13 years or older",
  }),
  tosAccepted: z.literal(true, { error: "You must accept the Terms of Service" }),
  privacyAccepted: z.literal(true, { error: "You must accept the Privacy Policy" }),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ConfirmPasswordResetInput = z.infer<typeof confirmPasswordResetSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm"),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
