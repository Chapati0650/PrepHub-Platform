import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { ClassRushError, getClassRushConsole } from "@/lib/rush/class-rush";
import { ClassRushHost } from "./class-rush-host";

export const metadata = { title: "Class Rush" };

// The teacher's Class Rush screen, built to be projected (a focus-mode route,
// no sidebar). It polls the private console route; see class-rush-host.tsx.
export default async function ClassRushHostPage({ params }: { params: Promise<{ rushId: string }> }) {
  const context = await requireTeacher();
  const { rushId } = await params;
  let initial;
  try {
    initial = await getClassRushConsole(context, rushId);
  } catch (err) {
    if (err instanceof ClassRushError) notFound();
    throw err;
  }
  const site = (process.env.NEXTAUTH_URL ?? "https://prephubtp.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return <ClassRushHost initial={initial} rushId={rushId} site={site} />;
}
