/**
 * Expense Categories Configuration
 * Aligned with CRA T2125 Business Income Statement
 * Includes tooltips for user guidance
 */

export interface CategoryConfig {
  id: string;
  label: string;
  tooltip: string;  // English explanation
  deductionRate: number;  // 0.0 to 1.0 (CRA deduction percentage)
  icon: string;  // Lucide icon name
  color: string;  // Tailwind color
}

export const EXPENSE_CATEGORIES: CategoryConfig[] = [
  {
    id: "fuel",
    label: "Fuel",
    tooltip: "Diesel, AdBlue, and vehicle fuel expenses.",
    deductionRate: 1.0,
    icon: "Fuel",
    color: "orange",
  },
  {
    id: "maintenance_repairs",
    label: "Maintenance & Repairs",
    tooltip: "Repairs, parts, tires, oil changes, and service expenses.",
    deductionRate: 1.0,
    icon: "Wrench",
    color: "blue",
  },
  {
    id: "insurance",
    label: "Insurance",
    tooltip: "Truck insurance (Cargo/Liability), business and accident insurance.",
    deductionRate: 1.0,
    icon: "Shield",
    color: "indigo",
  },
  {
    id: "licenses_dues",
    label: "Licenses & Dues",
    tooltip: "IFTA payments, D.O.T. registrations, plate fees, and professional memberships.",
    deductionRate: 1.0,
    icon: "FileText",
    color: "slate",
  },
  {
    id: "tolls_scales",
    label: "Tolls & Scales",
    tooltip: "Highway, bridge, scale, and customs/border crossing fees.",
    deductionRate: 1.0,
    icon: "CircleDollarSign",
    color: "emerald",
  },
  {
    id: "meals_entertainment",
    label: "Meals & Entertainment",
    tooltip: "Meals and grocery expenses during business travel (CRA applies 50% rule).",
    deductionRate: 0.5,  // CRA 50% rule
    icon: "UtensilsCrossed",
    color: "pink",
  },
  {
    id: "travel_lodging",
    label: "Travel (Lodging)",
    tooltip: "Hotel, motel, and accommodation expenses on the road.",
    deductionRate: 1.0,
    icon: "Bed",
    color: "purple",
  },
  {
    id: "office_admin",
    label: "Office & Admin",
    tooltip: "Bank fees, phone, internet, office supplies, and software subscriptions.",
    deductionRate: 1.0,
    icon: "Building2",
    color: "cyan",
  },
  {
    id: "other_expenses",
    label: "Other Expenses",
    tooltip: "Other business-related expenses that don't fit the above categories.",
    deductionRate: 1.0,
    icon: "MoreHorizontal",
    color: "gray",
  },
  {
    id: "uncategorized",
    label: "Uncategorized",
    tooltip: "Expenses not yet categorized. Categorize them for tax deductions!",
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

// Helper to get category tooltip
export const getCategoryTooltip = (id: string): string => {
  const cat = getCategoryById(id);
  return cat?.tooltip || "";
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

