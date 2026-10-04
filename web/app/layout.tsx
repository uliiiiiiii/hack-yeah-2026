import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: "Ciszej",
  description:
    "Plan a walk in Kraków that fits your senses: avoid noise, crowds, or pick well-lit streets. We mark where we have no data.",
};

// Orientation is not locked and the page stays zoomable (TYP-06, TYP-01).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1f23" },
  ],
};

// Applied before first paint so theme/text-size/motion never flash (COL-07, PER-03).
const THEME_INIT = `
(function () {
  try {
    var s = JSON.parse(localStorage.getItem("krk.settings") || "{}");
    var root = document.documentElement;
    if (s.theme === "light" || s.theme === "dark") root.setAttribute("data-theme", s.theme);
    else root.setAttribute("data-theme", "system");
    if (s.textSize) root.setAttribute("data-text-size", s.textSize);
    if (s.reduceMotion) root.setAttribute("data-reduce-motion", "on");
    if (s.lowStim) root.setAttribute("data-low-stim", "on");
    if (s.language) root.setAttribute("lang", s.language);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
