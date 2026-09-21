import { ImageResponse } from "next/og";

// The share card for every link to the site (Next serves this at
// /opengraph-image and wires it into the metadata automatically). Brand
// surface-deep block, the logomark drawn inline (the SVG in logo.tsx
// depends on CSS variables this renderer doesn't have), one claim, one
// promise. Kept to system fonts: a custom font here means fetching a
// file on every render of the card.
export const alt = "PrepHub — Adaptive Digital SAT prep from a perfect scorer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0b3a3a",
          color: "#f2fbfb",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2fd4de" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11 12 3l9 8" />
            <path d="M5 10v10h14V10" />
            <path d="M12 12v6" />
            <path d="M8.5 13.5c1.2-.8 2.3-.8 3.5 0 1.2-.8 2.3-.8 3.5 0" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>PrepHub</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 1000 }}>
            Your personalized study platform for the Digital SAT
          </div>
          <div style={{ fontSize: 30, color: "#b9e6e8", maxWidth: 980, lineHeight: 1.3 }}>
            Free 21-question Diagnostic → predicted score → practice built around what&apos;s costing you points.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#b9e6e8" }}>
          <div>Crafted by perfect scorers · 8M+ views on YouTube</div>
          <div>prephubtp.com</div>
        </div>
      </div>
    ),
    size,
  );
}
