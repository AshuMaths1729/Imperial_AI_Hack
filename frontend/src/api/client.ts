/** Tiny typed fetch wrapper: JSON / multipart / blob, one `ApiError`, AbortSignal. No deps. */
import type { ErrorEnvelope } from "./types";

// NEXT_PUBLIC_API_URL is the app-wide setting (page.tsx, tutor/shell/api.ts); NEXT_PUBLIC_API_BASE is kept
// as an alias so one variable points every client at the same backend.
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000"
).replace(
  /\/+$/,
  "",
);
export const API_PREFIX = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  /** JSON body. */
  json?: unknown;
  /** Multipart body (do not set Content-Type; the browser adds the boundary). */
  form?: FormData;
  signal?: AbortSignal;
  /** How to read a successful response. Default "json". */
  responseType?: "json" | "blob" | "text" | "none";
  headers?: Record<string, string>;
}

export function apiUrl(path: string, query?: Query): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const q = qs.toString();
  return `${API_BASE}${API_PREFIX}${p}${q ? `?${q}` : ""}`;
}

/** Turn a backend-relative media URL (e.g. `/api/media/ab12`) into an absolute one. */
export function resolveMediaUrl(url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const env = (body as Partial<ErrorEnvelope> | null)?.error;
  if (env && typeof env.message === "string") {
    return new ApiError(res.status, env.message, env.code, env.details);
  }
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return new ApiError(res.status, detail, `http_${res.status}`);
  return new ApiError(res.status, res.statusText || `HTTP ${res.status}`, `http_${res.status}`, body);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, json, form, signal, responseType = "json", headers } = opts;
  const h: Record<string, string> = { ...headers };
  let body: BodyInit | undefined;
  if (form) {
    body = form;
  } else if (json !== undefined) {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), { method, headers: h, body, signal });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError(0, e instanceof Error ? e.message : "Network error", "network_error");
  }
  if (!res.ok) throw await toApiError(res);
  switch (responseType) {
    case "blob":
      return (await res.blob()) as T;
    case "text":
      return (await res.text()) as T;
    case "none":
      return undefined as T;
    default:
      return (await res.json()) as T;
  }
}
