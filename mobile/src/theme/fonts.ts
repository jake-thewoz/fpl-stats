/**
 * Font files and the app-wide "did they load" flag.
 *
 * Imports go through each weight's own subpath rather than the package
 * index, which `require`s every weight and would ship all of them in the
 * web export.
 */
import { createContext, useContext } from 'react';
import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import { Sora_800ExtraBold } from '@expo-google-fonts/sora/800ExtraBold';

/** Keyed by the face names in `FONT_FACES` (`typography.ts`). */
export const FONT_ASSETS = {
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
};

/** False when the fonts failed to load; `Text` then falls back to the
 *  system font rather than naming a family that doesn't exist. */
export const CustomFontsContext = createContext(false);

export function useCustomFontsLoaded(): boolean {
  return useContext(CustomFontsContext);
}
