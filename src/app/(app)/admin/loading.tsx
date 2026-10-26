import { Skeleton } from "@/components/ui/skeleton";
import { StaffPage } from "@/components/staff/staff-ui";

/**
 * Shown while an administrator page is put together. The admin pages count a
 * whole school's activity before they can draw anything, which on a cold
 * start is a few seconds — long enough for someone to think the click didn't
 * work. So this says, in words, that it's coming, in the same shape the pages
 * use: the tinted header band, then a row of figures.
 */
export default function AdminLoading() {
  return (
    <StaffPage>
      <div className="rounded-3xl bg-surface-tint p-6 sm:p-8" aria-busy="true" aria-live="polite">
        <Skeleton className="h-3 w-24" />
        <p className="mt-3 text-lg text-foreground/75">Loading your school&apos;s information. This can take a few seconds.</p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 bg-background p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-2xl" />
    </StaffPage>
  );
}
