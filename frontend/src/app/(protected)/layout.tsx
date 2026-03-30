"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/ui/Header";
import { MobileBottomNav } from "@/components/ui/MobileBottomNav";
import { isSiteAuthenticated } from "@/lib/site-auth";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (isSiteAuthenticated()) {
      setAllowed(true);
    } else {
      router.replace("/login");
    }
  }, [router]);

  if (allowed !== true) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full" />
      </div>
    );
  }

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
