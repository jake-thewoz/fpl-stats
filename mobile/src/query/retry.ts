import { HttpError } from '../api/http';

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

/** Attempts after the first failure. With TanStack's default backoff
 *  (1s, 2s, 4s) a request gives up about 7 seconds after its first error. */
export const MAX_TRANSIENT_RETRIES = 3;

/**
 * Failures worth retrying: throttling, server errors, and requests that
 * never got a response. Domain errors (unknown team, picks not out yet)
 * are answers, so retrying them only delays the message.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return (
      error.status === HTTP_TOO_MANY_REQUESTS || error.status >= HTTP_SERVER_ERROR_MIN
    );
  }
  // fetch rejects with a TypeError when the request itself fails
  // (offline, DNS, connection reset).
  return error instanceof TypeError;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_TRANSIENT_RETRIES && isTransientError(error);
}
