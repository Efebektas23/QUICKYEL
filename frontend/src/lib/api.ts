import axios from "axios";
import { API_URL } from "./runtime-config";

// API URL is now centralized in runtime-config.ts
// This ensures consistent usage across the application

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    "Content-Type": "application/json",
  },
});

// Kapalı devre sistem - auth interceptor kaldırıldı

// Expenses API
export const expensesApi = {
  list: async (params?: {
    page?: number;
    per_page?: number;
    category?: string;
    start_date?: string;
    end_date?: string;
    verified_only?: boolean;
  }) => {
    const response = await api.get("/expenses/", { params });
    return response.data;
  },

  get: async (id: string) => {
    const response = await api.get(`/expenses/${id}`);
    return response.data;
  },

  upload: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await api.post("/expenses/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

  update: async (id: string, data: any) => {
    const response = await api.patch(`/expenses/${id}`, data);
    return response.data;
  },

  verify: async (id: string) => {
    const response = await api.post(`/expenses/${id}/verify`);
    return response.data;
  },

  delete: async (id: string) => {
    await api.delete(`/expenses/${id}`);
  },

  createManual: async (data: any) => {
    const response = await api.post("/expenses/manual", data);
    return response.data;
  },
};

// Cards API
export const cardsApi = {
  list: async () => {
    const response = await api.get("/cards/");
    return response.data;
  },

  create: async (data: {
    last_four: string;
    card_name: string;
    is_company_card: boolean;
  }) => {
    const response = await api.post("/cards", data);
    return response.data;
  },

  delete: async (id: string) => {
    await api.delete(`/cards/${id}`);
  },
};

// Export API
export const exportApi = {
  getSummary: async (params?: { start_date?: string; end_date?: string }) => {
    const response = await api.get("/export/summary/", { params });
    return response.data;
  },

  downloadCSV: async (params?: any) => {
    const response = await api.get("/export/csv", {
      params,
      responseType: "blob",
    });
    return response.data;
  },

  downloadXLSX: async (params?: any) => {
    const response = await api.get("/export/xlsx", {
      params,
      responseType: "blob",
    });
    return response.data;
  },
};
