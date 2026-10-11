import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { ClubFixture } from '../api/fixturesUpcoming';
import { opponentLabel, type GameweekFixtures } from '../fixtures/upcoming';
import { fixtureDifficultyColor } from '../transfers/scoring';
import {
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';

/** Height of a gameweek slot. A double gameweek splits it between two
 *  stacked chips, so a single chip and a double take the same row space. */
const SLOT_HEIGHT = 34;
const SINGLE_CHIP_HEIGHT = 24;
/** Opponent codes are always three letters; this keeps them on one line
 *  inside the narrowest chip. */
const CHIP_TEXT_SIZE = 10;

type Props = {
  /** One slot per upcoming gameweek; null while fixtures load. */
  fixtures: readonly GameweekFixtures[] | null;
};

/**
 * A player's next few fixtures as small chips coloured by FPL difficulty,
 * mint (easy) to coral (hard). Capitals mark a home game. A double
 * gameweek stacks two chips; a blank gameweek is an outlined empty chip.
 */
export function FixtureStrip({ fixtures }: Props) {
  const styles = useThemedStyles(makeStyles);

  if (fixtures == null) {
    return <Text style={styles.missing}>—</Text>;
  }
  return (
    <View style={styles.strip} accessible accessibilityLabel={describeRun(fixtures)}>
      {fixtures.map((gameweek, index) => (
        <View key={index} style={styles.slot}>
          {gameweek.length === 0 ? (
            <View style={[styles.chip, styles.singleChip, styles.blankChip]}>
              <Text style={styles.blankText}>—</Text>
            </View>
          ) : (
            gameweek.map((fixture, fixtureIndex) => (
              <FixtureChip
                key={fixtureIndex}
                fixture={fixture}
                isDouble={gameweek.length > 1}
              />
            ))
          )}
        </View>
      ))}
    </View>
  );
}

function FixtureChip({ fixture, isDouble }: { fixture: ClubFixture; isDouble: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const tone = fixtureDifficultyColor(fixture.difficulty, colors);

  return (
    <View
      style={[
        styles.chip,
        isDouble ? styles.doubleChip : styles.singleChip,
        { backgroundColor: tone.background },
      ]}
    >
      <Text style={[styles.chipText, { color: tone.text }]} numberOfLines={1}>
        {opponentLabel(fixture)}
      </Text>
    </View>
  );
}

function describeRun(fixtures: readonly GameweekFixtures[]): string {
  const slots = fixtures.map((gameweek) =>
    gameweek.length === 0
      ? 'no fixture'
      : gameweek
          .map((fixture) => {
            const venue = fixture.is_home ? 'home' : 'away';
            const rating =
              fixture.difficulty == null ? 'unrated' : `difficulty ${fixture.difficulty}`;
            return `${fixture.opponent ?? 'unknown'} ${venue}, ${rating}`;
          })
          .join(' and '),
  );
  return `Next fixtures: ${slots.join('; ')}`;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    strip: { flexDirection: 'row', gap: spacing.hairline },
    slot: {
      flex: 1,
      height: SLOT_HEIGHT,
      justifyContent: 'center',
      gap: spacing.hairline,
    },
    chip: {
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    singleChip: { height: SINGLE_CHIP_HEIGHT },
    doubleChip: { flex: 1 },
    blankChip: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    chipText: {
      fontSize: CHIP_TEXT_SIZE,
      fontWeight: '700',
    },
    blankText: { fontSize: CHIP_TEXT_SIZE, color: colors.textMuted },
    missing: {
      fontSize: fontSize.md,
      color: colors.textPrimary,
      textAlign: 'right',
    },
  });
