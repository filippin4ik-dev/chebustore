export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

// Mini-app bearer token lives only in memory: it is re-issued from Telegram initData on every launch.
let bearer: string | null = null;
let onUnauthorized: (() => Promise<boolean>) | null = null;

export const setBearer = (t: string | null) => {
  bearer = t;
};
export const setUnauthorizedHandler = (fn: (() => Promise<boolean>) | null) => {
  onUnauthorized = fn;
};

function headers(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("X-CS-CSRF", "1");
  if (bearer) h.set("Authorization", `Bearer ${bearer}`);
  return h;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: headers(body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined),
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401 && retry && bearer && onUnauthorized) {
    if (await onUnauthorized()) return request<T>(method, path, body, false);
  }
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(err?.message ?? "Ошибка сети, попробуйте ещё раз", err?.code ?? "network", res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<T>("POST", path, fd);
  },
  /** Fetches a protected binary (receipts) with auth headers and returns an object URL. */
  async blobUrl(path: string): Promise<{ url: string; type: string }> {
    const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: headers() });
    if (!res.ok) throw new ApiError("Не удалось загрузить файл", "file", res.status);
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), type: blob.type };
  },
};
