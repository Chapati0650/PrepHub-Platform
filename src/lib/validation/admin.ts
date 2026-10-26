import { z } from "zod";
import { endOfLocalDay } from "@/lib/community/local-day";

// PRD-011 §14 — an Administrator may correct exactly these two student
// fields; bounds mirror the Owner-side `graduationInfoSchema` so the same
// underlying `expectedGraduationYear` column is validated identically
// regardless of which role edits it. The tighter window an Administrator is
// held to — no year that would end a student's access — depends on today's
// date, so it is checked in `updateStudentInfo`, not here.
export const updateStudentInfoSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  expectedGraduationYear: z.coerce.number().int().min(2020).max(2100),
});

// The end date is a calendar day as the administrator means it: the
// announcement shows through the end of that day in the school's time zone.
// `z.coerce.date()` used to read "2026-11-05" as midnight UTC, which is 7pm
// Central the evening before — so choosing today published an announcement
// that had already ended (while every student was still emailed it), and
// choosing tomorrow ended it at 7pm tonight.
export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be 200 characters or fewer"),
  message: z.string().trim().min(1, "Message is required").max(5000, "Message must be 5,000 characters or fewer"),
  expiresAt: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      const endsAt = endOfLocalDay(value);
      if (!endsAt) {
        ctx.addIssue({ code: "custom", message: "Enter the end date as a date." });
        return z.NEVER;
      }
      if (endsAt.getTime() <= Date.now()) {
        ctx.addIssue({ code: "custom", message: "That date has already passed. Pick today or a later day, or leave it empty." });
        return z.NEVER;
      }
      return endsAt;
    }),
});
