import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { getFriends, removeFriend, type Friend } from '../storage/friends';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { colors } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ManageFriends'>;

export default function ManageFriendsScreen({ navigation }: Props) {
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingVertical: 8 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  emptyBody: {
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryBtn: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  primaryBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: { opacity: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLeft: { flex: 1, paddingRight: 12 },
  rowAlias: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  rowId: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  removeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: 'transparent',
  },
  removeBtnText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  footerWrap: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  addBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  addBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  importBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  importBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
});
