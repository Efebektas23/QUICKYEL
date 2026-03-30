/**
 * CRA Capital Cost Allowance (CCA) Calculation Engine
 * 
 * Implements Canadian Revenue Agency rules for depreciable asset amortization:
 * - Declining balance method
 * - Half-year rule for acquisition year
 * - Class 10.1 cost ceiling ($38,000 + tax for 2025)
 * - UCC (Undepreciated Capital Cost) tracking
 * 
 * Reference: CRA IT-478R2, Income Tax Folio S3-F4-C1
 */

// ============ CCA CLASS DEFINITIONS ============

export interface CCAClassDef {
  id: string;
  rate: number;
  description: string;
  method: "declining_balance";
  costCeiling?: number;         // Max depreciable cost (Class 10.1)
  costCeilingNote?: string;
  examples: string[];
}

export const CCA_CLASSES: Record<string, CCAClassDef> = {
  class_1: {
    id: "class_1",
    rate: 0.04,
    description: "Buildings acquired after 1987",
    method: "declining_balance",
    examples: ["Office buildings", "Warehouses"],
  },
  class_8: {
    id: "class_8",
    rate: 0.20,
    description: "Office furniture, fixtures & equipment",
    method: "declining_balance",
    examples: ["Desks", "Chairs", "Filing cabinets", "Photocopiers"],
  },
  class_10: {
    id: "class_10",
    rate: 0.30,
    description: "Motor vehicles, trailers & general equipment",
    method: "declining_balance",
    examples: [
      "Cars (under CRA limit)", "Trucks", "Vans",
      "Trailers (standard)", "Tractors",
    ],
  },
  class_10_1: {
    id: "class_10_1",
    rate: 0.30,
    description: "Passenger vehicles exceeding CRA prescribed cost",
    method: "declining_balance",
    costCeiling: 38000,
    costCeilingNote: "$38,000 + applicable taxes (2025 limit)",
    examples: [
      "Luxury passenger vehicles", "Honda CR-V (if over limit)",
      "SUVs over CRA limit",
    ],
  },
  class_12: {
    id: "class_12",
    rate: 1.00,
    description: "Computer software, tools < $500, dies, moulds",
    method: "declining_balance",
    examples: ["Software licenses", "Small tools", "Kitchen utensils"],
  },
  class_16: {
    id: "class_16",
    rate: 0.40,
    description: "Taxis, rental cars, heavy trucks & trailers (>11,788 kg)",
    method: "declining_balance",
    examples: [
      "Heavy-duty trailers", "Taxis", "Rental vehicles",
      "Trucks over 11,788 kg GVW",
    ],
  },
  class_43: {
    id: "class_43",
    rate: 0.30,
    description: "Manufacturing & processing equipment",
    method: "declining_balance",
    examples: ["Manufacturing machinery", "Processing equipment"],
  },
  class_50: {
    id: "class_50",
    rate: 0.55,
    description: "Computer hardware acquired after March 19, 2007",
    method: "declining_balance",
    examples: ["Computers", "Servers", "Network equipment", "Tablets"],
  },
  class_54: {
    id: "class_54",
    rate: 0.30,
    description: "Zero-emission passenger vehicles (over limit)",
    method: "declining_balance",
    costCeiling: 61000,
    costCeilingNote: "$61,000 + applicable taxes (2025 limit)",
    examples: ["Tesla Model 3", "Hyundai Ioniq 5", "Zero-emission SUVs"],
  },
};

// ============ ASSET TYPES ============

export type AssetCategory = "vehicle" | "trailer" | "equipment" | "furniture" | "computer" | "building" | "other";
export type AssetStatus = "active" | "disposed" | "written_off";

export interface UCCScheduleEntry {
  year: number;
  openingUCC: number;
  additions: number;
  disposals: number;
  adjustedUCC: number;    // After additions/disposals
  ccaRate: number;
  halfYearApplied: boolean;
  ccaAmount: number;      // Deduction for this year
  closingUCC: number;     // = adjustedUCC - ccaAmount
}

export interface Asset {
  id?: string;
  name: string;
  description: string;
  cca_class: string;
  purchase_date: Date | string;
  purchase_cost: number;
  adjusted_cost: number;          // After ceiling cap
  vendor_name: string;
  category: AssetCategory;
  status: AssetStatus;
  disposal_date?: Date | string | null;
  disposal_proceeds?: number;
  ucc_schedule?: UCCScheduleEntry[];
  linked_expense_id?: string | null;
  linked_bank_fingerprint?: string | null;
  receipt_image_url?: string | null;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

// ============ CCA CALCULATION ENGINE ============

/**
 * Get the adjusted cost base for an asset, applying class-specific ceilings.
 * For Class 10.1, the depreciable amount is capped at $38,000 + applicable taxes.
 */
export function getAdjustedCost(purchaseCost: number, ccaClassId: string): number {
  const ccaClass = CCA_CLASSES[ccaClassId];
  if (!ccaClass) return purchaseCost;

  if (ccaClass.costCeiling && purchaseCost > ccaClass.costCeiling) {
    return ccaClass.costCeiling;
  }

  return purchaseCost;
}

/**
 * Calculate CCA for a single year using declining balance method.
 * Applies half-year rule in the acquisition year.
 */
export function calculateYearCCA(
  openingUCC: number,
  rate: number,
  isAcquisitionYear: boolean,
  additions: number = 0,
  disposals: number = 0,
): { ccaAmount: number; closingUCC: number; halfYearApplied: boolean } {
  // Net additions subject to half-year rule
  const netAdditions = additions - disposals;
  
  // Adjusted UCC = opening + additions - disposals
  let adjustedUCC = openingUCC + additions - disposals;

  if (adjustedUCC <= 0) {
    return { ccaAmount: 0, closingUCC: Math.max(0, adjustedUCC), halfYearApplied: false };
  }

  let ccaAmount: number;
  let halfYearApplied = false;

  if (isAcquisitionYear && netAdditions > 0) {
    // Half-year rule: CCA on net additions is calculated at 50% of the normal rate
    // CCA = rate × (opening UCC + 50% of net additions)
    const halfYearBase = openingUCC + (netAdditions * 0.5);
    ccaAmount = halfYearBase * rate;
    halfYearApplied = true;
  } else {
    ccaAmount = adjustedUCC * rate;
  }

  // CCA cannot exceed the UCC balance
  ccaAmount = Math.min(ccaAmount, adjustedUCC);
  
  // Round to 2 decimal places
  ccaAmount = Math.round(ccaAmount * 100) / 100;

  const closingUCC = Math.round((adjustedUCC - ccaAmount) * 100) / 100;

  return { ccaAmount, closingUCC, halfYearApplied };
}

/**
 * Generate a full UCC schedule for an asset from purchase year to target year.
 */
export function generateUCCSchedule(
  purchaseCost: number,
  ccaClassId: string,
  purchaseYear: number,
  toYear: number,
): UCCScheduleEntry[] {
  const ccaClass = CCA_CLASSES[ccaClassId];
  if (!ccaClass) return [];

  const adjustedCost = getAdjustedCost(purchaseCost, ccaClassId);
  const schedule: UCCScheduleEntry[] = [];
  let currentUCC = 0;

  for (let year = purchaseYear; year <= toYear; year++) {
    const isAcquisitionYear = year === purchaseYear;
    const additions = isAcquisitionYear ? adjustedCost : 0;
    const disposals = 0; // Disposals handled separately

    const { ccaAmount, closingUCC, halfYearApplied } = calculateYearCCA(
      currentUCC,
      ccaClass.rate,
      isAcquisitionYear,
      additions,
      disposals,
    );

    const adjustedUCC = currentUCC + additions - disposals;

    schedule.push({
      year,
      openingUCC: Math.round(currentUCC * 100) / 100,
      additions,
      disposals,
      adjustedUCC: Math.round(adjustedUCC * 100) / 100,
      ccaRate: ccaClass.rate,
      halfYearApplied,
      ccaAmount,
      closingUCC,
    });

    currentUCC = closingUCC;

    // If UCC drops below $1, stop generating
    if (currentUCC < 1) break;
  }

  return schedule;
}

/**
 * Get the CCA deduction for a specific fiscal year.
 */
export function getCCAForYear(asset: Asset, fiscalYear: number): number {
  if (asset.ucc_schedule) {
    const entry = asset.ucc_schedule.find(e => e.year === fiscalYear);
    return entry?.ccaAmount ?? 0;
  }

  // Generate on the fly
  const purchaseDate = asset.purchase_date instanceof Date
    ? asset.purchase_date
    : new Date(asset.purchase_date);
  const purchaseYear = purchaseDate.getFullYear();

  const schedule = generateUCCSchedule(
    asset.purchase_cost,
    asset.cca_class,
    purchaseYear,
    fiscalYear,
  );

  const entry = schedule.find(e => e.year === fiscalYear);
  return entry?.ccaAmount ?? 0;
}

/**
 * Get the current UCC balance for an asset as of a given year.
 */
export function getUCCBalance(asset: Asset, asOfYear: number): number {
  if (asset.ucc_schedule) {
    // Find the most recent entry at or before asOfYear
    const entries = asset.ucc_schedule
      .filter(e => e.year <= asOfYear)
      .sort((a, b) => b.year - a.year);
    return entries[0]?.closingUCC ?? asset.adjusted_cost;
  }

  const purchaseDate = asset.purchase_date instanceof Date
    ? asset.purchase_date
    : new Date(asset.purchase_date);
  const purchaseYear = purchaseDate.getFullYear();

  if (asOfYear < purchaseYear) return 0;

  const schedule = generateUCCSchedule(
    asset.purchase_cost,
    asset.cca_class,
    purchaseYear,
    asOfYear,
  );

  const lastEntry = schedule[schedule.length - 1];
  return lastEntry?.closingUCC ?? asset.adjusted_cost;
}

/**
 * Calculate total CCA deduction across all assets for a fiscal year.
 */
export function getTotalCCAForYear(assets: Asset[], fiscalYear: number): number {
  return assets
    .filter(a => a.status === "active")
    .reduce((total, asset) => total + getCCAForYear(asset, fiscalYear), 0);
}

/**
 * Determine the recommended CCA class for a purchase based on category and amount.
 */
export function suggestCCAClass(
  category: string,
  amount: number,
  description: string = "",
): string[] {
  const desc = description.toLowerCase();
  const suggestions: string[] = [];

  if (category === "vehicle" || desc.includes("car") || desc.includes("suv") || desc.includes("cr-v")) {
    if (amount > 38000) {
      suggestions.push("class_10_1"); // Over CRA limit → Class 10.1
    } else {
      suggestions.push("class_10"); // Under limit → regular Class 10
    }
    if (desc.includes("electric") || desc.includes("ev") || desc.includes("zero-emission")) {
      suggestions.push("class_54");
    }
  }

  if (category === "trailer" || desc.includes("trailer")) {
    suggestions.push("class_10");  // Standard trailer
    suggestions.push("class_16"); // Heavy-duty trailer
  }

  if (category === "equipment" || desc.includes("equipment")) {
    suggestions.push("class_8");
    suggestions.push("class_10");
    suggestions.push("class_43");
  }

  if (category === "computer" || desc.includes("computer") || desc.includes("laptop") || desc.includes("server")) {
    suggestions.push("class_50");
  }

  if (category === "furniture" || desc.includes("desk") || desc.includes("chair")) {
    suggestions.push("class_8");
  }

  if (category === "building" || desc.includes("building") || desc.includes("warehouse")) {
    suggestions.push("class_1");
  }

  // If no specific match, suggest common classes
  if (suggestions.length === 0) {
    suggestions.push("class_8", "class_10");
  }

  return Array.from(new Set(suggestions)); // Deduplicate
}

/**
 * Detect if an expense should be classified as an asset based on CRA rules.
 * Returns null if not an asset candidate, or an object with recommendation details.
 */
export function detectAssetCandidate(
  amount: number,
  vendorName: string,
  category: string,
  description: string = "",
): {
  isAssetCandidate: boolean;
  reason: string;
  suggestedClasses: string[];
  suggestedCategory: AssetCategory;
} | null {
  const desc = (description + " " + vendorName).toLowerCase();

  // Vehicle keywords
  const vehicleKeywords = [
    "honda", "toyota", "ford", "chevrolet", "gmc", "ram",
    "cr-v", "crv", "rav4", "f-150", "silverado",
    "vehicle", "car", "suv", "truck", "auto",
    "dealership", "dealer", "motors",
  ];

  // Equipment keywords
  const equipmentKeywords = [
    "trailer", "dry van", "reefer", "flatbed",
    "forklift", "generator", "compressor",
    "heavy equipment", "machinery",
  ];

  // Check for vehicle
  if (vehicleKeywords.some(kw => desc.includes(kw)) && amount >= 5000) {
    return {
      isAssetCandidate: true,
      reason: `Vehicle purchase detected: ${vendorName} ($${amount.toLocaleString()})`,
      suggestedClasses: suggestCCAClass("vehicle", amount, desc),
      suggestedCategory: "vehicle",
    };
  }

  // Check for trailer/equipment
  if (equipmentKeywords.some(kw => desc.includes(kw)) && amount >= 5000) {
    const isTailer = desc.includes("trailer") || desc.includes("dry van") || desc.includes("reefer") || desc.includes("flatbed");
    return {
      isAssetCandidate: true,
      reason: `${isTailer ? "Trailer" : "Equipment"} purchase detected: ${vendorName} ($${amount.toLocaleString()})`,
      suggestedClasses: suggestCCAClass(isTailer ? "trailer" : "equipment", amount, desc),
      suggestedCategory: isTailer ? "trailer" : "equipment",
    };
  }

  // Generic high-value threshold
  if (amount >= 10000 && category !== "payroll" && category !== "rent_lease" && category !== "insurance" && category !== "subcontractor") {
    return {
      isAssetCandidate: true,
      reason: `High-value purchase ($${amount.toLocaleString()}) — may be a depreciable asset`,
      suggestedClasses: suggestCCAClass("equipment", amount, desc),
      suggestedCategory: "equipment",
    };
  }

  return null;
}

// ============ FORMATTING HELPERS ============

export function formatCCAClassName(classId: string): string {
  const ccaClass = CCA_CLASSES[classId];
  if (!ccaClass) return classId;
  
  const number = classId.replace("class_", "").replace("_", ".");
  return `Class ${number}`;
}

export function formatCCARate(classId: string): string {
  const ccaClass = CCA_CLASSES[classId];
  if (!ccaClass) return "N/A";
  return `${(ccaClass.rate * 100).toFixed(0)}%`;
}

export function formatAssetCategory(category: AssetCategory): string {
  const labels: Record<AssetCategory, string> = {
    vehicle: "Vehicle",
    trailer: "Trailer",
    equipment: "Equipment",
    furniture: "Furniture & Fixtures",
    computer: "Computer Hardware",
    building: "Building",
    other: "Other",
  };
  return labels[category] || category;
}
