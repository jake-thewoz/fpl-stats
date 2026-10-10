import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { shouldRetryQuery } from './retry';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Data that moves while matches are being played: points, picks, ranks. */
export const LIVE_STALE_MS = MINUTE_MS;
/** Data refreshed by the 30-minute ingest or the daily analyzers. */
export const INGESTED_STALE_MS = 5 * MINUTE_MS;

const PERSISTED_MAX_AGE_MS = 24 * HOUR_MS;
const PERSISTED_CACHE_KEY = 'cache.queries';
// Bump when an API response shape changes incompatibly, so devices drop
// responses saved under the old shape instead of rendering them.
const PERSISTED_CACHE_VERSION = '1';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Persisted entries are only restored while they're still in
      // memory-cache terms alive, so gcTime has to cover the max age.
      gcTime: PERSISTED_MAX_AGE_MS,
      retry: shouldRetryQuery,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: PERSISTED_CACHE_KEY,
});

export const persistOptions = {
  persister: queryPersister,
  maxAge: PERSISTED_MAX_AGE_MS,
  buster: PERSISTED_CACHE_VERSION,
};

/**
 * Tells TanStack Query when the app returns to the foreground so stale
 * queries refetch. The browser build gets this from window focus events
 * out of the box; native needs AppState wired in by hand.
 */
export function subscribeToAppFocus(): () => void {
  if (Platform.OS === 'web') return () => {};
  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });
  return () => subscription.remove();
}
