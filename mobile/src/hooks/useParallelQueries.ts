import { useCallback, useMemo, useState } from 'react';
import { useQueries, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { useRefetchStaleOnFocus } from './useQueryState';

export type ParallelFetchRowState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; error: unknown };

export type ParallelFetchRow<K, T> = {
  key: K;
  state: ParallelFetchRowState<T>;
};

export type UseParallelQueriesResult<K, T> = {
  rows: readonly ParallelFetchRow<K, T>[];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};

/**
 * Per-key parallel queries — the "render the table immediately with
 * placeholders, fill cells in as their fetches resolve" pattern.
 * Sibling to `useQueryState`, which combines a fixed set of queries
 * into one screen state; this one keeps a row per key.
 *
 * Errors come through unwrapped — consumers branch on
 * `instanceof DomainError` to derive UI state. Keeping the hook
 * error-shape-agnostic avoids locking it to one error taxonomy.
 */
export function useParallelQueries<K extends string | number, T, TKey extends QueryKey>(
  keys: readonly K[],
  queryFor: (key: K) => UseQueryOptions<T, Error, T, TKey>,
): UseParallelQueriesResult<K, T> {
  const results = useQueries({ queries: keys.map(queryFor) });
  useRefetchStaleOnFocus(results);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(results.map((r) => r.refetch()));
    } finally {
      setRefreshing(false);
    }
  }, [results]);

  const rows = useMemo(
    () =>
      keys.map((key, i): ParallelFetchRow<K, T> => {
        const result = results[i];
        if (result?.data !== undefined)
          return { key, state: { status: 'ok', data: result.data } };
        if (result?.isError)
          return { key, state: { status: 'error', error: result.error } };
        return { key, state: { status: 'loading' } };
      }),
    [keys, results],
  );

  return { rows, refreshing, onRefresh };
}
