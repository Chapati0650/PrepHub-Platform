/**
 * The one description of who makes PrepHub.
 *
 * Lives in lib rather than beside the Curriculum's card because the public
 * For Schools page states the same thing, and two copies would eventually
 * disagree about the same person. The bio is the Owner's own wording
 * (2026-09-19), used as given apart from spelling. The credentials keep the
 * 8M+ views figure the landing page states, so the site never makes two
 * different claims about the same channel; the bio's "hundreds of thousands
 * of students" is a different measure, not a competing one. The photo is a
 * real headshot committed to public/teacher.jpg, a fixed brand asset rather
 * than the Owner account's Google avatar, which could change or be absent.
 */
export const TEACHER = {
  name: "Prithviraj Chauhan",
  photo: "/teacher.jpg",
  bio: "Prithviraj is the founder of PrepHub and teaches every lesson in it. He's a perfect SAT and PSAT scorer, and a National Merit Scholar. He's reached hundreds of thousands of students through PrepHub, and received admission to Johns Hopkins, UC Berkeley, Rice, UCLA, and more.",
  credentials: ["Perfect SAT & PSAT scores", "National Merit Scholar", "8M+ views teaching the SAT"],
} as const;
