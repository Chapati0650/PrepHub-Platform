import Link from "next/link";

/**
 * Shown only when the Owner is previewing the administrator area.
 *
 * Plain links rather than a <select>: the school is a URL parameter, so each
 * option is a real navigable address the Owner can bookmark or paste into a
 * demo, and there is no client state to go stale. Also says plainly that the
 * preview is read-only, because the write actions refuse it and a disabled
 * button with no explanation is the worse version of that.
 */
export function OwnerSchoolSwitcher({
  basePath,
  schools,
  currentSchoolId,
}: {
  basePath: string;
  schools: { id: string; name: string }[];
  currentSchoolId: string | null;
}) {
  return (
    <div className="rounded-xl border border-marker/60 bg-surface-tint p-4">
      <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        Owner preview · read-only
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        This is what a School Administrator at this campus sees. Publishing and editing are
        disabled here.
      </p>
      {schools.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {schools.map((s) => (
            <Link
              key={s.id}
              href={`${basePath}?school=${s.id}`}
              aria-current={s.id === currentSchoolId ? "page" : undefined}
              className={
                s.id === currentSchoolId
                  ? "rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-sm hover:bg-muted"
              }
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}
      {schools.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          No schools exist yet. Create one under Schools to preview this area.
        </p>
      )}
    </div>
  );
}
