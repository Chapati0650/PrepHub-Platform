import type { MetadataRoute } from "next";

// The public pages only. Everything under (app) is behind a session and
// must never be listed; robots.ts disallows it explicitly as well.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXTAUTH_URL ?? "https://prephubtp.com";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.1 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.1 },
  ];
}
