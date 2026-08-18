export type HttpMethod = "GET" | "POST" | "DELETE";

export interface TransportRequest {
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface FetchTransportOptions {
  baseUrl: string;
  timeoutMilliseconds: number;
  credentials?: "omit" | "same-origin" | "include";
  fetchImplementation?: typeof fetch;
}

function validatedBaseUrl(rawBaseUrl: string): URL {
  const url = new URL(rawBaseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "") {
    throw new Error("SDK base URL must be an HTTP(S) origin without credentials");
  }
  if (url.search !== "" || url.hash !== "")
    throw new Error("SDK base URL must not contain query or hash");
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

export function createFetchTransport(options: FetchTransportOptions): Transport {
  if (
    !Number.isInteger(options.timeoutMilliseconds) ||
    options.timeoutMilliseconds < 1 ||
    options.timeoutMilliseconds > 120_000
  ) {
    throw new Error("SDK timeout must be between 1 and 120000 milliseconds");
  }
  const baseUrl = validatedBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return async (request) => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("OrgSpace request timed out")),
      options.timeoutMilliseconds,
    );
    const abortFromCaller = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (request.signal?.aborted === true) abortFromCaller();

    try {
      const response = await fetchImplementation(new URL(request.path, baseUrl), {
        method: request.method,
        headers: request.headers,
        credentials: options.credentials ?? "omit",
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = null;
      if (text !== "") {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error("OrgSpace API returned malformed JSON");
        }
      }
      return { status: response.status, headers: response.headers, body };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortFromCaller);
    }
  };
}
