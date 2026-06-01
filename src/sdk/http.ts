import type { RpcClientOptions } from "@monolythium/core-sdk";

type HeaderRecord = Record<string, string>;

const FORBIDDEN_BROWSER_HEADERS = new Set([
  "user-agent",
]);

export const walletFetch: typeof fetch = (input, init) => {
  const nextInit = init ? { ...init } : undefined;
  if (nextInit?.headers) {
    nextInit.headers = stripForbiddenHeaders(nextInit.headers);
  }
  return globalThis.fetch(input, nextInit);
};

export function rpcClientOptions(options: RpcClientOptions = {}): RpcClientOptions {
  return {
    ...options,
    fetch: options.fetch ?? walletFetch,
  };
}

function stripForbiddenHeaders(headers: HeadersInit): HeadersInit {
  if (headers instanceof Headers) {
    const next = new Headers(headers);
    for (const header of FORBIDDEN_BROWSER_HEADERS) next.delete(header);
    return next;
  }
  if (Array.isArray(headers)) {
    return headers.filter(([key]) => !FORBIDDEN_BROWSER_HEADERS.has(key.toLowerCase()));
  }
  const next: HeaderRecord = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!FORBIDDEN_BROWSER_HEADERS.has(key.toLowerCase())) {
      next[key] = value;
    }
  }
  return next;
}
