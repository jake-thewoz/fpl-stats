import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from '../components/Text';
import { effects, fontSize, useThemedStyles, type Colors } from '../theme';
import { HelpDialog } from './HelpDialog';
import { HELP_TOPICS, type HelpTopicKey } from './topics';

// Matches the tab-bar icon size, so it reads as a tappable glyph.
const CIRCLE_SIZE = 24;

/** Header "?" that opens the help for one tab. Owns its dialog, so a
 *  stack can drop it into `headerRight` without screen state. */
export function HelpButton({ topic }: { topic: HelpTopicKey }) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const { title } = HELP_TOPICS[topic];

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Help: ${title}`}
        style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
      >
        <Text style={styles.glyph}>?</Text>
      </Pressable>
      <HelpDialog
        visible={open}
        onClose={() => setOpen(false)}
        title={`About ${title}`}
        topics={[HELP_TOPICS[topic]]}
      />
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    circle: {
      width: CIRCLE_SIZE,
      height: CIRCLE_SIZE,
      borderRadius: CIRCLE_SIZE / 2,
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    glyph: { fontSize: fontSize.sm2, fontWeight: '700', color: colors.textMuted },
    pressed: effects.pressed,
  });
