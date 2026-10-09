import { Text, View } from 'react-native';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl';
import { FIELD_DEFS } from '../../players/fields';
import { useThemedStyles } from '../../theme';
import { formationLabel } from './lineup';
import { makeStyles } from './styles';
import {
  LINEUP_METRICS,
  type LineupMetric,
  type LineupSuggestion,
} from './suggestLineup';

export type LineupSource = 'yours' | 'suggested';

const SOURCE_OPTIONS: readonly SegmentOption<LineupSource>[] = [
  { value: 'yours', label: 'Yours' },
  { value: 'suggested', label: 'Suggested' },
];

const METRIC_OPTIONS: readonly SegmentOption<LineupMetric>[] = LINEUP_METRICS.map(
  (metric) => ({ value: metric, label: FIELD_DEFS[metric].shortLabel }),
);

type Props = {
  source: LineupSource;
  onChangeSource: (next: LineupSource) => void;
  metric: LineupMetric;
  onChangeMetric: (next: LineupMetric) => void;
  suggestion: LineupSuggestion | null;
  /** Gameweek the squad was picked for. */
  squadGameweek: number | null;
  /** Gameweek the xP projection covers (the next one). */
  targetGameweek: number | null;
};

/** Yours / Suggested toggle above the pitch, plus, when showing the
 *  suggestion, the metric picker and how it compares to the user's XI. */
export function LineupControls({
  source,
  onChangeSource,
  metric,
  onChangeMetric,
  suggestion,
  squadGameweek,
  targetGameweek,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const showingSuggestion = source === 'suggested';

  return (
    <View style={styles.lineupControls}>
      <View style={styles.lineupControlsRow}>
        <SegmentedControl
          options={SOURCE_OPTIONS}
          value={source}
          onChange={onChangeSource}
        />
        {showingSuggestion ? (
          <SegmentedControl
            options={METRIC_OPTIONS}
            value={metric}
            onChange={onChangeMetric}
          />
        ) : null}
      </View>
      {showingSuggestion ? (
        suggestion ? (
          <SuggestionSummary
            suggestion={suggestion}
            metric={metric}
            squadGameweek={squadGameweek}
            targetGameweek={targetGameweek}
          />
        ) : (
          <Text style={styles.lineupSummaryNote}>
            {"Can't build a legal XI from this squad."}
          </Text>
        )
      ) : null}
    </View>
  );
}

function SuggestionSummary({
  suggestion,
  metric,
  squadGameweek,
  targetGameweek,
}: {
  suggestion: LineupSuggestion;
  metric: LineupMetric;
  squadGameweek: number | null;
  targetGameweek: number | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { format, shortLabel } = FIELD_DEFS[metric];
  const gain = suggestion.suggestedScore - suggestion.currentScore;
  const gainText =
    // Anything that rounds to 0.0 on screen reads as "no change".
    format(gain) === format(0) ? 'same as yours' : `+${format(gain)} vs yours`;

  return (
    <>
      <Text style={styles.lineupSummary}>
        {targetGameweek != null ? `GW ${targetGameweek}  ·  ` : ''}
        {formationLabel(suggestion.lineup)} · {format(suggestion.suggestedScore)}{' '}
        {shortLabel} ({gainText})
      </Text>
      {squadGameweek != null ? (
        <Text style={styles.lineupSummaryNote}>
          {`Picked from your GW ${squadGameweek} squad. Transfers made since then aren't visible.`}
        </Text>
      ) : null}
    </>
  );
}
