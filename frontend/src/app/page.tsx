"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSiteAuthenticated } from "@/lib/site-auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (isSiteAuthenticated()) {
      router.replace("/dashboard");
    } else {
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full" />
    </div>
  );
}
