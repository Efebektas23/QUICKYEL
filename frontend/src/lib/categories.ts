/**
 * Expense Categories Configuration
 * Aligned with CRA T2125 Business Income Statement
 * Includes Turkish tooltips for user guidance
 */

export interface CategoryConfig {
  id: string;
  label: string;
  tooltipTr: string;  // Turkish explanation
  deductionRate: number;  // 0.0 to 1.0 (CRA deduction percentage)
  icon: string;  // Lucide icon name
  color: string;  // Tailwind color
}

export const EXPENSE_CATEGORIES: CategoryConfig[] = [
  {
    id: "fuel",
    label: "Fuel",
    tooltipTr: "Mazot (Diesel), AdBlue ve araç yakıt harcamaları.",
    deductionRate: 1.0,
    icon: "Fuel",
    color: "orange",
  },
  {
    id: "maintenance_repairs",
    label: "Maintenance & Repairs",
    tooltipTr: "Tamir, yedek parça, lastik, yağ değişimi ve servis giderleri.",
    deductionRate: 1.0,
    icon: "Wrench",
    color: "blue",
  },
  {
    id: "insurance",
    label: "Insurance",
    tooltipTr: "Kamyon sigortası (Cargo/Liability), işletme ve kaza sigortaları.",
    deductionRate: 1.0,
    icon: "Shield",
    color: "indigo",
  },
  {
    id: "licenses_dues",
    label: "Licenses & Dues",
    tooltipTr: "IFTA ödemeleri, D.O.T. kayıtları, plaka harçları ve mesleki üyelikler.",
    deductionRate: 1.0,
    icon: "FileText",
    color: "slate",
  },
  {
    id: "tolls_scales",
    label: "Tolls & Scales",
    tooltipTr: "Otoban, köprü, kantar (Scales) ve gümrük (Customs/Border) geçiş ücretleri.",
    deductionRate: 1.0,
    icon: "CircleDollarSign",
    color: "emerald",
  },
  {
    id: "meals_entertainment",
    label: "Meals & Entertainment",
    tooltipTr: "İş seyahatindeki yemek ve market harcamaları (CRA %50 kuralı uygular).",
    deductionRate: 0.5,  // CRA 50% rule
    icon: "UtensilsCrossed",
    color: "pink",
  },
  {
    id: "travel_lodging",
    label: "Travel (Lodging)",
    tooltipTr: "Yoldaki otel, motel ve konaklama masrafları.",
    deductionRate: 1.0,
    icon: "Bed",
    color: "purple",
  },
  {
    id: "office_admin",
    label: "Office & Admin",
    tooltipTr: "Banka masrafları, telefon, internet, kırtasiye ve yazılım abonelikleri.",
    deductionRate: 1.0,
    icon: "Building2",
    color: "cyan",
  },
  {
    id: "other_expenses",
    label: "Other Expenses",
    tooltipTr: "Yukarıdakilere girmeyen, işle doğrudan ilgili diğer harcamalar.",
    deductionRate: 1.0,
    icon: "MoreHorizontal",
    color: "gray",
  },
  {
    id: "uncategorized",
    label: "Uncategorized",
    tooltipTr: "Henüz kategorize edilmemiş harcamalar. Vergi indirimi için kategorize edin!",
    deductionRate: 0.0,  // Safety default
    icon: "HelpCircle",
    color: "slate",
  },
];

// Helper to get category by ID
export const getCategoryById = (id: string): CategoryConfig | undefined => {
  return EXPENSE_CATEGORIES.find(cat => cat.id === id);
};

// Helper to get category label
export const getCategoryLabel = (id: string): string => {
  const cat = getCategoryById(id);
  return cat?.label || id.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
};

// Helper to get Turkish tooltip
export const getCategoryTooltip = (id: string): string => {
  const cat = getCategoryById(id);
  return cat?.tooltipTr || "";
};

// Helper to get deduction rate
export const getDeductionRate = (id: string): number => {
  const cat = getCategoryById(id);
  return cat?.deductionRate ?? 0.0;
};

// Category ID to label mapping (for backward compatibility)
export const categoryLabels: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map(cat => [cat.id, cat.label])
);

// Category colors for UI
export const categoryColors: Record<string, string> = {
  fuel: "bg-orange-500/20 text-orange-500",
  maintenance_repairs: "bg-blue-500/20 text-blue-500",
  insurance: "bg-indigo-500/20 text-indigo-500",
  licenses_dues: "bg-slate-500/20 text-slate-400",
  tolls_scales: "bg-emerald-500/20 text-emerald-500",
  meals_entertainment: "bg-pink-500/20 text-pink-500",
  travel_lodging: "bg-purple-500/20 text-purple-500",
  office_admin: "bg-cyan-500/20 text-cyan-500",
  other_expenses: "bg-gray-500/20 text-gray-400",
  uncategorized: "bg-slate-500/20 text-slate-400",
};

