/**
 * App-wide theme context.
 *
 * Provides the active `Colors` palette plus the user's mode preference
 * (`'dark' | 'light' | 'system'`) and a setter that persists. First-launch
 * users land on **dark** — that's the explicit product call, not a copy
 * of any system default.
 *
 * In `'system'` mode the provider follows React Native's
 * `useColorScheme()`, which updates live when the user toggles their
 * OS-level appearance. Works on iOS, Android, and react-native-web.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, type Colors } from './colors';

export type ThemeMode = 'dark' | 'light' | 'system';
/** The mode actually applied — `'system'` resolves to one of these. */
export type EffectiveMode = 'dark' | 'light';

type ThemeContextValue = {
  colors: Colors;
  /** What the user picked. `'system'` follows the OS. */
  mode: ThemeMode;
  /** What's currently rendered. Useful for status-bar style etc. */
  effectiveMode: EffectiveMode;
  setMode: (mode: ThemeMode) => void;
  /** True until AsyncStorage has resolved on first launch — lets the
   *  app gate first paint on the persisted value to avoid a dark→light
   *  flicker if the user's saved mode is non-default. */
  ready: boolean;
};

const STORAGE_KEY = 'mobile.theme.v1';
const DEFAULT_MODE: ThemeMode = 'dark';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);
  const systemScheme = useColorScheme();

  // Hydrate persisted mode on first mount. While this is pending we
  // render with the default (dark) — `ready: false` lets callers
  // suppress first paint if the flicker is undesirable.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive) return;
        if (raw === 'dark' || raw === 'light' || raw === 'system') {
          setModeState(raw);
        }
        setReady(true);
      })
      .catch(() => {
        // Storage failure is non-fatal — fall back to the default.
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Persistence failure is non-fatal — the in-memory choice still
      // takes effect for the current session.
    });
  }, []);

  const effectiveMode: EffectiveMode = useMemo(() => {
    if (mode === 'system') {
      // useColorScheme() returns null on web when the OS has no
      // preference; default to dark in that case to match our
      // first-launch default.
      return systemScheme === 'light' ? 'light' : 'dark';
    }
    return mode;
  }, [mode, systemScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: effectiveMode === 'dark' ? darkColors : lightColors,
      mode,
      effectiveMode,
      setMode,
      ready,
    }),
    [effectiveMode, mode, setMode, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be called inside a <ThemeProvider>. Wrap App.tsx.');
  }
  return ctx;
}
