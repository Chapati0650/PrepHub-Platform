import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { auth } from "@/auth";
import { getLessonForOwner } from "@/lib/curriculum/owner";
import { PageHeader } from "@/components/page-header";
import { LessonEditor } from "./lesson-editor";
import { ConfirmSubmitButton } from "../confirm-submit-button";
import { deleteLessonAction } from "../actions";

export default async function OwnerLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") redirect("/home");

  const { lessonId } = await params;
  const lesson = await getLessonForOwner(lessonId);
  if (!lesson) notFound();

  return (
    <div className="flex flex-col gap-8">
      <Link href="/owner/content/curriculum" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All modules
      </Link>

      <PageHeader eyebrow={lesson.module.title} title={lesson.title}>
        <form action={deleteLessonAction}>
          <input type="hidden" name="lessonId" value={lesson.id} />
          <ConfirmSubmitButton
            confirm={`Delete the lesson "${lesson.title}"? Students lose access immediately and their completion of it is removed. This cannot be undone.`}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Delete lesson
          </ConfirmSubmitButton>
        </form>
      </PageHeader>

      <LessonEditor
        lesson={{
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          videoSource: lesson.videoSource,
          youtubeVideoId: lesson.youtubeVideoId,
          mediaAssetId: lesson.mediaAssetId,
          mediaAsset: lesson.mediaAsset,
          durationSeconds: lesson.durationSeconds,
          isFree: lesson.isFree,
          publishedAt: lesson.publishedAt,
        }}
      />
    </div>
  );
}
