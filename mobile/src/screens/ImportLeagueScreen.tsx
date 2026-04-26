import { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  fetchLeagueMembers,
  LeagueNotFoundError,
  type LeagueInfo,
  type LeagueMember,
} from '../api/leagueMembers';
import { addFriend, getFriends } from '../storage/friends';
import { getFplTeamId } from '../storage/user';
import type { ImportLeagueScreenProps } from '../navigation/types';
import { colors } from '../theme';

type Props = ImportLeagueScreenProps;

type Step =
  | { status: 'idle' }
  | { status: 'validating' }
  | {
      status: 'loaded';
      league: LeagueInfo;
      members: LeagueMember[];
      hasMore: boolean;
      selected: Set<number>; // entry ids
      alreadyAdded: Set<number>;
      userTeamId: number | null;
    }
  | { status: 'error'; message: string };

export default function ImportLeagueScreen({ navigation }: Props) {
  const [leagueIdInput, setLeagueIdInput] = useState('');
  const [step, setStep] = useState<Step>({ status: 'idle' });
  const [saving, setSaving] = useState(false);

  // Kick off the two cheap AsyncStorage reads eagerly so the Import step
  // doesn't wait on them after the network call resolves.
  const [userTeamId, setUserTeamId] = useState<number | null>(null);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    getFplTeamId().then((id) => setUserTeamId(id ? Number(id) : null));
    getFriends().then((fs) => setExistingIds(new Set(fs.map((f) => f.id))));
  }, []);

  async function onFind() {
    const trimmed = leagueIdInput.trim();
    if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
      setStep({
        status: 'error',
        message: 'Enter a positive number — the league ID.',
      });
      return;
    }
    setStep({ status: 'validating' });
    try {
      const resp = await fetchLeagueMembers(trimmed);
      const alreadyAdded = new Set<number>();
      for (const m of resp.members) {
        if (existingIds.has(String(m.entry))) alreadyAdded.add(m.entry);
      }
      // Default selection: everyone except the user and anyone already in
      // their friends list.
      const selected = new Set<number>();
      for (const m of resp.members) {
        if (m.entry === userTeamId) continue;
        if (alreadyAdded.has(m.entry)) continue;
        selected.add(m.entry);
      }
      setStep({
        status: 'loaded',
        league: resp.league,
        members: resp.members,
        hasMore: resp.has_more,
        selected,
        alreadyAdded,
        userTeamId,
      });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        setStep({
          status: 'error',
          message: `No FPL league found with ID ${trimmed}. Double-check the number in the league's URL on the FPL site.`,
        });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setStep({
          status: 'error',
          message: `Couldn't load league — ${message}. Try again.`,
        });
      }
    }
  }

  function toggleSelection(entry: number) {
    if (step.status !== 'loaded') return;
    const next = new Set(step.selected);
    if (next.has(entry)) next.delete(entry);
    else next.add(entry);
    setStep({ ...step, selected: next });
  }

  function selectAll() {
    if (step.status !== 'loaded') return;
    const next = new Set<number>();
    for (const m of step.members) {
      if (m.entry === step.userTeamId) continue;
      next.add(m.entry);
    }
    setStep({ ...step, selected: next });
  }

  function selectNone() {
    if (step.status !== 'loaded') return;
    setStep({ ...step, selected: new Set() });
  }

  async function onImport() {
    if (step.status !== 'loaded') return;
    const toImport = step.members.filter((m) => step.selected.has(m.entry));
    if (toImport.length === 0) return;
    setSaving(true);
    try {
      for (const m of toImport) {
        await addFriend({
          id: String(m.entry),
          alias: m.entry_name,
        });
      }
      navigation.goBack();
    } catch (err) {
      setSaving(false);
      const message = err instanceof Error ? err.message : String(err);
      setStep({ status: 'error', message: `Couldn't save — ${message}.` });
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>League ID</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="e.g. 123456"
          placeholderTextColor={colors.textMuted}
          value={leagueIdInput}
          onChangeText={(v) => {
            setLeagueIdInput(v);
            if (step.status !== 'idle' && step.status !== 'validating') {
              setStep({ status: 'idle' });
            }
          }}
          keyboardType="number-pad"
          autoFocus
          autoCorrect={false}
          editable={step.status !== 'validating' && !saving}
          accessibilityLabel="FPL league ID"
        />
        <Pressable
          onPress={onFind}
          disabled={step.status === 'validating' || saving}
          style={({ pressed }) => [
            styles.findBtn,
            (pressed || step.status === 'validating') && styles.pressed,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.findBtnText}>
            {step.status === 'validating' ? 'Checking…' : 'Find'}
          </Text>
        </Pressable>
      </View>

      {step.status === 'error' && (
        <Text style={styles.error}>{step.message}</Text>
      )}

      {step.status === 'loaded' && (
        <LoadedBlock
          league={step.league}
          members={step.members}
          hasMore={step.hasMore}
          selected={step.selected}
          alreadyAdded={step.alreadyAdded}
          userTeamId={step.userTeamId}
          onToggle={toggleSelection}
          onSelectAll={selectAll}
          onSelectNone={selectNone}
          onImport={onImport}
          saving={saving}
        />
      )}
    </View>
  );
}

// ---- Loaded-state block -----------------------------------------------------

function LoadedBlock({
  league,
  members,
  hasMore,
  selected,
  alreadyAdded,
  userTeamId,
  onToggle,
  onSelectAll,
  onSelectNone,
  onImport,
  saving,
}: {
  league: LeagueInfo;
  members: LeagueMember[];
  hasMore: boolean;
  selected: Set<number>;
  alreadyAdded: Set<number>;
  userTeamId: number | null;
  onToggle: (entry: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onImport: () => void;
  saving: boolean;
}) {
  const count = selected.size;
  return (
    <>
      <View style={styles.leagueHeader}>
        <Text style={styles.leagueName} numberOfLines={1}>
          {league.name}
        </Text>
        <Text style={styles.leagueMeta}>
          {count} of {members.length} selected
          {hasMore ? ' (first 50 members)' : ''}
        </Text>
        <View style={styles.selectionActions}>
          <Pressable onPress={onSelectAll} hitSlop={6}>
            {({ pressed }) => (
              <Text style={[styles.selectLink, pressed && styles.pressed]}>
                Select all
              </Text>
            )}
          </Pressable>
          <Text style={styles.selectSep}>·</Text>
          <Pressable onPress={onSelectNone} hitSlop={6}>
            {({ pressed }) => (
              <Text style={[styles.selectLink, pressed && styles.pressed]}>
                Select none
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      <FlatList
        data={members}
        keyExtractor={(m) => String(m.entry)}
        renderItem={({ item }) => {
          const isMe = item.entry === userTeamId;
          const added = alreadyAdded.has(item.entry);
          return (
            <MemberRow
              member={item}
              selected={selected.has(item.entry)}
              disabled={isMe}
              disabledLabel={isMe ? 'You' : added ? 'Already added' : null}
              onToggle={() => onToggle(item.entry)}
            />
          );
        }}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />

      <Pressable
        onPress={onImport}
        disabled={count === 0 || saving}
        style={({ pressed }) => [
          styles.importBtn,
          (count === 0 || saving) && styles.importBtnDisabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.importBtnText}>
          {saving
            ? 'Saving…'
            : count === 0
            ? 'Select friends to import'
            : `Import ${count} ${count === 1 ? 'friend' : 'friends'}`}
        </Text>
      </Pressable>
    </>
  );
}

function MemberRow({
  member,
  selected,
  disabled,
  disabledLabel,
  onToggle,
}: {
  member: LeagueMember;
  selected: boolean;
  disabled: boolean;
  disabledLabel: string | null;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onToggle}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
    >
      <View
        style={[
          styles.checkbox,
          selected && !disabled && styles.checkboxChecked,
          disabled && styles.checkboxDisabled,
        ]}
      >
        {selected && !disabled ? (
          <Text style={styles.checkboxMark}>✓</Text>
        ) : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text
            style={[styles.rowName, disabled && styles.rowNameDisabled]}
            numberOfLines={1}
          >
            {member.entry_name}
          </Text>
          {disabledLabel ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{disabledLabel}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowMeta}>
          {member.player_name} · rank #{member.rank.toLocaleString()} ·{' '}
          {member.total.toLocaleString()} pts
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  label: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 17,
  },
  findBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  findBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.5 },
  error: {
    paddingHorizontal: 20,
    paddingTop: 12,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  leagueHeader: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 4,
  },
  leagueName: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  leagueMeta: { color: colors.textMuted, fontSize: 13 },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  selectLink: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  selectSep: { color: colors.textMuted, fontSize: 13 },
  list: { flex: 1 },
  listContent: { paddingBottom: 100 }, // clear the floating Import button
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.background },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxDisabled: { borderColor: colors.border, backgroundColor: 'transparent' },
  checkboxMark: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowNameDisabled: { color: colors.textMuted },
  rowMeta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tagText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  importBtn: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  importBtnDisabled: { backgroundColor: colors.textMuted },
  importBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
});
