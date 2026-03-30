/**
 * Client-side retry for transient AI/backend overload (503/504).
 * Uses jittered backoff. Sends X-Client-Retry-Attempt so the backend reduces its
 * own retry depth (limits worst-case stacked Gemini calls).
 * Default 1 extra attempt (2 round-trips total) to pair with server-side retries.
 */
const DEFAULT_RETRY_STATUSES = [503, 504];

function mergeHeaders(
  base: HeadersInit | undefined,
  patch: Record<string, string>
): Headers {
  const h = new Headers(base ?? undefined);
  for (const [k, v] of Object.entries(patch)) {
    h.set(k, v);
  }
  return h;
}

export async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  options?: {
    retries?: number;
    retryStatuses?: number[];
  }
): Promise<T> {
  const maxExtraAttempts = options?.retries ?? 1;
  const retryStatuses = options?.retryStatuses ?? DEFAULT_RETRY_STATUSES;

  let lastBody = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= maxExtraAttempts; attempt++) {
    const headers = mergeHeaders(init.headers, {
      "X-Client-Retry-Attempt": String(attempt),
    });
    const response = await fetch(url, { ...init, headers });
    lastStatus = response.status;

    if (response.ok) {
      return (await response.json()) as T;
    }

    lastBody = await response.text();
    const shouldRetry =
      attempt < maxExtraAttempts && retryStatuses.includes(response.status);

    if (shouldRetry) {
      const base = 750 * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, base + jitter));
      continue;
    }

    let message = lastBody || `HTTP ${lastStatus}`;
    try {
      const j = JSON.parse(lastBody) as { detail?: unknown };
      if (j?.detail != null) {
        message =
          typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
    } catch {
      /* use raw body */
    }
    throw new Error(message);
  }

  throw new Error(lastBody || `HTTP ${lastStatus}`);
}
