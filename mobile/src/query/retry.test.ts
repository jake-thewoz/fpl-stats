import { HttpError } from '../api/http';
import { EntryNotFoundError } from '../api/entry';
import { isTransientError, MAX_TRANSIENT_RETRIES, shouldRetryQuery } from './retry';

describe('isTransientError', () => {
  it.each([429, 500, 502, 503, 504])('retries HTTP %i', (status) => {
    expect(isTransientError(new HttpError(status))).toBe(true);
  });

  it.each([400, 403, 404])('does not retry HTTP %i', (status) => {
    expect(isTransientError(new HttpError(status))).toBe(false);
  });

  it('retries network failures', () => {
    expect(isTransientError(new TypeError('Network request failed'))).toBe(true);
  });

  it('does not retry domain errors', () => {
    expect(isTransientError(new EntryNotFoundError('123'))).toBe(false);
  });
});

describe('shouldRetryQuery', () => {
  it('stops after the retry budget is spent', () => {
    const throttled = new HttpError(503);
    expect(shouldRetryQuery(MAX_TRANSIENT_RETRIES - 1, throttled)).toBe(true);
    expect(shouldRetryQuery(MAX_TRANSIENT_RETRIES, throttled)).toBe(false);
  });
});
