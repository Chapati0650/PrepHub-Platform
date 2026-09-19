import { prisma } from "@/lib/prisma";

// "Meet your teacher" — the reference's instructor card. The bio is the
// Owner's own wording (2026-09-19), used as given apart from spelling. The
// credentials list keeps the 8M+ views figure the public landing page
// states, so the site never makes two different claims about the same
// channel — the bio's "hundreds of thousands of students" is a different
// measure, not a competing one. The photo is the Owner account's Google
// image when one is set, initials otherwise.
export const TEACHER = {
  name: "Prithviraj Chauhan",
  bio: "Prithviraj is the founder of PrepHub and teaches every lesson in it. He's a perfect SAT and PSAT scorer, and a National Merit Scholar. He's reached hundreds of thousands of students through PrepHub, and received admission to Johns Hopkins, UC Berkeley, Rice, UCLA, and more.",
  credentials: ["Perfect SAT & PSAT scores", "National Merit Scholar", "8M+ views teaching the SAT"],
} as const;

export async function TeacherCard() {
  // Single-owner product (CLAUDE.md): there is exactly one OWNER row.
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { image: true } });
  const initials = TEACHER.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="font-heading text-lg font-semibold tracking-tight">Meet your teacher</h2>
      <div className="mt-5 flex items-center gap-4">
        {owner?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={owner.image} alt="" className="size-20 shrink-0 rounded-full object-cover ring-4 ring-surface-tint" />
        ) : (
          <span
            aria-hidden
            className="flex size-20 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-2xl font-semibold text-primary-foreground ring-4 ring-surface-tint"
          >
            {initials}
          </span>
        )}
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
