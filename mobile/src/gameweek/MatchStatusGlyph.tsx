import { Text } from '../components/Text';
import { useTheme } from '../theme';
import { useClubMatchStatus } from './GameweekStatusProvider';
import type { MatchStatus } from './status';

const GLYPHS: Partial<Record<MatchStatus, string>> = {
  live: '●',
  done: '✓',
};

/**
 * Inline marker for a player whose club is playing now (●) or has
 * finished this gameweek (✓); nothing before kickoff or outside a live
 * gameweek. A nested <Text>, so render it inside the name's <Text>.
 */
export function MatchStatusGlyph({
  teamShort,
  onDarkPlate = false,
}: {
  teamShort: string;
  /** Sits on the pitch's dark name plate in both themes, where the
   *  surface-tuned text colours don't read. */
  onDarkPlate?: boolean;
}) {
  const { colors } = useTheme();
  const status = useClubMatchStatus(teamShort);
  const glyph = status ? GLYPHS[status] : undefined;
  if (glyph == null) return null;
  const color =
    status === 'live'
      ? onDarkPlate
        ? colors.good
        : colors.goodText
      : onDarkPlate
        ? colors.pitchLine
        : colors.textMuted;
  return <Text style={{ color }}>{`${glyph} `}</Text>;
}
