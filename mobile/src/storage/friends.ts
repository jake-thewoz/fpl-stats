import AsyncStorage from '@react-native-async-storage/async-storage';

const FRIENDS_KEY = 'user.friends';

export type Friend = {
  id: string; // numeric string — matches the user.fplTeamId convention
  alias: string;
};

function isValidFriend(v: unknown): v is Friend {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Friend).id === 'string' &&
    typeof (v as Friend).alias === 'string'
  );
}

export async function getFriends(): Promise<Friend[]> {
  try {
    const raw = await AsyncStorage.getItem(FRIENDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidFriend);
  } catch {
    return [];
  }
}

export async function saveFriends(friends: Friend[]): Promise<void> {
  await AsyncStorage.setItem(FRIENDS_KEY, JSON.stringify(friends));
}

/**
 * Adds a friend, or updates the alias if a friend with the same id already
 * exists (dedupe on id so we never store the same team twice).
 */
export async function addFriend(friend: Friend): Promise<Friend[]> {
  const current = await getFriends();
  const filtered = current.filter((f) => f.id !== friend.id);
  const next = [...filtered, friend];
  await saveFriends(next);
  return next;
}

export async function removeFriend(id: string): Promise<Friend[]> {
  const current = await getFriends();
  const next = current.filter((f) => f.id !== id);
  await saveFriends(next);
  return next;
}
