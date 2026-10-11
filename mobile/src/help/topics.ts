/**
 * Plain-English help for someone new to the app or to FPL stats. Each tab
 * gets a topic shown from its header "?" button; Settings shows them all
 * as one guide. Stat definitions come from FIELD_DEFS so the column picker
 * and the help never disagree.
 */
import { FIELD_DEFS } from '../players/fields';
import type { FieldKey } from '../players/types';

export type HelpEntry = {
  /** The word, symbol or label being explained, as it appears on screen. */
  term: string;
  meaning: string;
};

export type HelpSection = {
  title: string;
  /** Optional lead paragraph above the entries. */
  intro?: string;
  entries: readonly HelpEntry[];
};

export type HelpTopicKey = 'myTeam' | 'players' | 'transfers' | 'friends';

export type HelpTopic = {
  title: string;
  sections: readonly HelpSection[];
};

// Minus sign glued to the amount so "−£1.5m" never wraps after the sign.
const NO_BREAK_MINUS = '−\u2060';

const fieldEntry = (key: FieldKey): HelpEntry => ({
  term: FIELD_DEFS[key].shortLabel,
  meaning: FIELD_DEFS[key].description,
});

const XP_SECTION: HelpSection = {
  title: 'Expected points (xP)',
  intro:
    "xP is this app's prediction of how many FPL points a player will score. It weighs the fixture, how likely they are to play, their underlying stats (expected goals and assists, defensive contributions) and recent form. It's a model, so it will sometimes disagree with the FPL site. It updates overnight and moves on to the next gameweek once a deadline passes.",
  entries: [fieldEntry('xp'), fieldEntry('xp_h3'), fieldEntry('xp_h5')],
};

const MATCH_STATUS_SECTION: HelpSection = {
  title: 'Symbols next to names',
  entries: [
    { term: '●', meaning: "The player's club is playing right now." },
    { term: '✓', meaning: "The player's club has finished its match this gameweek." },
    { term: 'C / V', meaning: 'Captain (scores double) and vice-captain.' },
  ],
};

const GAMEWEEK_BANNER_SECTION: HelpSection = {
  title: 'Gameweek bar',
  entries: [
    {
      term: 'Deadline',
      meaning:
        'Between gameweeks, the bar at the top shows when the next FPL deadline is. Make your transfers and captain pick before then.',
    },
    {
      term: 'Live',
      meaning:
        'During a gameweek it shows how many matches have been played. Tap it for the full fixture list. Live points refresh roughly every 30 minutes.',
    },
  ],
};

const FIXTURES_SECTION: HelpSection = {
  title: 'Fixtures',
  intro:
    "The Next 3 column shows each player's next three opponents, coloured by FPL's difficulty rating: mint is easy, coral is hard. The gameweeks are under the heading.",
  entries: [
    {
      term: 'MUN / mun',
      meaning: 'Capitals are a home game, lower case an away game.',
    },
    {
      term: 'Two stacked chips',
      meaning: 'A double gameweek: two matches in one gameweek.',
    },
    {
      term: '—',
      meaning: 'A blank gameweek: no match, so no points.',
    },
    {
      term: 'Sorting',
      meaning:
        'Sorts by the average rating, easiest run first. A blank counts as the hardest fixture.',
    },
  ],
};

export const HELP_TOPICS: Record<HelpTopicKey, HelpTopic> = {
  myTeam: {
    title: 'My Team',
    sections: [
      {
        title: 'Your squad',
        entries: [
          {
            term: 'Pitch / List',
            meaning:
              'Pitch shows your XI by position with the bench below. List shows all fifteen as a sortable table with any stats you like.',
          },
          {
            term: 'pts',
            meaning:
              'On the Yours pitch, what each player has scored this gameweek, captain bonus included.',
          },
          {
            term: 'Yours / Suggested',
            meaning:
              "Yours is the lineup you picked on FPL. Suggested is the best starting XI and captain this app can make from your squad for the next gameweek. It doesn't change anything on FPL; copy it over yourself if you like it.",
          },
          {
            term: 'xP / Form / PPG',
            meaning:
              'What the suggested lineup optimises for. xP is the forward-looking choice; Form and PPG look back.',
          },
          {
            term: '↑ / ↓',
            meaning:
              'On the suggested pitch: ↑ is a bench player the suggestion starts, ↓ is a starter it benches.',
          },
          {
            term: 'Faded rows',
            meaning: 'In the list, faded players are on your bench.',
          },
        ],
      },
      MATCH_STATUS_SECTION,
      XP_SECTION,
      FIXTURES_SECTION,
      GAMEWEEK_BANNER_SECTION,
    ],
  },
  players: {
    title: 'Players',
    sections: [
      {
        title: 'Using the table',
        entries: [
          {
            term: 'Sorting',
            meaning:
              'Tap any column heading to sort by it. Tap again to flip the order. The arrow shows the current sort.',
          },
          {
            term: 'Filter',
            meaning:
              'Narrow by position, club, price and more. Active filters appear as chips; tap a chip to remove it.',
          },
          {
            term: 'Columns',
            meaning:
              'Choose which stats to show. Swipe the table sideways when there are more than fit.',
          },
          {
            term: 'Faded rows',
            meaning: "Players already in your squad, so they aren't transfer targets.",
          },
          {
            term: 'GW under xP',
            meaning: 'The gameweek the xP column is predicting.',
          },
        ],
      },
      XP_SECTION,
      FIXTURES_SECTION,
      {
        title: 'Other stats',
        intro: 'All of these are available from Columns.',
        entries: (
          [
            'defcon',
            'defcon_per_90',
            'form',
            'points_per_game',
            'selected_by_percent',
            'bps',
            'ict_index',
            'expected_goals',
            'expected_assists',
            'cost_change_event',
          ] as const
        ).map(fieldEntry),
      },
      MATCH_STATUS_SECTION,
    ],
  },
  transfers: {
    title: 'Transfers',
    sections: [
      {
        title: 'What this shows',
        intro:
          'The transfers that would add the most expected points to your squad over the next few gameweeks, best first. Nothing happens on FPL until you make the transfer there yourself.',
        entries: [
          {
            term: '1 / 3 / 5 GWs',
            meaning:
              'How far ahead to plan. One gameweek favours this week’s fixture; five favours players with a good run of games.',
          },
          {
            term: 'Card',
            meaning:
              'One transfer plan. Each row is a player out (left) and the player in (right). Tap a card to compare the players.',
          },
        ],
      },
      {
        title: 'Reading a card',
        entries: [
          {
            term: 'Net gain',
            meaning:
              'The extra points the whole plan is expected to earn over the chosen gameweeks, with any hit already subtracted.',
          },
          {
            term: '+xP on a move',
            meaning:
              "How many more points the incoming player is expected to score than the one leaving. A move can be negative when it's there to free up money for another.",
          },
          {
            term: 'Bank',
            meaning: `What the plan does to your money in the bank. ${NO_BREAK_MINUS}£1.5m means it costs £1.5m more than you get back.`,
          },
          {
            term: 'Hit',
            meaning:
              "FPL takes 4 points for each transfer beyond your free ones. Plans that need a hit say so; when there's no hit pill, the plan is free.",
          },
        ],
      },
      {
        title: 'When you tap a card',
        entries: [
          {
            term: 'Form',
            meaning:
              "This app's recent-form score for each player, one of the xP model's inputs.",
          },
          {
            term: 'Avg fixture difficulty',
            meaning:
              "FPL's 1–5 difficulty rating averaged over the planning window. Lower is easier: green is kind, red is tough.",
          },
          {
            term: 'Horizon xP',
            meaning: 'Total expected points for each player over the chosen gameweeks.',
          },
        ],
      },
      {
        title: 'Filter',
        entries: [
          {
            term: 'Max transfers',
            meaning: 'The largest plan to consider: single swaps, pairs, or more.',
          },
          {
            term: 'Free transfers',
            meaning:
              "Worked out from your FPL history. FPL doesn't publish transfers you've made this week until the deadline, so correct it here if you've already used some.",
          },
          {
            term: 'Position',
            meaning: 'Only suggest swaps in the positions you tick.',
          },
        ],
      },
    ],
  },
  friends: {
    title: 'Friends',
    sections: [
      {
        title: 'Comparing with friends',
        entries: [
          {
            term: 'Manage',
            meaning:
              'Add a friend by their FPL team ID, import everyone from a classic league you share, or remove people.',
          },
          {
            term: 'Rank',
            meaning: 'Overall rank among every FPL manager. Lower is better.',
          },
          { term: 'GW', meaning: 'Points scored in the current gameweek.' },
          { term: 'Total', meaning: 'Points scored this season.' },
          {
            term: 'Tap a row',
            meaning: "See that manager's squad for this gameweek.",
          },
        ],
      },
    ],
  },
};

/** Sections several tabs share, so the full guide explains them once,
 *  up front, instead of under whichever tab happens to come first. */
const BASICS_TOPIC: HelpTopic = {
  title: 'Basics',
  sections: [XP_SECTION, MATCH_STATUS_SECTION, GAMEWEEK_BANNER_SECTION],
};

/** Basics, then every tab in tab order, for the full guide in Settings. */
export const ALL_HELP_TOPICS: readonly HelpTopic[] = [
  BASICS_TOPIC,
  HELP_TOPICS.myTeam,
  HELP_TOPICS.players,
  HELP_TOPICS.transfers,
  HELP_TOPICS.friends,
];
