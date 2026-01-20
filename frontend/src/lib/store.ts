import { create } from "zustand";
import { persist } from "zustand/middleware";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      setAuth: (user, token) => {
        localStorage.setItem("token", token);
        set({ user, token, isAuthenticated: true });
      },

      logout: () => {
        localStorage.removeItem("token");
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    {
      name: "quickyel-auth",
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

// Expense category display names
export const categoryLabels: Record<string, string> = {
  fuel: "Fuel",
  maintenance_repairs: "Maintenance & Repairs",
  meals_entertainment: "Meals & Entertainment",
  travel_lodging: "Travel (Lodging)",
  tolls_scales: "Tolls & Scales",
  office_admin: "Office & Admin",
  licenses_dues: "Licenses & Dues",
  uncategorized: "Uncategorized",
};

// Category icons (lucide-react icon names)
export const categoryIcons: Record<string, string> = {
  fuel: "Fuel",
  maintenance_repairs: "Wrench",
  meals_entertainment: "UtensilsCrossed",
  travel_lodging: "Bed",
  tolls_scales: "Scale",
  office_admin: "FileText",
  licenses_dues: "FileCheck",
  uncategorized: "HelpCircle",
};

// Category colors for charts/badges
export const categoryColors: Record<string, string> = {
  fuel: "#F59E0B",
  maintenance_repairs: "#3B82F6",
  meals_entertainment: "#10B981",
  travel_lodging: "#8B5CF6",
  tolls_scales: "#EC4899",
  office_admin: "#6366F1",
  licenses_dues: "#14B8A6",
  uncategorized: "#6B7280",
};

