import type { ApplicationPlatform } from "@/generated/prisma/client";

// The shared essays each application platform asks for — written once and
// reused across every college on that platform, so they are seeded as
// *student-level* checklist items (applicationId null) at onboarding, not
// copied per college.
//
// VERIFY EVERY AUGUST against the platforms' own announcements and bump
// `cycle`. Common App has held these seven prompts unchanged since 2021–22
// and confirmed them again for 2026–27; the UC PIQs have been stable for
// years. If a platform changes a prompt mid-cycle, students who already
// onboarded keep the text they were seeded with — their items are copies.
export const PLATFORM_PROMPTS_CYCLE = 2027;

export type PlatformPrompt = { title: string; text: string; wordLimit: number | null };

export const PLATFORM_PROMPTS: Record<ApplicationPlatform, { intro: string; prompts: PlatformPrompt[] }> = {
  COMMON_APP: {
    intro: "One personal statement, 650 words, sent to every Common App college. Answer any one of the seven prompts.",
    prompts: [
      {
        title: "Common App personal statement",
        text:
          "Choose one of the seven Common App prompts (650 words max):\n" +
          "1. Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. If this sounds like you, then please share your story.\n" +
          "2. The lessons we take from obstacles we encounter can be fundamental to later success. Recount a time when you faced a challenge, setback, or failure. How did it affect you, and what did you learn from the experience?\n" +
          "3. Reflect on a time when you questioned or challenged a belief or idea. What prompted your thinking? What was the outcome?\n" +
          "4. Reflect on something that someone has done for you that has made you happy or thankful in a surprising way. How has this gratitude affected or motivated you?\n" +
          "5. Discuss an accomplishment, event, or realization that sparked a period of personal growth and a new understanding of yourself or others.\n" +
          "6. Describe a topic, idea, or concept you find so engaging that it makes you lose all track of time. Why does it captivate you? What or who do you turn to when you want to learn more?\n" +
          "7. Share an essay on any topic of your choice. It can be one you've already written, one that responds to a different prompt, or one of your own design.",
        wordLimit: 650,
      },
    ],
  },
  UC_APPLICATION: {
    intro: "Answer four of the eight Personal Insight Questions, 350 words each. One application covers every UC campus.",
    prompts: [
      { title: "UC PIQ 1 — Leadership", text: "Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes or contributed to group efforts over time.", wordLimit: 350 },
      { title: "UC PIQ 2 — Creativity", text: "Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. Describe how you express your creative side.", wordLimit: 350 },
      { title: "UC PIQ 3 — Talent or skill", text: "What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time?", wordLimit: 350 },
      { title: "UC PIQ 4 — Educational opportunity or barrier", text: "Describe how you have taken advantage of a significant educational opportunity or worked to overcome an educational barrier you have faced.", wordLimit: 350 },
      { title: "UC PIQ 5 — Significant challenge", text: "Describe the most significant challenge you have faced and the steps you have taken to overcome this challenge. How has this challenge affected your academic achievement?", wordLimit: 350 },
      { title: "UC PIQ 6 — Academic subject", text: "Think about an academic subject that inspires you. Describe how you have furthered this interest inside and/or outside of the classroom.", wordLimit: 350 },
      { title: "UC PIQ 7 — Community", text: "What have you done to make your school or your community a better place?", wordLimit: 350 },
      { title: "UC PIQ 8 — Anything else", text: "Beyond what has already been shared in your application, what do you believe makes you a strong candidate for admissions to the University of California?", wordLimit: 350 },
    ],
  },
  COALITION: {
    intro: "One essay, 500–650 words recommended, sent to every Coalition (Scoir) college. Answer any one prompt.",
    prompts: [
      {
        title: "Coalition application essay",
        text:
          "Choose one Coalition prompt (500–650 words recommended):\n" +
          "1. Tell a story from your life, describing an experience that either demonstrates your character or helped to shape it.\n" +
          "2. What interests or excites you? How does it shape who you are now or who you might become in the future?\n" +
          "3. Describe a time when you had a positive impact on others. What were the challenges? What were the rewards?\n" +
          "4. Has there been a time when an idea or belief of yours was questioned? How did you respond? What did you learn?\n" +
          "5. What success have you achieved or obstacle have you faced? What advice would you give a sibling or friend going through a similar experience?\n" +
          "6. Submit an essay on a topic of your choice.",
        wordLimit: 650,
      },
    ],
  },
  APPLY_TEXAS: {
    intro: "Topic A is required by most Texas public universities; some also ask for Topics B or C, or their own short answers.",
    prompts: [
      {
        title: "ApplyTexas Essay A",
        text: "Tell us your story. What unique opportunities or challenges have you experienced throughout your high school career that have shaped who you are today?",
        wordLimit: null,
      },
    ],
  },
  OTHER: { intro: "", prompts: [] },
};

export const PLATFORM_LABEL: Record<ApplicationPlatform, string> = {
  COMMON_APP: "Common App",
  UC_APPLICATION: "UC Application",
  COALITION: "Coalition (Scoir)",
  APPLY_TEXAS: "ApplyTexas",
  OTHER: "College's own application",
};

export const PLATFORM_ORDER: ApplicationPlatform[] = ["COMMON_APP", "UC_APPLICATION", "COALITION", "APPLY_TEXAS", "OTHER"];

export function isPlatform(v: unknown): v is ApplicationPlatform {
  return typeof v === "string" && (PLATFORM_ORDER as string[]).includes(v);
}

// The financial-aid items every applicant tracks regardless of platform.
export const FINANCIAL_AID_ITEMS: { title: string; detail: string }[] = [
  { title: "FAFSA", detail: "Free Application for Federal Student Aid. Opens in the fall; many colleges set their own priority deadline." },
  { title: "CSS Profile", detail: "Required by many private colleges for institutional aid. Check each college's financial-aid page for whether it's required and when." },
];
