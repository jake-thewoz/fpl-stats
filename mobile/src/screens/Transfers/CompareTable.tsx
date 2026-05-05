import { Text, View } from 'react-native';
import type { TransferMove } from '../../api/transferSuggestions';
import { useThemedStyles } from '../../theme';
import {
  difficultyTone,
  eloTone,
  type ColorTone,
} from '../../transfers/scoring';
import { makeStyles } from './styles';

/**
 * Expanded comparison panel under a move row (#97). Three columns:
 * metric label / out value / in value. Cells with a fixture-quality
 * tone tint background + text on the sage/warning/danger scale.
 */
export function CompareTable({ move }: { move: TransferMove }) {
  const styles = useThemedStyles(makeStyles);
  const { out, in: inP } = move;

  return (
    <View style={styles.compareTable}>
      <View style={styles.compareDivider} />
      <Row
        label="Form"
        outText={fmt(out.form_score, 1)}
        inText={fmt(inP.form_score, 1)}
      />
      <Row
        label="Avg fixture difficulty"
        outText={fmt(out.avg_upcoming_difficulty, 1)}
        inText={fmt(inP.avg_upcoming_difficulty, 1)}
        outTone={difficultyTone(out.avg_upcoming_difficulty)}
        inTone={difficultyTone(inP.avg_upcoming_difficulty)}
      />
      <Row
        label="Avg ELO win prob"
        outText={fmt(out.avg_upcoming_elo_expected_score, 2)}
        inText={fmt(inP.avg_upcoming_elo_expected_score, 2)}
        outTone={eloTone(out.avg_upcoming_elo_expected_score)}
        inTone={eloTone(inP.avg_upcoming_elo_expected_score)}
      />
      <Row
        label="Horizon xP"
        outText={fmt(out.horizon_xp, 1)}
        inText={fmt(inP.horizon_xp, 1)}
      />
    </View>
  );
}

function Row({
  label,
  outText,
  inText,
  outTone = null,
  inTone = null,
}: {
  label: string;
  outText: string;
  inText: string;
  outTone?: ColorTone;
  inTone?: ColorTone;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareLabel}>{label}</Text>
      <ToneCell text={outText} tone={outTone} />
      <ToneCell text={inText} tone={inTone} />
    </View>
  );
}

function ToneCell({ text, tone }: { text: string; tone: ColorTone }) {
  const styles = useThemedStyles(makeStyles);
  // Tone styles tint background + text. Null tone = neutral cell with
  // primary text color, so "—" and uncolored metrics share the look.
  const cellStyle =
    tone === 'good'
      ? styles.toneCellGood
      : tone === 'mid'
        ? styles.toneCellMid
        : tone === 'bad'
          ? styles.toneCellBad
          : null;
  const textStyle =
    tone === 'good'
      ? styles.toneTextGood
      : tone === 'mid'
        ? styles.toneTextMid
        : tone === 'bad'
          ? styles.toneTextBad
          : styles.toneTextNeutral;
  return (
    <View style={[styles.compareCell, cellStyle]}>
      <Text style={[styles.compareCellText, textStyle]}>{text}</Text>
    </View>
  );
}

function fmt(value: number | null, digits: number): string {
  return value == null ? '—' : value.toFixed(digits);
}
