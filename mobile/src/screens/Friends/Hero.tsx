/**
 * The swipeable card at the top of Friends. Each page answers a different
 * question, so none repeats another:
 *
 * 1. Score strip: how did everyone do this gameweek?
 * 2. Season spotlights: who stands out over the season?
 * 3. You vs friends: how did you do against the people you know?
 *
 * Pages without enough data (fewer than two loaded teams, or your own
 * team missing) are left out, and the whole hero hides when none remain.
 */
import { useCallback, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ClubShirt, CLUB_SHIRT_SIZE } from '../../components/ClubShirt';
import { HeroCard, HERO_SECONDARY_OPACITY } from '../../components/HeroCard';
import { Text } from '../../components/Text';
import type { Entry } from '../../api/entry';
import { formatInt, formatRank } from '../../format/rank';
import {
  fontRole,
  fontSize,
  radius,
  spacing,
  useThemedStyles,
  type Colors,
} from '../../theme';
import {
  gameweekSummary,
  shortManagerName,
  spotlights,
  type GameweekSummary,
  type LoadedTeam,
  type Spotlight,
} from './summary';

/** Fixed so every page is the same height and swiping doesn't jump. */
const HERO_HEIGHT = 150;
const PIN_SIZE = 22;
/** Beyond this many teams the strip only labels you and the extremes,
 *  since neighbouring score labels would overlap. */
const MAX_LABELLED_PINS = 12;
/** Keeps the lowest and highest pins clear of the card's edges, as a
 *  share of the track width. */
const TRACK_EDGE_PERCENT = 6;
const FULL_PERCENT = 100;
const AVERAGE_TICK_WIDTH = 2;
const AVERAGE_TICK_HEIGHT = 24;
const RAIL_HEIGHT = 2;
const TRACK_HEIGHT = 76;
const DOT_SIZE = 6;
/** One-off sizes below and above the type scale: two-letter initials
 *  inside a 22px pin, and the headline difference on the versus card. */
const PIN_INITIALS_SIZE = 9;
const VERSUS_NUMBER_SIZE = 44;
const ACTIVE_DOT_WIDTH = 16;
// Small uppercase labels need a little tracking to stay legible.
const CAPS_LETTER_SPACING = 0.6;
// The rail and average tick are white at reduced strength, so they read
// as guides behind the pins rather than marks of their own.
const RAIL_OPACITY = 0.3;
const TICK_OPACITY = 0.6;
const PIN_FILL = 'rgba(255, 255, 255, 0.92)';

type Props = {
  teams: readonly LoadedTeam[];
  gameweek: number | null;
  /** Short name of an entry's favourite club, if it has one. */
  favouriteClub: (entry: Entry) => string | null;
};

type Page = { key: string; render: () => React.ReactNode };

export function FriendsHero({ teams, gameweek, favouriteClub }: Props) {
  const styles = useThemedStyles(makeStyles);
  const summary = gameweekSummary(teams);
  const cards = spotlights(teams);

  const pages: Page[] = [];
  if (summary) {
    pages.push({
      key: 'strip',
      render: () => (
        <ScoreStrip summary={summary} gameweek={gameweek} teamCount={teams.length} />
      ),
    });
  }
  if (cards.length > 0) {
    pages.push({
      key: 'spotlights',
      render: () => <Spotlights cards={cards} favouriteClub={favouriteClub} />,
    });
  }
  if (summary?.myPoints != null && summary.friendsAverage != null) {
    pages.push({
      key: 'versus',
      render: () => (
        <Versus
          myPoints={summary.myPoints ?? 0}
          friendsAverage={summary.friendsAverage ?? 0}
          summary={summary}
        />
      ),
    });
  }

  const [pageWidth, setPageWidth] = useState(0);
  const [activePage, setActivePage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setPageWidth((previous) => (previous === width ? previous : width));
  }, []);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pageWidth === 0) return;
      setActivePage(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
    },
    [pageWidth],
  );
  const goToPage = (index: number) =>
    scrollRef.current?.scrollTo({ x: index * pageWidth, animated: true });

  if (pages.length === 0) return null;

  return (
    <View style={styles.container} onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {pages.map((page) => (
          <View key={page.key} style={[styles.page, { width: pageWidth }]}>
            {page.render()}
          </View>
        ))}
      </ScrollView>
      {pages.length > 1 ? (
        <View style={styles.dots}>
          {pages.map((page, index) => (
            <Pressable
              key={page.key}
              onPress={() => goToPage(index)}
              hitSlop={spacing.md}
              accessibilityRole="button"
              accessibilityLabel={`Show card ${index + 1} of ${pages.length}`}
              style={[styles.dot, index === activePage && styles.activeDot]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ScoreStrip({
  summary,
  gameweek,
  teamCount,
}: {
  summary: GameweekSummary;
  gameweek: number | null;
  teamCount: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { scores, top, myPoints, friendsAverage } = summary;
  const low = scores[0].points;
  const high = scores[scores.length - 1].points;
  const usable = FULL_PERCENT - 2 * TRACK_EDGE_PERCENT;
  const at = (points: number) =>
    high === low
      ? FULL_PERCENT / 2
      : TRACK_EDGE_PERCENT + ((points - low) / (high - low)) * usable;
  const labelEveryPin = scores.length <= MAX_LABELLED_PINS;

  return (
    <HeroCard style={styles.card}>
      <View style={styles.cardTopLine}>
        <Text style={styles.heroLabel}>
          {gameweek == null ? 'This gameweek' : `GW ${gameweek}`} across your friends
        </Text>
        <Text style={styles.heroLabel}>{teamCount} teams</Text>
      </View>
      <View style={styles.track}>
        <View style={styles.rail} />
        {friendsAverage != null ? (
          <View style={[styles.averageTick, { left: `${at(friendsAverage)}%` }]} />
        ) : null}
        {scores.map((score, index) => {
          // Neighbours alternate above and below the rail so close
          // scores don't sit on top of each other.
          const above = index % 2 === 1;
          const labelled =
            labelEveryPin || score.isMe || index === 0 || index === scores.length - 1;
          const label = labelled ? (
            <Text style={styles.pinPoints}>{score.points}</Text>
          ) : null;
          return (
            <View
              key={score.id}
              style={[
                styles.pin,
                above ? styles.pinAbove : styles.pinBelow,
                { left: `${at(score.points)}%` },
              ]}
            >
              {above ? label : null}
              <View style={[styles.pinDot, score.isMe && styles.myPinDot]}>
                <Text style={[styles.pinInitials, score.isMe && styles.myPinInitials]}>
                  {score.initials}
                </Text>
              </View>
              {above ? null : label}
            </View>
          );
        })}
      </View>
      <View style={styles.cardTopLine}>
        <Text style={styles.heroFoot}>
          {myPoints != null && friendsAverage != null
            ? `You ${myPoints} · ${signed(myPoints - friendsAverage)} vs avg ${friendsAverage.toFixed(1)}`
            : friendsAverage != null
              ? `Average ${friendsAverage.toFixed(1)}`
              : ''}
        </Text>
        <Text style={styles.heroFoot} numberOfLines={1}>
          Top {top.points} · {shortManagerName(top.team.entry)}
        </Text>
      </View>
    </HeroCard>
  );
}

const SPOTLIGHT_LABELS: Record<Spotlight['kind'], string> = {
  bestRank: 'Best rank',
  biggestSquad: 'Squad value',
  mostTransfers: 'Transfers',
};

function spotlightValue({ kind, value }: Spotlight): string {
  if (kind === 'bestRank') return formatRank(value);
  if (kind === 'biggestSquad') return `£${value.toFixed(1)}`;
  return formatInt(value);
}

function Spotlights({
  cards,
  favouriteClub,
}: {
  cards: readonly Spotlight[];
  favouriteClub: (entry: Entry) => string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.spotlights}>
      {cards.map((card) => {
        const club = favouriteClub(card.team.entry);
        return (
          <View key={card.kind} style={styles.spotlight}>
            <Text style={styles.spotlightLabel} numberOfLines={1}>
              {SPOTLIGHT_LABELS[card.kind]}
            </Text>
            <Text style={styles.spotlightValue} numberOfLines={1}>
              {spotlightValue(card)}
            </Text>
            <View style={styles.spotlightWho}>
              {club ? (
                <ClubShirt teamShort={club} size={CLUB_SHIRT_SIZE.listRow} />
              ) : null}
              <Text style={styles.spotlightName} numberOfLines={1}>
                {card.team.isMe ? 'You' : shortManagerName(card.team.entry)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Versus({
  myPoints,
  friendsAverage,
  summary,
}: {
  myPoints: number;
  friendsAverage: number;
  summary: GameweekSummary;
}) {
  const styles = useThemedStyles(makeStyles);
  const difference = myPoints - friendsAverage;
  const direction = difference >= 0 ? 'above' : 'below';
  const topIsMe = summary.top.team.isMe;
  return (
    <HeroCard style={[styles.card, styles.versusCard]}>
      <Text style={styles.versusNumber}>{signed(difference)}</Text>
      <View style={styles.versusText}>
        <Text style={styles.versusSentence}>
          You scored {myPoints} this gameweek, {Math.abs(difference).toFixed(1)}{' '}
          {direction} your friends&apos; average of {friendsAverage.toFixed(1)}.
        </Text>
        <Text style={styles.heroFoot}>
          {topIsMe
            ? 'Top score among your friends. Nice week.'
            : `Top score: ${shortManagerName(summary.top.team.entry)} with ${summary.top.points}.`}
        </Text>
      </View>
    </HeroCard>
  );
}

function signed(value: number): string {
  // A real minus sign, which lines up with the plus in Sora.
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
    page: { paddingHorizontal: spacing.lg, height: HERO_HEIGHT },
    card: {
      flex: 1,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.lg2,
      paddingVertical: spacing.lg,
      justifyContent: 'space-between',
    },
    cardTopLine: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    heroLabel: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      letterSpacing: CAPS_LETTER_SPACING,
      textTransform: 'uppercase',
      color: colors.onHero,
      opacity: HERO_SECONDARY_OPACITY,
    },
    heroFoot: { flexShrink: 1, fontSize: fontSize.sm, color: colors.onHero },

    track: { height: TRACK_HEIGHT },
    rail: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: (TRACK_HEIGHT - RAIL_HEIGHT) / 2,
      height: RAIL_HEIGHT,
      borderRadius: RAIL_HEIGHT,
      backgroundColor: colors.onHero,
      opacity: RAIL_OPACITY,
    },
    averageTick: {
      position: 'absolute',
      top: (TRACK_HEIGHT - AVERAGE_TICK_HEIGHT) / 2,
      width: AVERAGE_TICK_WIDTH,
      height: AVERAGE_TICK_HEIGHT,
      marginLeft: -AVERAGE_TICK_WIDTH / 2,
      backgroundColor: colors.onHero,
      opacity: TICK_OPACITY,
    },
    pin: {
      position: 'absolute',
      width: PIN_SIZE * 2,
      marginLeft: -PIN_SIZE,
      alignItems: 'center',
      gap: spacing.hairline,
    },
    pinAbove: { bottom: TRACK_HEIGHT / 2 + RAIL_HEIGHT },
    pinBelow: { top: TRACK_HEIGHT / 2 + RAIL_HEIGHT },
    pinDot: {
      width: PIN_SIZE,
      height: PIN_SIZE,
      borderRadius: PIN_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: PIN_FILL,
    },
    myPinDot: {
      backgroundColor: colors.good,
      borderWidth: RAIL_HEIGHT,
      borderColor: colors.onHero,
    },
    pinInitials: {
      fontSize: PIN_INITIALS_SIZE,
      fontWeight: '800',
      color: colors.heroGradient[1],
    },
    myPinInitials: { color: colors.onGood },
    pinPoints: {
      ...fontRole.numeric,
      fontSize: fontSize.xs,
      fontWeight: '700',
      color: colors.onHero,
    },

    spotlights: { flex: 1, flexDirection: 'row', gap: spacing.md },
    spotlight: {
      flex: 1,
      minWidth: 0,
      borderRadius: radius.lg,
      padding: spacing.lg,
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    spotlightLabel: {
      fontSize: fontSize.xs,
      fontWeight: '700',
      letterSpacing: CAPS_LETTER_SPACING,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    spotlightValue: {
      ...fontRole.numeric,
      // A step below the hero sizes so "£103.4" fits a third of a phone.
      fontSize: fontSize.lg2,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    spotlightWho: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    spotlightName: {
      flexShrink: 1,
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: colors.textPrimary,
    },

    versusCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: spacing.lg,
    },
    versusNumber: {
      ...fontRole.numeric,
      fontSize: VERSUS_NUMBER_SIZE,
      fontWeight: '800',
      color: colors.onHero,
    },
    versusText: { flex: 1, gap: spacing.sm },
    versusSentence: { fontSize: fontSize.md, color: colors.onHero, fontWeight: '600' },

    dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
      backgroundColor: colors.textMuted,
    },
    activeDot: { width: ACTIVE_DOT_WIDTH, backgroundColor: colors.accent },
  });
