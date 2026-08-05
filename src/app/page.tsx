import { redirect } from "next/navigation";
import { auth } from "@/auth";

// The bare root route has no content of its own — it just routes visitors
// to the right starting point depending on whether they're signed in.
export default async function RootPage() {
  const session = await auth();
  redirect(session?.user ? "/home" : "/login");
}
