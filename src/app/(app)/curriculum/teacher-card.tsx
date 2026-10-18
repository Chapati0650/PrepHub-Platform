import { TEACHER } from "@/lib/teacher";

// "Meet your teacher" - the reference's instructor card. Its content is
// the shared TEACHER constant, which the public For Schools page also
// renders.
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
