import Link from "next/link";
import { shortCampusName } from "@/lib/admin/campus-names";

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
    <div className="rounded-xl border border-marker/60 bg-surface-tint p-4 print:hidden">
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

/**
 * A district administrator's campus choice. Real links like the Owner's
 * switcher, so a campus view is a bookmarkable address. `allowAll` adds the
 * "All campuses" link back to the district overview (the Overview only).
 */
export function DistrictCampusSwitcher({
  basePath,
  districtName,
  campuses,
  currentSchoolId,
  allowAll = false,
}: {
  basePath: string;
  districtName: string;
  campuses: { id: string; name: string }[];
  currentSchoolId: string | null;
  allowAll?: boolean;
}) {
  const pill = (current: boolean) =>
    current
      ? "rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
      : "rounded-full border border-border px-3 py-1 text-sm hover:bg-muted";
  return (
    <nav aria-label="Campus" className="rounded-xl border border-border bg-surface-tint p-4 print:hidden">
      <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{districtName}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {currentSchoolId ? "Viewing one campus. Choose another, or go back to the whole district." : "Choose a campus."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {allowAll ? (
          <Link href="/admin" aria-current={currentSchoolId ? undefined : "page"} className={pill(!currentSchoolId)}>
            Whole district
          </Link>
        ) : (
          <Link href="/admin" className={pill(false)}>
            Whole district
          </Link>
        )}
        {campuses.map((c) => (
          <Link
            key={c.id}
            href={`${basePath}?school=${c.id}`}
            aria-current={c.id === currentSchoolId ? "page" : undefined}
            className={pill(c.id === currentSchoolId)}
          >
            {shortCampusName(c.name, campuses.map((x) => x.name))}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** What a single-campus page shows a district administrator who hasn't picked a campus yet. */
export function PickCampusPrompt({
  basePath,
  districtName,
  campuses,
  what,
}: {
  basePath: string;
  districtName: string;
  campuses: { id: string; name: string }[];
  what: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
        <h1 className="text-page-title">Choose a campus</h1>
        <p className="mt-3 text-lg text-foreground/75">
          {what} belongs to one campus at a time. Pick a campus in {districtName} to see it. The district totals are on
          the Overview.
        </p>
      </div>
      <DistrictCampusSwitcher basePath={basePath} districtName={districtName} campuses={campuses} currentSchoolId={null} />
    </div>
  );
}
