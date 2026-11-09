/**
 * Demo accounts are the ones the demo generators (scripts/demo-houston.ts,
 * scripts/demo-district.ts) create: every address is on example.com or one of
 * its subdomains (reserved by RFC 2606, so no mail is ever delivered and no
 * real person can own one). That domain is the single marker, so this is the
 * one place that decides "is this a demo account".
 */
export function isDemoAccount(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain === "example.com" || domain.endsWith(".example.com");
}

/**
 * The shared logins a district is handed for the Houston demo (scripts/demo-houston.ts ACCOUNTS), plus
 * its fictional campus addresses. Narrower than `isDemoAccount` on purpose: the "don't break the shared
 * demo" guard (lib/demo-guard.ts) must not stop the e2e suite's own example.com accounts from deleting
 * themselves or removing what they made.
 */
export const SHARED_DEMO_LOGINS: readonly string[] = [
  "hisd.admin@example.com",
  "hisd.campusadmin@example.com",
  "hisd.teacher@example.com",
  "hisd.student@example.com",
  "hisd.newstudent@example.com",
];

export function isSharedDemoLogin(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return SHARED_DEMO_LOGINS.includes(e) || e.endsWith("@hisd-demo.example.com");
}
