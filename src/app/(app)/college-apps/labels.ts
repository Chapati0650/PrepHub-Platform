import type { ApplicationItemKind, ApplicationPlan, ApplicationStatus } from "@/generated/prisma/client";

export const PLAN_LABEL: Record<ApplicationPlan, string> = {
  EARLY_DECISION: "Early Decision",
  EARLY_DECISION_2: "Early Decision II",
  EARLY_ACTION: "Early Action",
  RESTRICTIVE_EARLY_ACTION: "Restrictive Early Action",
  REGULAR_DECISION: "Regular Decision",
  ROLLING: "Rolling",
};

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  RESEARCHING: "Researching",
  APPLYING: "Applying",
  SUBMITTED: "Submitted",
  ACCEPTED: "Accepted",
  WAITLISTED: "Waitlisted",
  DENIED: "Denied",
  WITHDRAWN: "Withdrawn",
};

export const KIND_LABEL: Record<ApplicationItemKind, string> = {
  PROMPT: "Essay",
  RECOMMENDATION: "Recommendation",
  TEST_SCORES: "Test scores",
  FEE: "Fee",
  FINANCIAL_AID: "Financial aid",
  OTHER: "Other",
};

// Deadlines are stored at UTC midnight (see updateApplicationAction), so
// format in UTC — otherwise a US-evening viewer sees the day before.
export function formatDeadline(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function toDateInputValue(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
