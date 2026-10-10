import { queryOptions } from '@tanstack/react-query';
import { fetchEntry } from '../api/entry';
import { fetchEntryGameweek } from '../api/entryGameweek';
import { fetchGameweekCurrent } from '../api/gameweekCurrent';
import { fetchGameweekLive } from '../api/gameweekLive';
import { fetchPlayers } from '../api/players';
import { fetchPlayersXp } from '../api/playersXp';
import {
  fetchTransferSuggestions,
  type TransferSuggestionsParams,
} from '../api/transferSuggestions';
import { INGESTED_STALE_MS, LIVE_STALE_MS } from './client';

/**
 * One query per API endpoint. Screens combine these rather than caching
 * their own joined results, so a response fetched by one tab (e.g.
 * `/players`) is reused by every other tab.
 */

export const gameweekCurrentQuery = () =>
  queryOptions({
    queryKey: ['gameweekCurrent'],
    queryFn: ({ signal }) => fetchGameweekCurrent(signal),
    staleTime: INGESTED_STALE_MS,
  });

export const playersQuery = () =>
  queryOptions({
    queryKey: ['players'],
    queryFn: ({ signal }) => fetchPlayers(signal),
    staleTime: INGESTED_STALE_MS,
  });

export const playersXpQuery = () =>
  queryOptions({
    queryKey: ['playersXp'],
    queryFn: ({ signal }) => fetchPlayersXp(signal),
    staleTime: INGESTED_STALE_MS,
  });

export const entryQuery = (teamId: string) =>
  queryOptions({
    queryKey: ['entry', teamId],
    queryFn: ({ signal }) => fetchEntry(teamId, signal),
    staleTime: LIVE_STALE_MS,
  });

export const entryGameweekQuery = (teamId: string, gameweek: number) =>
  queryOptions({
    queryKey: ['entryGameweek', teamId, gameweek],
    queryFn: ({ signal }) => fetchEntryGameweek(teamId, gameweek, signal),
    staleTime: LIVE_STALE_MS,
  });

export const gameweekLiveQuery = (gameweek: number) =>
  queryOptions({
    queryKey: ['gameweekLive', gameweek],
    queryFn: ({ signal }) => fetchGameweekLive(gameweek, signal),
    staleTime: LIVE_STALE_MS,
  });

export const transferSuggestionsQuery = (
  teamId: string,
  params: TransferSuggestionsParams,
) =>
  queryOptions({
    // Sorted so [2, 3] and [3, 2] share one cache entry.
    queryKey: [
      'transferSuggestions',
      teamId,
      params.horizon,
      [...params.positions].sort((a, b) => a - b),
      params.maxTransfers,
      params.freeTransfers,
    ],
    queryFn: ({ signal }) => fetchTransferSuggestions(teamId, params, signal),
    staleTime: INGESTED_STALE_MS,
  });
