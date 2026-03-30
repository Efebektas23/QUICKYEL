"use client";

import { useEffect, useRef } from "react";
import { ensureAuth } from "@/lib/firebase";
import { expensesApi } from "@/lib/firebase-api";

const STORAGE_KEY = "quickyel_usd_itc_gate_v1";

/**
 * Runs once per browser after deploy: clears invalid Canadian ITC on USD/USA expenses.
 */
export function UsdItcSanitizeOnLoad() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      try {
        if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) {
          return;
        }
        await ensureAuth();
        if (cancelled) return;
        const { updated } = await expensesApi.sanitizeUsdAutoEstimatedItc();
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, "1");
        }
        if (updated > 0) {
          console.info(
            `[QuickYel] USD/USA ITC compliance: corrected ${updated} expense(s); Canadian ITC is not auto-estimated for US transactions.`,
          );
        }
      } catch (e) {
        console.warn("[QuickYel] USD ITC sanitization skipped:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
