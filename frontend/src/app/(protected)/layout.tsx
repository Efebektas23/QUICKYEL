"use client";

import { Header } from "@/components/ui/Header";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Kapalı devre sistem - auth kontrolü yok
  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}
