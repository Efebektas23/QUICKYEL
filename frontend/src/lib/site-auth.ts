/** Client-side gate credentials (embedded for closed deployment). */
export const SITE_AUTH_USERNAME = "ozyel";
export const SITE_AUTH_PASSWORD = "2224ozyel.";

const STORAGE_KEY = "quickyel_site_auth";

export function isSiteAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setSiteAuthenticated(): void {
  localStorage.setItem(STORAGE_KEY, "1");
}

export function verifySiteCredentials(username: string, password: string): boolean {
  return username === SITE_AUTH_USERNAME && password === SITE_AUTH_PASSWORD;
}
