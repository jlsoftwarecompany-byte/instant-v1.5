/**
 * Minimal JWT auth client for the v1.5 surface (additive to the legacy
 * session-token flow in v1.4 — both can coexist).
 */
const ACCESS_KEY = "instant-v15-access";
const REFRESH_KEY = "instant-v15-refresh";

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(t: { accessToken: string; refreshToken: string }) {
  localStorage.setItem(ACCESS_KEY, t.accessToken);
  localStorage.setItem(REFRESH_KEY, t.refreshToken);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export async function loginJWT(username: string, password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/v15/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return false;
    const tokens = await res.json();
    setTokens(tokens);
    return true;
  } catch { return false; }
}

export async function refreshJWT(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch("/api/v15/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) { clearTokens(); return false; }
    setTokens(await res.json());
    return true;
  } catch { clearTokens(); return false; }
}

export async function authedFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = getAccessToken();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  let res = await fetch(input, { ...init, headers });
  if (res.status === 401 && await refreshJWT()) {
    headers.set("Authorization", `Bearer ${getAccessToken()}`);
    res = await fetch(input, { ...init, headers });
  }
  return res;
}
