import AsyncStorage from '@react-native-async-storage/async-storage';

const FPL_TEAM_ID_KEY = 'user.fplTeamId';

export async function getFplTeamId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(FPL_TEAM_ID_KEY);
  } catch {
    return null;
  }
}

export async function setFplTeamId(id: string): Promise<void> {
  await AsyncStorage.setItem(FPL_TEAM_ID_KEY, id);
}

export async function clearFplTeamId(): Promise<void> {
  await AsyncStorage.removeItem(FPL_TEAM_ID_KEY);
}

export function isValidFplTeamId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}
