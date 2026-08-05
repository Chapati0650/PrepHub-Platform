import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logUnauthorizedAccess } from "@/lib/logger";

// PRD-017 §2: this whole area is Owner-only. Server-side check — the (app)
// layout already confirms *a* session exists; this confirms the *role*.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted to view an Owner-only page", {
      accountId: session?.user.id,
      role: session?.user.role,
    });
    redirect("/home");
  }

  return <>{children}</>;
}
