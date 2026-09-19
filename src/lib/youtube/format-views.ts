// YouTube-style compact view counts: 980 → "980", 45,300 → "45K",
// 1,234,567 → "1.2M". One decimal only when it changes the reading (1.2M,
// not 1.0M), matching how YouTube itself prints the number under a video so
// a visitor who checks the channel sees the same figure.
export function formatViewCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1_000) return String(Math.floor(n));
  const units: [number, string][] = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const value = n / size;
      // Under 10 of a unit, one decimal is meaningful (1.2M); at or above
      // 10 it isn't (12M, not 12.3M) — YouTube's own rule.
      const rounded = value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value);
      const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${text}${suffix}`;
    }
  }
  return String(n);
}
