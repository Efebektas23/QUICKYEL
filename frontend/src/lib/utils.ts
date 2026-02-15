import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: string = "CAD"
): string {
  if (amount === null || amount === undefined) return "-";

  // Normalize invalid currency codes to CAD
  const validCurrency = (currency && currency.length === 3 && currency !== "MIXED")
    ? currency.toUpperCase()
    : "CAD";

  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: validCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)} ${validCurrency}`;
  }
}

export function formatDate(
  date: string | Date | null | undefined,
  format: "short" | "long" = "short"
): string {
  if (!date) return "-";

  // Parse date-only (YYYY-MM-DD) or ISO string as local date to avoid timezone shift.
  // e.g. "2026-02-15T00:00:00.000Z" (midnight UTC) would display as Feb 14 in EST.
  const str = typeof date === "string" ? date : date instanceof Date ? date.toISOString() : String(date);
  const datePart = str.substring(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split("-").map(Number);
    const dLocal = new Date(y, m - 1, d);
    if (format === "short") {
      return dLocal.toLocaleDateString("en-CA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
    return dLocal.toLocaleDateString("en-CA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const d = new Date(date);
  if (format === "short") {
    return d.toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return d.toLocaleDateString("en-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatExchangeRate(rate: number | null | undefined): string {
  if (!rate) return "-";
  return `1 USD = ${rate.toFixed(4)} CAD`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

