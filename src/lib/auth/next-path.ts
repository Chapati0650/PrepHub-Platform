/**
 * Where to send someone after they sign in, when they were on their way
 * somewhere: a homework link in an email, a reminder's "your set is ready".
 * Only a path on this site — anything that could leave it ("//evil.com",
 * "/\evil.com", a scheme) is refused, so a crafted login link can't bounce a
 * student to a look-alike page after they type their password. The auth
 * pages themselves are refused too, so it can't loop.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Backslashes (browsers read "/\host" as "//host") and control characters.
  if (/[\u0000-\u001f\\]/.test(raw)) return null;
  const path = raw.split(/[?#]/)[0];
  if (/^\/(login|signup|reset-password|api)(\/|$)/.test(path)) return null;
  return raw;
}
