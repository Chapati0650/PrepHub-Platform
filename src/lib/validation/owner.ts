import { z } from "zod";

const dateInput = z.coerce.date();

export const createOrganizationSchema = z.object({
  organizationType: z.enum(["SCHOOL", "DISTRICT"]),
  officialName: z.string().trim().min(1, "Name is required"),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  schoolYear: z.string().trim().min(1, "School year is required"),
  contractStartDate: dateInput,
  contractEndDate: dateInput,
  parentDistrictId: z.string().trim().optional(),
});

export const updateOrganizationSchema = z.object({
  officialName: z.string().trim().min(1, "Name is required"),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State is required"),
  schoolYear: z.string().trim().min(1, "School year is required"),
  contractStartDate: dateInput,
  contractEndDate: dateInput,
  internalNotes: z.string().trim().optional(),
});

export const updateCommunityGoalSchema = z.object({
  communityGoalMetric: z.enum(["QUESTIONS_ANSWERED", "STUDY_HOURS", "ADAPTIVE_SESSIONS", ""]),
  communityGoalTarget: z.string().trim().optional(),
});

export const updateTotalEnrollmentSchema = z.object({
  totalEnrollment: z.string().trim().optional(),
});

export const renewOrganizationSchema = z.object({
  contractStartDate: dateInput,
  contractEndDate: dateInput,
});

export const createAdministratorSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  scope: z.enum(["SCHOOL", "DISTRICT"]),
});

export const manualActivationSchema = z.object({
  studentEmail: z.string().trim().toLowerCase().email("Enter a valid login email"),
  schoolId: z.string().trim().min(1, "Select a school"),
  verifiedSchoolEmail: z.string().trim().toLowerCase().email("Enter a valid school email"),
  currentGrade: z.coerce.number().int().min(9).max(12),
  expectedGraduationYear: z.coerce.number().int().min(2020).max(2100),
});

export const schoolTransferSchema = z.object({
  newSchoolId: z.string().trim().min(1, "Select the new school"),
  newVerifiedSchoolEmail: z.string().trim().toLowerCase().email("Enter a valid school email"),
});

export const graduationInfoSchema = z.object({
  currentGrade: z.coerce.number().int().min(9).max(12),
  expectedGraduationYear: z.coerce.number().int().min(2020).max(2100),
});
