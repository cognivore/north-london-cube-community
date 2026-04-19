/**
 * API client — typed fetch helpers for server communication.
 */

const API_BASE = typeof window !== "undefined" ? "" : `http://localhost:${process.env.API_PORT ?? "37556"}`;

/** Server-side API base URL — import this instead of defining your own. */
export const SERVER_API_BASE = API_BASE;

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

type ApiResultWithHeaders<T> = { ok: true; data: T; headers: Headers } | { ok: false; error: { code: string; message: string } };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const result = await apiFetchRaw<T>(path, init);
  return result;
}

async function apiFetchRaw<T>(path: string, init?: RequestInit): Promise<ApiResultWithHeaders<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = await res.json();

  if (!res.ok) {
    return { ok: false, error: body.error ?? { code: "UNKNOWN", message: "Request failed" } };
  }

  return { ok: true, data: body as T, headers: res.headers };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Extract Cookie header from an incoming Request for forwarding to the API.
 * Call this in every SSR loader/action and pass the result to API methods.
 */
export function cookieHeader(request: Request): Record<string, string> {
  const cookie = request.headers.get("Cookie");
  return cookie ? { Cookie: cookie } : {};
}

export const api = {
  register: (data: { email: string; displayName: string; inviteCode: string }) =>
    apiFetch<{ userId: string; challengeToken: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  verify: (data: { userId: string; challenge: string }) =>
    apiFetchRaw<{ user: any }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  login: (data: { email: string }) =>
    apiFetchRaw<{ user: any }>("/api/auth/session", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/session", { method: "DELETE" }),

  me: (init?: RequestInit) =>
    apiFetch<{ user: any }>("/api/me", init),

  // Fridays
  listFridays: (extra?: RequestInit) =>
    apiFetch<{ fridays: any[] }>("/api/fridays", extra),

  getFriday: (id: string, extra?: RequestInit) =>
    apiFetch<{ friday: any; enrollments: any[]; rsvps: any[]; pods: any[] }>(`/api/fridays/${id}`, extra),

  rsvp: (fridayId: string, action: "in" | "out", extra?: RequestInit & { covered?: boolean }) =>
    apiFetch<{ rsvp: any }>(`/api/fridays/${fridayId}/rsvp`, {
      method: "POST",
      body: JSON.stringify({ action, covered: extra?.covered ?? false }),
      headers: { ...extra?.headers },
    }),

  enrollCube: (fridayId: string, cubeId: string, extra?: RequestInit) =>
    apiFetch<{ enrollment: any }>(`/api/fridays/${fridayId}/enrollments`, {
      method: "POST",
      body: JSON.stringify({ cubeId }),
      ...extra,
      headers: { ...extra?.headers },
    }),

  withdrawEnrollment: (fridayId: string, enrollmentId: string, extra?: RequestInit) =>
    apiFetch<{ ok: boolean }>(`/api/fridays/${fridayId}/enrollments/${enrollmentId}`, {
      method: "DELETE",
      ...extra,
      headers: { ...extra?.headers },
    }),

  vote: (fridayId: string, ranking: string[], extra?: RequestInit) =>
    apiFetch<{ vote: any }>(`/api/fridays/${fridayId}/vote`, {
      method: "POST",
      body: JSON.stringify({ ranking }),
      ...extra,
      headers: { ...extra?.headers },
    }),

  // Cubes
  listCubes: (extra?: RequestInit) =>
    apiFetch<{ cubes: any[] }>("/api/cubes", extra),

  createCube: (data: any, extra?: RequestInit) =>
    apiFetch<{ cube: any }>("/api/cubes", {
      method: "POST",
      body: JSON.stringify(data),
      ...extra,
      headers: { ...extra?.headers },
    }),

  updateCube: (id: string, data: any, extra?: RequestInit) =>
    apiFetch<{ cube: any }>(`/api/cubes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
      ...extra,
      headers: { ...extra?.headers },
    }),

  // Pods
  getPod: (id: string, extra?: RequestInit) =>
    apiFetch<{ pod: any; seats: any[]; rounds: any[]; matches: any[]; players?: any }>(`/api/pods/${id}`, extra),

  getPairings: (podId: string) =>
    apiFetch<{ pairings: any[]; round: any }>(`/api/pods/${podId}/pairings`),

  startRound: (podId: string, roundNumber: number) =>
    apiFetch<{ round: any }>(`/api/pods/${podId}/rounds/${roundNumber}/start`, {
      method: "POST",
    }),

  reportMatch: (matchId: string, data: { p1Wins: number; p2Wins: number; draws: number }) =>
    apiFetch<{ result: any }>(`/api/pods/matches/${matchId}/result`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Venues
  listVenues: () =>
    apiFetch<{ venues: any[] }>("/api/venues"),

  // Profile
  updateProfile: (data: any, extra?: RequestInit) =>
    apiFetch<{ ok: boolean }>("/api/me", {
      method: "PATCH",
      body: JSON.stringify(data),
      ...extra,
      headers: { ...extra?.headers },
    }),
};
