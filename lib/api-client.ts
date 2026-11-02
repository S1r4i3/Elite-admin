/**
 * Browser-side fetch with a timeout and plain-language errors.
 * Every button that calls the API goes through this, so a dropped connection or a stuck request
 * always ends (and the button is restored) instead of spinning forever.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = init.signal;
  if (outer) outer.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (outer?.aborted) throw e;
    if (ctrl.signal.aborted) throw new Error("The server took too long to respond. Please try again.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("You're offline. Check your connection and try again.");
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

/** apiFetch + JSON. Throws an Error carrying the server's message when the request fails. */
export async function apiJson<T = Record<string, unknown>>(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const res = await apiFetch(input, init, timeoutMs);
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || (res.status === 401 ? "Your session has expired. Please sign in again." : res.status === 413 ? "That file is too large." : `Request failed (${res.status}). Please try again.`));
  }
  return json;
}
