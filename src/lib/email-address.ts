/**
 * Whether an address is worth handing to the provider at all.
 *
 * Not RFC 5322 — the provider is the real judge — only the obviously broken:
 * whitespace inside, no `@` or more than one, characters that would split or
 * corrupt a header (`<>,;:"` and friends — a comma is two recipients), an
 * empty or dotless domain, an empty label, a one-letter top-level domain.
 * Resend refuses a whole batch for one bad address, so each of these used to
 * take ninety-nine good ones down with it.
 */
export function isPlausibleEmailAddress(address: string): boolean {
  if (address.length > 254) return false;
  const match = /^([^\s@<>()[\],;:"\\]+)@([^\s@<>()[\],;:"\\]+)$/.exec(address);
  if (!match) return false;
  const [, local, domain] = match;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => label === "" || label.startsWith("-") || label.endsWith("-"))) return false;
  return /^[a-z0-9-]{2,}$/i.test(labels[labels.length - 1]);
}
