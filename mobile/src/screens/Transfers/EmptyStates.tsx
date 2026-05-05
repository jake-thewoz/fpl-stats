import { Pressable, Text, View } from 'react-native';
import { useThemedStyles } from '../../theme';
import { makeStyles } from './styles';

export function NoTeamIdState({ onOpenSettings }: { onOpenSettings: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No team ID set</Text>
      <Text style={styles.emptyBody}>
        Add your Fantasy Premier League team ID in Settings to see transfer
        suggestions.
      </Text>
      <Pressable
        onPress={onOpenSettings}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Go to Settings</Text>
      </Pressable>
    </View>
  );
}

export function PicksNotFoundState({
  onOpenMyTeam,
}: {
  onOpenMyTeam: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>Squad not loaded</Text>
      <Text style={styles.emptyBody}>
        Open the My Team tab first to load your squad — suggestions need to
        know which players you currently have.
      </Text>
      <Pressable
        onPress={onOpenMyTeam}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Open My Team</Text>
      </Pressable>
    </View>
  );
}

export function MessageState({ title, body }: { title: string; body: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}
