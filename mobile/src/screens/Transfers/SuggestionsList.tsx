import { useCallback, useState } from 'react';
import { FlatList, LayoutAnimation, RefreshControl, Text, View } from 'react-native';
import type { Player } from '../../api/players';
import type { TransferSuggestionsResponse } from '../../api/transferSuggestions';
import { useThemedStyles } from '../../theme';
import { BundleCard, bundleKey } from './BundleCard';
import { makeStyles } from './styles';

/**
 * The bundle-card list itself, wrapped in a FlatList with the header
 * pinned to the top and pull-to-refresh on the scroll. Owns the
 * "one card expanded at a time" state.
 */
export function SuggestionsList({
  response,
  playersById,
  refreshing,
  onRefresh,
}: {
  response: TransferSuggestionsResponse;
  playersById: Map<number, Player>;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const styles = useThemedStyles(makeStyles);
  // Stable per-bundle key (joined out-in pairs) survives data refreshes —
  // if the same bundle is still in the list after a refresh, it stays
  // expanded.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const toggleExpand = useCallback((key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <FlatList
      data={response.bundles}
      keyExtractor={bundleKey}
      renderItem={({ item }) => {
        const key = bundleKey(item);
        return (
          <BundleCard
            bundle={item}
            playersById={playersById}
            isExpanded={expandedKey === key}
            onToggle={() => toggleExpand(key)}
          />
        );
      }}
      ListHeaderComponent={
        <Header
          horizonGwIds={response.horizon_gw_ids}
          currentSquadXp={response.current_squad_xp}
          freeTransfers={response.free_transfers}
          freehitActive={response.freehit_active}
        />
      }
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
}

function Header({
  horizonGwIds,
  currentSquadXp,
  freeTransfers,
  freehitActive,
}: {
  horizonGwIds: number[];
  currentSquadXp: number | undefined;
  freeTransfers: number;
  freehitActive: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  if (horizonGwIds.length === 0) return null;
  const range =
    horizonGwIds.length === 1
      ? `GW ${horizonGwIds[0]}`
      : `GWs ${horizonGwIds[0]}–${horizonGwIds[horizonGwIds.length - 1]}`;
  const ftLabel =
    freeTransfers === 1 ? '1 free transfer' : `${freeTransfers} free transfers`;
  return (
    <View style={styles.header}>
      <Text style={styles.headerLine}>Top transfers across {range}</Text>
      <Text style={styles.headerSub}>
        {ftLabel}
        {typeof currentSquadXp === 'number'
          ? ` · current squad projected ${currentSquadXp.toFixed(1)} xP`
          : ''}
      </Text>
      {freehitActive ? (
        <Text style={styles.headerFreehitNote}>
          Free Hit active — suggestions are for your persistent squad (not the temporary
          FH eleven), so they apply once your real team reappears at the next deadline.
        </Text>
      ) : null}
    </View>
  );
}
