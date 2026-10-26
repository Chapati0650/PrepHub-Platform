import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the moment a sidebar link is clicked, for any page without a loading
 * state of its own. Without one, a navigation gave no sign anything was
 * happening for the whole server render — over a second and a half on a cold
 * start — and students clicked again. Deliberately generic: a heading and a
 * few blocks, rather than guessing at each page's shape.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}
