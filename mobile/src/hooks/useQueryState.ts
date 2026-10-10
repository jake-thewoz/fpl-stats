import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { UseQueryResult } from '@tanstack/react-query';

export type FetchState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; message: string };

export type QueryStateResult<T> = {
  state: FetchState<T>;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onRetry: () => void;
};

type AnyQuery = UseQueryResult<unknown, Error>;

/** A dependent query waiting on its inputs (`enabled: false`) sits at
 *  pending + idle; refetching it would run it with missing params. */
function isRunnable(query: AnyQuery): boolean {
  return !(query.isPending && query.fetchStatus === 'idle');
}

/**
 * Refetches a screen's stale queries each time it regains focus, so
 * switching back to a tab during a live gameweek shows fresh points.
 * Fresh queries are left alone, which keeps tab switching free.
 */
export function useRefetchStaleOnFocus(queries: readonly AnyQuery[]): void {
  const queriesRef = useRef(queries);
  queriesRef.current = queries;
  useFocusEffect(
    useCallback(() => {
      for (const query of queriesRef.current) {
        if (query.isStale && !query.isFetching && isRunnable(query)) {
          // cancelRefetch: false joins a fetch already in flight instead
          // of restarting it.
          query.refetch({ cancelRefetch: false });
        }
      }
    }, []),
  );
}

/**
 * Screen-level view over the cached queries a screen is built from.
 *
 * `data` is the screen's combined result, derived by the caller (usually
 * in a useMemo over each query's `.data`), or `undefined` until it can
 * be built. Cached data, even stale, renders straight away while a
 * background refetch runs; an error only replaces the screen when there
 * is nothing to show and nothing left in flight.
 */
export function useQueryState<T>(
  queries: readonly AnyQuery[],
  data: T | undefined,
): QueryStateResult<T> {
  const [refreshing, setRefreshing] = useState(false);
  useRefetchStaleOnFocus(queries);

  const queriesRef = useRef(queries);
  queriesRef.current = queries;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(queriesRef.current.filter(isRunnable).map((q) => q.refetch()));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onRetry = useCallback(() => {
    for (const query of queriesRef.current) {
      if (query.isError) query.refetch();
    }
  }, []);

  return { state: toFetchState(queries, data), refreshing, onRefresh, onRetry };
}

function toFetchState<T>(
  queries: readonly AnyQuery[],
  data: T | undefined,
): FetchState<T> {
  if (data !== undefined) return { status: 'ok', data };
  if (queries.some((q) => q.isFetching)) return { status: 'loading' };
  const failed = queries.find((q) => q.isError);
  if (failed)
    return { status: 'error', message: failed.error?.message ?? String(failed.error) };
  return { status: 'loading' };
}
