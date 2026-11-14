import { describe, expect, it } from "vitest";
import {
  REMINDER_MESSAGE_MAX,
  REMINDER_SUBJECT_MAX,
  cleanReminderInput,
  defaultReminder,
  reminderEmail,
  reminderTemplateFor,
} from "@/lib/admin/reminder-message";

describe("reminderTemplateFor", () => {
  it("writes for the list it was opened from, and generally otherwise", () => {
    expect(reminderTemplateFor("NOT_STARTED")).toBe("NOT_STARTED");
    expect(reminderTemplateFor("GONE_QUIET")).toBe("GONE_QUIET");
    expect(reminderTemplateFor(undefined)).toBe("GENERAL");
  });
});

describe("defaultReminder", () => {
  it("tells a student who never started what the first step is", () => {
    const { subject, message } = defaultReminder("NOT_STARTED", "Northside High School");
    expect(subject).toContain("Northside High School");
    expect(message).toContain("Diagnostic");
    expect(message).toContain("15 minutes");
  });

  it("tells a student who stopped that their work is saved", () => {
    expect(defaultReminder("GONE_QUIET", "Northside").message).toContain("saved");
  });

  it("never claims anything about a student's scores", () => {
    for (const t of ["NOT_STARTED", "GONE_QUIET", "ACTIVE_THIS_WEEK", "GENERAL"] as const) {
      const { message } = defaultReminder(t, "Northside");
      expect(message).not.toMatch(/score (went|is|has)|improv|predicted/i);
    }
  });
});

describe("cleanReminderInput", () => {
  it("keeps the subject to one line and trims both", () => {
    expect(cleanReminderInput({ subject: "  Come back\r\nto PrepHub  ", message: "  Hi.  " })).toEqual({
      subject: "Come back to PrepHub",
      message: "Hi.",
    });
  });

  it("closes up runs of blank lines in the message but keeps paragraphs", () => {
    expect(cleanReminderInput({ subject: "S", message: "One.\r\n\r\n\r\n\r\nTwo." })).toEqual({ subject: "S", message: "One.\n\nTwo." });
  });

  it("refuses an empty subject or message, or anything that isn't text", () => {
    expect(cleanReminderInput({ subject: " ", message: "x" })).toHaveProperty("error");
    expect(cleanReminderInput({ subject: "x", message: "\n\n" })).toHaveProperty("error");
    expect(cleanReminderInput({ subject: 5, message: { a: 1 } })).toHaveProperty("error");
  });

  it("refuses text over the limits", () => {
    expect(cleanReminderInput({ subject: "s".repeat(REMINDER_SUBJECT_MAX + 1), message: "x" })).toHaveProperty("error");
    expect(cleanReminderInput({ subject: "s", message: "m".repeat(REMINDER_MESSAGE_MAX + 1) })).toHaveProperty("error");
    expect(cleanReminderInput({ subject: "s".repeat(REMINDER_SUBJECT_MAX), message: "m".repeat(REMINDER_MESSAGE_MAX) })).not.toHaveProperty("error");
  });
});

describe("reminderEmail", () => {
  const base = { schoolName: "Northside High School", senderName: "Jordan", subject: "Hello", message: "Come back.", site: "https://prephubtp.com" };

  it("greets the student by first name, links in, and says who sent it", () => {
    const { subject, text } = reminderEmail({ ...base, firstName: "Maya" });
    expect(subject).toBe("Hello");
    expect(text.startsWith("Hi Maya,\n\nCome back.")).toBe(true);
    expect(text).toContain("https://prephubtp.com/home");
    expect(text).toContain("Jordan, Northside High School");
    expect(text).toContain("on behalf of Northside High School");
  });

  it("falls back to a neutral greeting for a blank name", () => {
    expect(reminderEmail({ ...base, firstName: "  " }).text.startsWith("Hi there,")).toBe(true);
  });
});
