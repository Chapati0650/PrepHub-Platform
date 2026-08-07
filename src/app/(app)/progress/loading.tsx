import { Skeleton } from "@/components/ui/skeleton";

export default function ProgressLoading() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      <Skeleton className="h-8 w-48" />

      <div className="rounded-lg border border-border p-6">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-2 h-10 w-56" />
        <Skeleton className="mt-3 h-2 w-full rounded-full" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
