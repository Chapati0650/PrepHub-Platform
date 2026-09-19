// What this school year is for, by grade. Freshmen and sophomores have
// nothing to *track* yet — showing them an empty application tracker would
// read as pressure — so they get this instead, plus the ability to start a
// college list. Juniors get it alongside the tracker; seniors get the
// tracker, deadline-first.
export const YEAR_CHECKLIST: Record<9 | 10 | 11 | 12, { heading: string; items: string[] }> = {
  9: {
    heading: "Freshman year is for foundations.",
    items: [
      "Take the most rigorous classes you can do well in — colleges read the whole transcript.",
      "Pick two or three activities you genuinely like and go deep, not wide.",
      "Start a running list of things you've done: awards, roles, projects. You'll forget by senior year.",
      "Take the PrepHub Diagnostic once, just to see where you stand. No pressure — it's three years away.",
    ],
  },
  10: {
    heading: "Sophomore year is for depth.",
    items: [
      "Take the PSAT 10 if your school offers it; junior-year PSAT/NMSQT is the one that counts for National Merit.",
      "Lean into the activities from freshman year — leadership and impact come from staying, not switching.",
      "Talk to your counselor about junior-year courses: AP/IB/dual-credit choices are made now.",
      "Keep the running list of accomplishments current.",
    ],
  },
  11: {
    heading: "Junior year is when it starts to count.",
    items: [
      "Take the PSAT/NMSQT in October — it's the National Merit qualifier.",
      "Plan your SAT dates: most juniors test in spring and again in fall of senior year.",
      "Build a first college list — 8 to 12 schools across likely, target and reach — and use score fit to keep it honest.",
      "Decide which two teachers you'll ask for recommendations, and ask before summer.",
      "Visit campuses if you can; take notes for the \"Why us?\" essays you'll write next year.",
      "Draft your personal statement over the summer. August is when everything else arrives.",
    ],
  },
  12: {
    heading: "Senior year is deadlines.",
    items: [
      "Finalize your list and every deadline — early plans are due November 1st at most schools.",
      "Send test scores to every college that wants them; check each one's policy.",
      "Confirm recommenders have what they need, and give them your deadlines.",
      "FAFSA opens in the fall; many colleges set a priority deadline. CSS Profile if a college requires it.",
      "Finish the personal statement before supplements — it's the one essay every school reads.",
    ],
  },
};
