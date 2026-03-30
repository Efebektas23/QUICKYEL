"use client";

import Link from "next/link";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { isExpenseReclassifiedToAsset, type Expense } from "@/lib/firebase-api";

export function ReclassifiedAssetBadge({
  expense,
  className,
  size = "sm",
}: {
  expense: Pick<Expense, "notes" | "reclassified_to_asset">;
  className?: string;
  size?: "sm" | "md";
}) {
  if (!isExpenseReclassifiedToAsset(expense)) return null;

  return (
    <Link
      href="/assets"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-violet-500/35 bg-violet-500/10 font-semibold text-violet-300 hover:bg-violet-500/15 transition-colors shrink-0",
        size === "sm" && "px-1.5 py-0.5 text-[10px]",
        size === "md" && "px-2 py-1 text-xs",
        className,
      )}
      title="Reclassified to a capital asset (CCA). Excluded from operating expenses. Open Assets."
    >
      <Package className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      Asset
    </Link>
  );
}
