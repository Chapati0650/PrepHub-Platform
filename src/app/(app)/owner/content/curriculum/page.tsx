import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { auth } from "@/auth";
import { getCurriculumForOwner } from "@/lib/curriculum/owner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ModuleForms, NewLessonForm } from "./module-forms";
import { ConfirmSubmitButton } from "./confirm-submit-button";
import { deleteModuleAction, moveModuleAction, moveLessonAction } from "./actions";

function formatMinutes(seconds: number | null): string {
  if (!seconds) return "—";
  return `${Math.round(seconds / 60)}m`;
}

// PRD-015-style Owner surface for the Curriculum: modules and their lessons,
// in display order, with the controls to add, reorder and delete. Lesson
// content itself (video, description, publish) lives on the lesson page.
export default async function OwnerCurriculumPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/home");

  const modules = await getCurriculumForOwner();
  const lessonCount = modules.reduce((n, m) => n + m.lessons.length, 0);
  const publishedCount = modules.reduce((n, m) => n + m.lessons.filter((l) => l.publishedAt).length, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Content"
        title="The Curriculum"
        description={`${modules.length} module${modules.length === 1 ? "" : "s"} · ${lessonCount} lesson${lessonCount === 1 ? "" : "s"} · ${publishedCount} published. Students see published lessons only.`}
      >
        <Link href="/curriculum" className="text-sm underline underline-offset-4" target="_blank" rel="noreferrer">
          View as a student
        </Link>
      </PageHeader>

      <ModuleForms />

      {modules.length === 0 ? (
        <div className="rounded-2xl bg-surface-tint p-6 text-sm text-muted-foreground">
          No modules yet. Add one above, then add lessons to it.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {modules.map((m, mi) => (
            <section key={m.id} className="rounded-2xl border border-border">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground">
                  {String(mi + 1).padStart(2, "0")}
                </span>
                <h2 className="font-heading font-semibold">{m.title}</h2>
                <span className="text-sm text-muted-foreground">
                  {m.lessons.length} lesson{m.lessons.length === 1 ? "" : "s"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <form action={moveModuleAction}>
                    <input type="hidden" name="moduleId" value={m.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button type="submit" variant="ghost" size="icon-sm" disabled={mi === 0} aria-label={`Move ${m.title} up`}>
                      <ArrowUp className="size-4" />
                    </Button>
                  </form>
                  <form action={moveModuleAction}>
                    <input type="hidden" name="moduleId" value={m.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button type="submit" variant="ghost" size="icon-sm" disabled={mi === modules.length - 1} aria-label={`Move ${m.title} down`}>
                      <ArrowDown className="size-4" />
                    </Button>
                  </form>
                  {/* Deleting a module deletes its lessons. Confirmation is the
                      browser's own dialog: the effect is stated, and it is
                      the Owner's own authored structure, not student data. */}
                  <form action={deleteModuleAction}>
                    <input type="hidden" name="moduleId" value={m.id} />
                    <ConfirmSubmitButton
                      confirm={`Delete the module "${m.title}" and its ${m.lessons.length} lesson${m.lessons.length === 1 ? "" : "s"}? Students lose access immediately. This cannot be undone.`}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${m.title}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>

              {m.lessons.length > 0 && (
                <ol className="divide-y divide-border">
                  {m.lessons.map((l, li) => (
                    <li key={l.id} className="flex items-center gap-4 px-5 py-3">
                      <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">{li + 1}</span>
                      <Link href={`/owner/content/curriculum/${l.id}`} className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline">
                        {l.title}
                      </Link>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                        {l.videoSource === "YOUTUBE" ? (l.youtubeVideoId ? "YouTube" : "No video") : l.mediaAssetId ? "Upload" : "No video"}
                        {" · "}
                        {formatMinutes(l.durationSeconds)}
                        {l.isFree && " · Free"}
                      </span>
                      <span
                        className={
                          l.publishedAt
                            ? "shrink-0 rounded-full border border-green-600/40 bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:border-green-500/40 dark:bg-green-900/50 dark:text-green-300"
                            : "shrink-0 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        }
                      >
                        {l.publishedAt ? "Published" : "Draft"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <form action={moveLessonAction}>
                          <input type="hidden" name="lessonId" value={l.id} />
                          <input type="hidden" name="direction" value="up" />
                          <Button type="submit" variant="ghost" size="icon-sm" disabled={li === 0} aria-label={`Move ${l.title} up`}>
                            <ArrowUp className="size-4" />
                          </Button>
                        </form>
                        <form action={moveLessonAction}>
                          <input type="hidden" name="lessonId" value={l.id} />
                          <input type="hidden" name="direction" value="down" />
                          <Button type="submit" variant="ghost" size="icon-sm" disabled={li === m.lessons.length - 1} aria-label={`Move ${l.title} down`}>
                            <ArrowDown className="size-4" />
                          </Button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              <div className="border-t border-border px-5 py-4">
                <NewLessonForm moduleId={m.id} />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
