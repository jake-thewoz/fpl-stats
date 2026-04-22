import { useCallback, useEffect, useState } from 'react';

export type FetchState<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; message: string };

export type UseFetchResult<T> = {
  state: FetchState<T>;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onRetry: () => void;
};

/**
 * Standard fetch-on-mount state machine used by every data screen.
 *
 * Pass a stable fetcher reference (module-level function or a
 * useCallback-wrapped one) — it lives in an effect dependency, so a new
 * reference every render would loop forever.
 */
export function useFetch<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
): UseFetchResult<T> {
  const [state, setState] = useState<FetchState<T>>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const data = await fetcher(signal);
        if (signal.aborted) return;
        setState({ status: 'ok', data });
      } catch (err: unknown) {
        if (signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: 'error', message });
      }
    },
    [fetcher],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const onRefresh = useCallback(async () => {
    const controller = new AbortController();
    setRefreshing(true);
    try {
      await load(controller.signal);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onRetry = useCallback(() => {
    setState({ status: 'loading' });
    const controller = new AbortController();
    load(controller.signal);
  }, [load]);

  return { state, refreshing, onRefresh, onRetry };
}
