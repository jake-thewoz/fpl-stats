import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { GameweekBanner } from '../../gameweek/GameweekBanner';
import type { MyTeamStackParamList } from '../types';

// The banner leads to the fixtures screen, so it has nothing to add there.
const FIXTURES_ROUTE = 'Gameweek' satisfies keyof MyTeamStackParamList;

/**
 * Stack `screenLayout` that puts the gameweek banner at the top of every
 * screen, under its header. Rendering it inside each stack rather than
 * above the tab navigator keeps the stack headers in charge of the
 * status-bar inset.
 */
export function gameweekBannerLayout({
  children,
  route,
}: {
  children: ReactElement;
  route: { name: string };
}) {
  if (route.name === FIXTURES_ROUTE) return children;
  return (
    <View style={styles.fill}>
      <GameweekBanner />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
