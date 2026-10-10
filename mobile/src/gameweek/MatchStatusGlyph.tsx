import { Text } from 'react-native';
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
export function MatchStatusGlyph({ teamShort }: { teamShort: string }) {
  const { colors } = useTheme();
  const status = useClubMatchStatus(teamShort);
  const glyph = status ? GLYPHS[status] : undefined;
  if (glyph == null) return null;
  return (
    <Text style={{ color: status === 'live' ? colors.live : colors.textMuted }}>
      {`${glyph} `}
    </Text>
  );
}
