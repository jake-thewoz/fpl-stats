import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { ClubBackground } from '../../components/ClubBackground';
import { MatchStatusGlyph } from '../../gameweek/MatchStatusGlyph';
import { useTheme, useThemedStyles } from '../../theme';
import {
  formationLabel,
  startersByPosition,
  type Lineup,
  type LineupChange,
  type LineupSlot,
} from './lineup';
import { makeStyles } from './styles';

type Props = {
  lineup: Lineup;
  /** Short stat under each player's name, e.g. "8 pts" or "5.2 xP". */
  getStatText: (slot: LineupSlot) => string;
  refreshing: boolean;
  onRefresh: () => void;
};

const CHANGE_MARKERS: Record<LineupChange, { glyph: string; label: string }> = {
  in: { glyph: '↑', label: 'moved into the starting XI' },
  out: { glyph: '↓', label: 'dropped to the bench' },
};

/** Starting XI laid out by position on a pitch, bench strip below. */
export function PitchView({ lineup, getStatText, refreshing, onRefresh }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const bands = startersByPosition(lineup);

  return (
    <ScrollView
      contentContainerStyle={styles.pitchScrollBody}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.pitch}>
        <Text style={styles.formationLabel}>{formationLabel(lineup)}</Text>
        {bands.map((band, index) => (
          <View
            key={band.position}
            style={[
              styles.pitchBand,
              // Alternating bands read as mowing stripes.
              { backgroundColor: index % 2 === 0 ? colors.pitch : colors.pitchStripe },
            ]}
          >
            {band.slots.map((slot) => (
              <PlayerTile key={slot.row.id} slot={slot} statText={getStatText(slot)} />
            ))}
          </View>
        ))}
      </View>
      {lineup.bench.length > 0 ? (
        <View style={styles.bench}>
          <Text style={styles.benchLabel}>Bench</Text>
          <View style={styles.benchRow}>
            {lineup.bench.map((slot) => (
              <PlayerTile key={slot.row.id} slot={slot} statText={getStatText(slot)} />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function PlayerTile({ slot, statText }: { slot: LineupSlot; statText: string }) {
  const styles = useThemedStyles(makeStyles);
  const armband = slot.isCaptain ? 'C' : slot.isViceCaptain ? 'V' : null;
  const marker = slot.change ? CHANGE_MARKERS[slot.change] : null;

  return (
    <View style={styles.tile}>
      <View style={styles.shirt}>
        <ClubBackground teamShort={slot.row.team} fade={false} />
        {marker ? (
          <Text
            style={[
              styles.changeMarker,
              slot.change === 'in' ? styles.changeMarkerIn : styles.changeMarkerOut,
            ]}
            accessibilityLabel={marker.label}
          >
            {marker.glyph}
          </Text>
        ) : null}
        {armband ? (
          <Text
            style={[styles.playerBadge, styles.shirtBadge]}
            accessibilityLabel={slot.isCaptain ? 'captain' : 'vice-captain'}
          >
            {armband}
          </Text>
        ) : null}
      </View>
      <Text style={styles.tileName} numberOfLines={1}>
        <MatchStatusGlyph teamShort={slot.row.team} />
        {slot.row.name}
      </Text>
      <Text style={styles.tileStat} numberOfLines={1}>
        {statText}
      </Text>
    </View>
  );
}
