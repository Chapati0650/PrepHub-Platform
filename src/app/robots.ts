import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXTAUTH_URL ?? "https://prephubtp.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/signup", "/login", "/terms", "/privacy"],
        // Everything a session gates, plus the API — none of it is a page
        // worth indexing and some of it (join links) is per-person.
        disallow: ["/home", "/practice", "/diagnostic", "/settings", "/owner", "/admin", "/api/", "/rush", "/800-club", "/curriculum", "/college-apps", "/progress", "/community", "/pricing", "/billing", "/access", "/onboarding"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
