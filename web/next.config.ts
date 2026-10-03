import type { NextConfig } from "next";

// Static export ("out/") so Capacitor can bundle the app into a native WebView.
// The app is a single client-rendered page that talks to the API at runtime via
// fetch, so there is no server component to lose by exporting statically.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
