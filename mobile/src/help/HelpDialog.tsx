import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { DialogShell } from '../components/dialog/DialogShell';
import { Section } from '../components/dialog/Section';
import { fontSize, spacing, useThemedStyles, type Colors } from '../theme';
import type { HelpEntry, HelpTopic } from './topics';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  topics: readonly HelpTopic[];
};

/** Glossary-style help: each topic's sections as dialog sections of
 *  term / meaning rows. With several topics, each topic's name prefixes
 *  its section titles so the full guide stays navigable. */
export function HelpDialog({ visible, onClose, title, topics }: Props) {
  const styles = useThemedStyles(makeStyles);
  const showTopicNames = topics.length > 1;
  // Topics share sections (e.g. xP); the full guide shows each once.
  const seen = new Set<string>();

  return (
    <DialogShell
      visible={visible}
      onClose={onClose}
      title={title}
      rightAction={{ label: 'Done', onPress: onClose }}
    >
      <ScrollView contentContainerStyle={styles.scrollBody}>
        {topics.flatMap((topic) =>
          topic.sections
            .filter((section) => {
              if (seen.has(section.title)) return false;
              seen.add(section.title);
              return true;
            })
            .map((section) => (
              <Section
                key={`${topic.title}-${section.title}`}
                title={
                  showTopicNames ? `${topic.title} · ${section.title}` : section.title
                }
                hint={section.intro}
              >
                {section.entries.map((entry) => (
                  <EntryRow key={entry.term} entry={entry} />
                ))}
              </Section>
            )),
        )}
      </ScrollView>
    </DialogShell>
  );
}

function EntryRow({ entry }: { entry: HelpEntry }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.term}>{entry.term}</Text>
      <Text style={styles.meaning}>{entry.meaning}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    scrollBody: { paddingBottom: spacing.xxxl },
    row: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
      gap: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    term: { fontSize: fontSize.base, fontWeight: '600', color: c.textPrimary },
    meaning: { fontSize: fontSize.md, color: c.textMuted, lineHeight: 20 },
  });
