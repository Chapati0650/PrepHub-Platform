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
