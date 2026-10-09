import AsyncStorage from '@react-native-async-storage/async-storage';

const FPL_TEAM_ID_KEY = 'user.fplTeamId';
const ONBOARDING_SEEN_KEY = 'user.onboardingSeen';

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

export async function getOnboardingSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setOnboardingSeen(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
}

export function isValidFplTeamId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}

const MY_TEAM_VIEW_KEY = 'user.myTeamView';

export const MY_TEAM_VIEWS = ['pitch', 'list'] as const;
export type MyTeamView = (typeof MY_TEAM_VIEWS)[number];
export const DEFAULT_MY_TEAM_VIEW: MyTeamView = 'pitch';

function isMyTeamView(raw: string | null): raw is MyTeamView {
  return MY_TEAM_VIEWS.some((view) => view === raw);
}

export async function getMyTeamView(): Promise<MyTeamView> {
  try {
    const raw = await AsyncStorage.getItem(MY_TEAM_VIEW_KEY);
    return isMyTeamView(raw) ? raw : DEFAULT_MY_TEAM_VIEW;
  } catch {
    return DEFAULT_MY_TEAM_VIEW;
  }
}

export async function setMyTeamView(view: MyTeamView): Promise<void> {
  await AsyncStorage.setItem(MY_TEAM_VIEW_KEY, view);
}
