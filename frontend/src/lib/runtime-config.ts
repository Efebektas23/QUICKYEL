/**
 * Runtime configuration for API URL
 * 
 * Note: Next.js embeds NEXT_PUBLIC_* variables at build time.
 * If you change NEXT_PUBLIC_API_URL in Railway, you MUST redeploy the frontend.
 * 
 * This file provides a centralized way to access the API URL and log warnings.
 */

const getApiUrl = (): string => {
  // Next.js will replace this at build time
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  
  // Runtime validation (client-side only)
  if (typeof window !== "undefined") {
    // Check if we're in production but using fallback URL
    if (apiUrl === "http://localhost:8000" && window.location.hostname !== "localhost") {
      console.error(
        "❌ CRITICAL: NEXT_PUBLIC_API_URL is not configured correctly!",
        "\nCurrent URL:",
        apiUrl,
        "\nThis will cause API calls to fail in production.",
        "\nPlease set NEXT_PUBLIC_API_URL in Railway and redeploy."
      );
    }
  }
  
  return apiUrl;
};

export const API_URL = getApiUrl();

// Export a function to get API URL (useful for dynamic checks)
export const getApiBaseUrl = () => API_URL;
