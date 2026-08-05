import { z } from "zod";

// PRD-011 §14 — an Administrator may correct exactly these two student
// fields; bounds mirror the Owner-side `graduationInfoSchema` so the same
// underlying `expectedGraduationYear` column is validated identically
// regardless of which role edits it.
export const updateStudentInfoSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  expectedGraduationYear: z.coerce.number().int().min(2020).max(2100),
});

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be 200 characters or fewer"),
  message: z.string().trim().min(1, "Message is required").max(5000, "Message must be 5,000 characters or fewer"),
  expiresAt: z.coerce.date().optional(),
});
