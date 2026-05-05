import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { DEFAULT_COLUMNS, DEFAULT_SORT } from '../players/fields';
import {
  loadColumns,
  loadFilters,
  loadSort,
  saveColumns,
  saveFilters,
  saveSort,
} from '../players/storage';
import {
  EMPTY_FILTER,
  type FieldKey,
  type FilterState,
  type SortState,
} from '../players/types';

export type FocusedPlayersConfig = {
  columns: FieldKey[];
  filters: FilterState;
  sort: SortState;
  setColumns: (next: FieldKey[]) => void;
  setFilters: (next: FilterState) => void;
  setSort: (next: SortState) => void;
};

/**
 * Players-list view config (visible columns, applied filters, sort
 * order) shared between the Players and My Team screens via a single
 * set of AsyncStorage keys. Re-reads on screen focus so a change made
 * on either screen propagates back when the user returns. Setters
 * persist in the background — the UI doesn't wait.
 *
 * Replaces the duplicated load-on-focus + setter-with-save blocks
 * that PlayersScreen and MyTeamScreen used to maintain in parallel.
 */
export function useFocusedPlayersConfig(): FocusedPlayersConfig {
  const [columns, setColumnsState] = useState<FieldKey[]>(DEFAULT_COLUMNS);
  const [filters, setFiltersState] = useState<FilterState>(EMPTY_FILTER);
  const [sort, setSortState] = useState<SortState>(DEFAULT_SORT);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([loadColumns(), loadFilters(), loadSort()]).then(
        ([c, f, s]) => {
          if (!alive) return;
          setColumnsState(c);
          setFiltersState(f);
          setSortState(s);
        },
      );
      return () => {
        alive = false;
      };
    }, []),
  );

  const setColumns = useCallback((next: FieldKey[]) => {
    setColumnsState(next);
    saveColumns(next);
  }, []);
  const setFilters = useCallback((next: FilterState) => {
    setFiltersState(next);
    saveFilters(next);
  }, []);
  const setSort = useCallback((next: SortState) => {
    setSortState(next);
    saveSort(next);
  }, []);

  return { columns, filters, sort, setColumns, setFilters, setSort };
}
