"use client";

import { useEffect, useRef } from "react";
import { ensureAuth } from "@/lib/firebase";
import { expensesApi } from "@/lib/firebase-api";

const STORAGE_KEY = "quickyel_tax_compliance_gate_v2";

/**
 * Runs once per browser after deploy: clears USD tax rows and legacy gst_itc_estimated CAD rows.
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
            `[QuickYel] Tax compliance: updated ${updated} expense(s) (USD tax strip / legacy CAD ITC estimate removal).`,
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
