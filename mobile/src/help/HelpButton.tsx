import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { effects, useTheme } from '../theme';
import { HelpDialog } from './HelpDialog';
import { HELP_TOPICS, type HelpTopicKey } from './topics';

// Matches the tab-bar icon size, so it reads as a tappable glyph.
const ICON_SIZE = 24;

/** Header "?" that opens the help for one tab. Owns its dialog, so a
 *  stack can drop it into `headerRight` without screen state. */
export function HelpButton({ topic }: { topic: HelpTopicKey }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const { title } = HELP_TOPICS[topic];

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Help: ${title}`}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Ionicons name="help-circle-outline" size={ICON_SIZE} color={colors.accent} />
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

const styles = StyleSheet.create({ pressed: effects.pressed });
