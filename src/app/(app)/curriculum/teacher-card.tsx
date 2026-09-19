// "Meet your teacher" — the reference's instructor card. The bio is the
// Owner's own wording (2026-09-19), used as given apart from spelling. The
// credentials list keeps the 8M+ views figure the public landing page
// states, so the site never makes two different claims about the same
// channel — the bio's "hundreds of thousands of students" is a different
// measure, not a competing one. The photo is a real headshot committed to
// public/teacher.jpg (the Owner supplied it 2026-09-19) — a fixed brand
// asset, not the Owner account's Google avatar, which could change or be
// absent.
export const TEACHER = {
  name: "Prithviraj Chauhan",
  photo: "/teacher.jpg",
  bio: "Prithviraj is the founder of PrepHub and teaches every lesson in it. He's a perfect SAT and PSAT scorer, and a National Merit Scholar. He's reached hundreds of thousands of students through PrepHub, and received admission to Johns Hopkins, UC Berkeley, Rice, UCLA, and more.",
  credentials: ["Perfect SAT & PSAT scores", "National Merit Scholar", "8M+ views teaching the SAT"],
} as const;

export function TeacherCard() {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="font-heading text-lg font-semibold tracking-tight">Meet your teacher</h2>
      <div className="mt-5 flex items-center gap-4">
        {/* object-top: the headshot is portrait-framed with the face in the
            upper half, so a centered circular crop would cut through it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={TEACHER.photo}
          alt={`${TEACHER.name}, founder and teacher at PrepHub`}
          width={80}
          height={80}
          className="size-20 shrink-0 rounded-full object-cover object-top ring-4 ring-surface-tint"
        />
        <div>
          <p className="font-heading text-xl font-semibold tracking-tight">{TEACHER.name}</p>
          <p className="text-sm text-muted-foreground">Founder &amp; teacher, PrepHub</p>
        </div>
      </div>
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{TEACHER.bio}</p>
      <ul className="mt-5 flex flex-col divide-y divide-border border-t border-border text-sm">
        {TEACHER.credentials.map((c) => (
          <li key={c} className="py-2.5">
            {c}
          </li>
        ))}
      </ul>
    </section>
  );
}
