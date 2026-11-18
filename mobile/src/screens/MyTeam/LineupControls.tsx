import { View } from 'react-native';
import { Text } from '../../components/Text';
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl';
import { FIELD_DEFS } from '../../players/fields';
import { useThemedStyles } from '../../theme';
import { formationLabel } from './lineup';
import { makeStyles } from './styles';
import { ControlButton } from '../../components/ControlButton';
import {
  WILDCARD_METRICS,
  type WildcardMetric,
  type WildcardSuggestion,
} from './wildcard';
import {
  LINEUP_METRICS,
  type LineupMetric,
  type LineupSuggestion,
} from './suggestLineup';

export type LineupSource = 'yours' | 'suggested' | 'wildcard';

const SOURCE_OPTIONS: readonly SegmentOption<LineupSource>[] = [
  { value: 'yours', label: 'Yours' },
  { value: 'suggested', label: 'Suggested' },
  { value: 'wildcard', label: 'Wildcard' },
];

const WILDCARD_METRIC_OPTIONS: readonly SegmentOption<WildcardMetric>[] =
  WILDCARD_METRICS.map((metric) => ({
    value: metric,
    label: FIELD_DEFS[metric].shortLabel,
  }));

/** One tap on the budget stepper: £0.1m, FPL's price granularity. */
const BUDGET_STEP = 0.1;

const formatPrice = (millions: number) => `£${millions.toFixed(1)}m`;

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
  wildcard: WildcardControlsProps;
};

export type WildcardControlsProps = {
  metric: WildcardMetric;
  onChangeMetric: (next: WildcardMetric) => void;
  /** £m. */
  budget: number;
  onChangeBudget: (next: number) => void;
  suggestion: WildcardSuggestion | null;
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
  wildcard,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const showingSuggestion = source === 'suggested';

  if (source === 'wildcard') {
    return (
      <View style={styles.lineupControls}>
        <SegmentedControl
          options={SOURCE_OPTIONS}
          value={source}
          onChange={onChangeSource}
        />
        <WildcardControls {...wildcard} targetGameweek={targetGameweek} />
      </View>
    );
  }

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

  const { starters, bench } = suggestion.lineup;
  const hasChanges = [...starters, ...bench].some((slot) => slot.change != null);
  const notes = [
    hasChanges ? '↑ starts a bench player, ↓ benches a starter.' : null,
    squadGameweek != null
      ? `Picked from your GW ${squadGameweek} squad, so transfers made since then aren't included.`
      : null,
  ].filter(Boolean);

  return (
    <>
      <Text style={styles.lineupSummary}>
        Best XI by {shortLabel}
        {targetGameweek != null ? ` for GW ${targetGameweek}` : ''} ·{' '}
        {formationLabel(suggestion.lineup)} · {format(suggestion.suggestedScore)}{' '}
        {shortLabel} ({gainText})
      </Text>
      <Text style={styles.lineupSummaryNote}>{notes.join(' ')}</Text>
    </>
  );
}

function WildcardControls({
  metric,
  onChangeMetric,
  budget,
  onChangeBudget,
  suggestion,
  targetGameweek,
}: WildcardControlsProps & { targetGameweek: number | null }) {
  const styles = useThemedStyles(makeStyles);
  const { format, shortLabel } = FIELD_DEFS[metric];
  const step = (delta: number) => onChangeBudget(Math.round((budget + delta) * 10) / 10);

  return (
    <>
      <SegmentedControl
        options={WILDCARD_METRIC_OPTIONS}
        value={metric}
        onChange={onChangeMetric}
      />
      <View style={styles.budgetRow}>
        <Text style={styles.lineupSummary}>Budget {formatPrice(budget)}</Text>
        <ControlButton label="−" onPress={() => step(-BUDGET_STEP)} />
        <ControlButton label="+" onPress={() => step(BUDGET_STEP)} />
      </View>
      {suggestion ? (
        <>
          <Text style={styles.lineupSummary}>
            Best squad by {shortLabel}
            {metric.startsWith('xp') && targetGameweek != null
              ? ` from GW ${targetGameweek}`
              : ''}{' '}
            · {formatPrice(suggestion.cost)} · XI {format(suggestion.score)} {shortLabel}
          </Text>
          {suggestion.outgoing.length > 0 ? (
            <>
              <Text style={styles.lineupSummaryNote}>
                Out: {suggestion.outgoing.map((row) => row.name).join(', ')}
              </Text>
              <Text style={styles.lineupSummaryNote}>
                In: {suggestion.incoming.map((row) => row.name).join(', ')}
              </Text>
            </>
          ) : (
            <Text style={styles.lineupSummaryNote}>Your squad is already the best.</Text>
          )}
          <Text style={styles.lineupSummaryNote}>
            + marks a player not in your squad. Bench scores count 10%, so the money goes
            on the XI. Budget starts at your squad&apos;s current value plus bank; FPL
            sells at your selling price, so lower it to match.
            {suggestion.optimal ? '' : ' Search stopped early; close to best.'}
          </Text>
        </>
      ) : (
        <Text style={styles.lineupSummaryNote}>No legal squad fits this budget.</Text>
      )}
    </>
  );
}
