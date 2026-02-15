"use client";

import { Header } from "@/components/ui/Header";
import { MobileBottomNav } from "@/components/ui/MobileBottomNav";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Closed system — no auth check
  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8">
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
