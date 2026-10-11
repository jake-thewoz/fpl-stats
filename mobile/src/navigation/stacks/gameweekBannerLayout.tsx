import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { GameweekBanner } from '../../gameweek/GameweekBanner';

/**
 * Stack `screenLayout` that puts the gameweek banner at the top of every
 * screen, under its header. Rendering it inside each stack rather than
 * above the tab navigator keeps the stack headers in charge of the
 * status-bar inset.
 */
export function gameweekBannerLayout({ children }: { children: ReactElement }) {
  return (
    <View style={styles.fill}>
      <GameweekBanner />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
