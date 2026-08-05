import { redirect } from "next/navigation";

// PRD-015 §3: Questions is the default landing page for the content dashboard.
export default function OwnerContentIndexPage() {
  redirect("/owner/content/questions");
}
