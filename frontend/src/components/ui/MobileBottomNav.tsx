"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Receipt,
  Camera,
  DollarSign,
  MoreHorizontal,
  FileText,
  Download,
  CreditCard,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import { AnimatePresence } from "framer-motion";

const mainTabs = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/upload", label: "Upload", icon: Camera, isFab: true },
  { href: "/revenue", label: "Revenue", icon: DollarSign },
  { href: "more", label: "More", icon: MoreHorizontal, isMore: true },
];

const moreItems = [
  { href: "/import", label: "Import Data", icon: Download },
  { href: "/export", label: "Export", icon: FileText },
  { href: "/cards", label: "Cards", icon: CreditCard },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);

  const isActive = (href: string) => {
    if (href === "more") {
      return moreItems.some((item) => pathname === item.href);
    }
    return pathname === href;
  };

  return (
    <>
      {/* More Menu Overlay */}
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
              onClick={() => setShowMore(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-20 right-4 z-50 md:hidden"
            >
              <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden min-w-[200px]">
                <div className="p-2">
                  {moreItems.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setShowMore(false)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                          active
                            ? "bg-amber-500/10 text-amber-500"
                            : "text-slate-300 hover:bg-slate-700"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden">
        <div className="bg-slate-950/95 backdrop-blur-xl border-t border-slate-800/80">
          <div className="flex items-end justify-around px-2 safe-bottom">
            {mainTabs.map((tab) => {
              const Icon = tab.icon;
              const active = isActive(tab.href);

              // FAB (Upload) button — center elevated button
              if (tab.isFab) {
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className="relative -mt-5 flex flex-col items-center group"
                  >
                    <motion.div
                      whileTap={{ scale: 0.9 }}
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all ${
                        active
                          ? "bg-gradient-to-br from-amber-400 to-amber-600 shadow-amber-500/40"
                          : "bg-gradient-to-br from-amber-500 to-amber-600 shadow-amber-500/25 group-hover:shadow-amber-500/40"
                      }`}
                    >
                      <Camera className="w-6 h-6 text-slate-950" />
                    </motion.div>
                    <span className={`text-[10px] mt-1 font-medium ${
                      active ? "text-amber-500" : "text-slate-500"
                    }`}>
                      Upload
                    </span>
                  </Link>
                );
              }

              // "More" button — opens popover
              if (tab.isMore) {
                return (
                  <button
                    key="more"
                    onClick={() => setShowMore(!showMore)}
                    className="flex flex-col items-center py-2 px-3 min-w-[60px]"
                  >
                    <div className={`p-1.5 rounded-xl transition-all ${
                      active || showMore ? "text-amber-500" : "text-slate-500"
                    }`}>
                      {showMore ? (
                        <X className="w-5 h-5" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>
                    <span className={`text-[10px] mt-0.5 font-medium ${
                      active || showMore ? "text-amber-500" : "text-slate-500"
                    }`}>
                      {tab.label}
                    </span>
                  </button>
                );
              }

              // Regular tab
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="flex flex-col items-center py-2 px-3 min-w-[60px]"
                >
                  <div className={`p-1.5 rounded-xl transition-all ${
                    active
                      ? "text-amber-500"
                      : "text-slate-500"
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className={`text-[10px] mt-0.5 font-medium ${
                    active ? "text-amber-500" : "text-slate-500"
                  }`}>
                    {tab.label}
                  </span>
                  {active && (
                    <motion.div
                      layoutId="bottomNavIndicator"
                      className="absolute -bottom-0 w-8 h-0.5 rounded-full bg-amber-500"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
