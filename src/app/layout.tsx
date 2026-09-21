import type { Metadata } from "next";
import { Geist, Geist_Mono, Fredoka } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand display face — matches the rounded, confident wordmark used on
// PrepHub's YouTube channel. Reserved for headings, the logo lockup, and
// celebratory moments (score reveals, streak counts); body/UI text stays on
// Geist Sans so dense screens (tables, forms) stay crisp and legible.
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Titles and share cards were "PrepHub" with no Open Graph tags — every
// link posted under a YouTube video or in a Discord showed no preview. For
// a channel-driven funnel that is the front door. The OG image is rendered
// by src/app/opengraph-image.tsx.
const SITE_URL = process.env.NEXTAUTH_URL ?? "https://prephubtp.com";
const TITLE = "PrepHub — Adaptive Digital SAT prep from a perfect scorer";
const DESCRIPTION =
  "Take a free 21-question Diagnostic, get a predicted SAT score, and practice with sets built around the categories costing you the most. Your first set is free.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · PrepHub" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "PrepHub",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fredoka.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <Toaster>{children}</Toaster>
        </ThemeProvider>
      </body>
    </html>
  );
}
