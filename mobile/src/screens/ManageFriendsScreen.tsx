import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getFriends, removeFriend, type Friend } from '../storage/friends';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ManageFriendsScreenProps } from '../navigation/types';
import {
  effects,
  fontSize,
  radius,
  spacing,
  useTheme,
  useThemedStyles,
  type Colors,
} from '../theme';

type Props = ManageFriendsScreenProps;

export default function ManageFriendsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Friend | null>(null);

  // Re-read the list every time the screen gets focus — that way a friend
  // added from AddFriend shows up the instant we navigate back.
  useFocusEffect(
    useCallback(() => {
      getFriends().then(setFriends);
    }, []),
  );

  async function onConfirmRemove() {
    if (!removeTarget) return;
    const next = await removeFriend(removeTarget.id);
    setFriends(next);
    setRemoveTarget(null);
  }

  if (friends === null) {
    return <View style={styles.container} />;
  }

  return (
    <>
      <View style={styles.container}>
        {friends.length === 0 ? (
          <EmptyState
            onAdd={() => navigation.navigate('AddFriend')}
            onImport={() => navigation.navigate('ImportLeague')}
          />
        ) : (
          <FlatList
            data={friends}
            keyExtractor={(f) => f.id}
            renderItem={({ item }) => (
              <FriendRow friend={item} onRemove={() => setRemoveTarget(item)} />
            )}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              <ListFooter
                onAdd={() => navigation.navigate('AddFriend')}
                onImport={() => navigation.navigate('ImportLeague')}
              />
            }
          />
        )}
      </View>
      <ConfirmDialog
        visible={removeTarget !== null}
        title="Remove friend?"
        message={
          removeTarget
            ? `Remove "${removeTarget.alias}" from your list? You can add them back any time.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={onConfirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}

function EmptyState({
  onAdd,
  onImport,
}: {
  onAdd: () => void;
  onImport: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>No friends yet</Text>
      <Text style={styles.emptyBody}>
        Add FPL team IDs to compare scores and track your mini-league rivals.
      </Text>
      <Pressable
        onPress={onAdd}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Add a friend</Text>
      </Pressable>
      <Pressable
        onPress={onImport}
        style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryBtnText}>Import from league</Text>
      </Pressable>
    </View>
  );
}

function FriendRow({
  friend,
  onRemove,
}: {
  friend: Friend;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowAlias} numberOfLines={1}>
          {friend.alias}
        </Text>
        <Text style={styles.rowId}>Team ID {friend.id}</Text>
      </View>
      <Pressable
        onPress={onRemove}
        style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${friend.alias}`}
        hitSlop={8}
      >
        <Text style={styles.removeBtnText}>Remove</Text>
      </Pressable>
    </View>
  );
}

function ListFooter({
  onAdd,
  onImport,
}: {
  onAdd: () => void;
  onImport: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.footerWrap}>
      <Pressable
        onPress={onAdd}
        style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.addBtnText}>+ Add friend</Text>
      </Pressable>
      <Pressable
        onPress={onImport}
        style={({ pressed }) => [styles.importBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.importBtnText}>Import from league</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    listContent: { paddingVertical: spacing.md },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxxl,
      gap: spacing.lg,
    },
    emptyTitle: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
    emptyBody: {
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 22,
    },
    primaryBtn: {
      marginTop: spacing.lg,
      paddingHorizontal: spacing.xxl,
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      backgroundColor: colors.accent,
    },
    primaryBtnText: { color: colors.onAccent, fontSize: fontSize.base, fontWeight: '600' },
    secondaryBtn: {
      paddingHorizontal: spacing.xxl,
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    secondaryBtnText: {
      color: colors.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
    pressed: effects.pressed,
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.lg2,
      paddingHorizontal: spacing.xl,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowLeft: { flex: 1, paddingRight: spacing.lg },
    rowAlias: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
    rowId: {
      marginTop: spacing.hairline,
      color: colors.textMuted,
      fontSize: fontSize.sm2,
      fontVariant: ['tabular-nums'],
    },
    removeBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: 'transparent',
    },
    removeBtnText: { color: colors.danger, fontSize: fontSize.sm2, fontWeight: '600' },
    footerWrap: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.base },
    addBtn: {
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      alignItems: 'center',
      backgroundColor: colors.accent,
    },
    addBtnText: { color: colors.onAccent, fontSize: fontSize.base, fontWeight: '600' },
    importBtn: {
      paddingVertical: spacing.lg,
      borderRadius: radius.base,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    importBtnText: {
      color: colors.textPrimary,
      fontSize: fontSize.base,
      fontWeight: '600',
    },
  });
