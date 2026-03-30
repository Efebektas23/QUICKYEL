import { NextResponse } from "next/server";

const manifest = {
  name: "QuickYel - Expense Tracker",
  short_name: "QuickYel",
  description: "Expense automation for Canadian logistics",
  start_url: "/",
  display: "standalone",
  background_color: "#0B1120",
  theme_color: "#F59E0B",
  orientation: "portrait-primary",
  icons: [
    {
      src: "/icons/icon-192x192.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    },
  ],
  categories: ["business", "finance", "productivity"],
};

export async function GET() {
  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
