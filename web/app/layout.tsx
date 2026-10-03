import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kraków walking routes",
  description: "Click two points in Kraków to get a walking route from an open-source router.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
