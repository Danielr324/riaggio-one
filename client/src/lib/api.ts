export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  body?: unknown;
}

// Cliente único para la API. Nunca guarda tokens: la sesión viaja en una cookie HttpOnly.
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(`/api${path}`, {
    method: options.method ?? (hasBody ? "POST" : "GET"),
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    issues?: Array<{ path: string; message: string }>;
  };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? "No se pudo completar la acción.", data.issues ?? []);
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.issues.map((i) => i.message).join(" ");
    return detail ? `${error.message} ${detail}` : error.message;
  }
  return "No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.";
}
