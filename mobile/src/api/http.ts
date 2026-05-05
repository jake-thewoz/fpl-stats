import { API_BASE_URL } from '../config';

export type StatusMapper = (
  status: number,
  /** Parsed error response body, or `undefined` if the body wasn't valid
   *  JSON. Endpoints that disambiguate same-status errors via body
   *  shape (e.g. transferSuggestions distinguishing entry-not-found
   *  from picks-not-found at 404) read this. */
  body: unknown,
) => Error | undefined;

export type RequestJsonInit = RequestInit & {
  /** Map an HTTP status to a domain-specific error. Returning
   *  `undefined` falls back to the generic `HTTP <status>` Error. */
  mapStatus?: StatusMapper;
};

/**
 * Single JSON fetch helper for the API client layer.
 *
 * Replaces the `if (!res.ok) throw new Error(\`HTTP ${status}\`)`
 * pattern that every endpoint module was repeating, while letting
 * endpoints surface domain-specific errors for known status codes
 * via `mapStatus`. The AbortSignal on `init` is forwarded
 * transparently. `path` is appended to `API_BASE_URL`; pass query
 * strings as part of the path string.
 *
 * On non-OK responses the helper attempts to parse the body as
 * JSON before invoking `mapStatus` — endpoints that need to
 * disambiguate same-status errors via body shape can read it.
 * Endpoints that don't need it can ignore the second argument.
 */
export async function requestJson<T>(
  path: string,
  init?: RequestJsonInit,
): Promise<T> {
  const { mapStatus, ...fetchInit } = init ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, fetchInit);
  if (!res.ok) {
    if (mapStatus) {
      const body: unknown = await res.json().catch(() => undefined);
      const mapped = mapStatus(res.status, body);
      if (mapped) throw mapped;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
