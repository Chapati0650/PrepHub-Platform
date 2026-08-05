import { z } from "zod";

export const schoolEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid school email address"),
});
export type SchoolEmailInput = z.infer<typeof schoolEmailSchema>;

export const schoolSelectionSchema = z.object({
  token: z.string().min(1),
  schoolId: z.string().min(1, "Select your school to continue"),
});
