"use client";

import { useEffect } from "react";

// One beacon per mount. Public pages can't be attributed to a user
// server-side (no session), and this is the only way to see referrers.
// sendBeacon survives navigation and never blocks the page; if it's
// unavailable the view is simply not counted.
export function PageViewBeacon({ name = "page_view" }: { name?: "page_view" | "paywall_viewed" }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = JSON.stringify({
      name,
      path: window.location.pathname,
      referrer: document.referrer || null,
      utmSource: params.get("utm_source"),
    });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/beacon", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/beacon", { method: "POST", body: payload, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
    }
  }, [name]);
  return null;
}
