/**
 * The app's `Text` and `TextInput`. Use these instead of React Native's:
 * they turn a style's font role and weight into the loaded Sora/Rubik
 * face (see `applyFontRole` in `src/theme/typography.ts`), and default
 * unstyled text to the body font.
 */
import { createContext, useContext } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';
import { applyFontRole, useCustomFontsLoaded, type ResolvedFont } from '../theme';

const InheritedFontContext = createContext<ResolvedFont | null>(null);

export function Text({ style, children, ...rest }: TextProps) {
  const inherited = useContext(InheritedFontContext);
  const customFontsLoaded = useCustomFontsLoaded();
  const resolved = applyFontRole(
    StyleSheet.flatten(style) ?? {},
    inherited,
    customFontsLoaded,
  );
  return (
    <NativeText {...rest} style={resolved.style}>
      <InheritedFontContext.Provider value={resolved.font}>
        {children}
      </InheritedFontContext.Provider>
    </NativeText>
  );
}

export function TextInput({ style, ...rest }: TextInputProps) {
  const customFontsLoaded = useCustomFontsLoaded();
  const resolved = applyFontRole(
    StyleSheet.flatten(style) ?? {},
    null,
    customFontsLoaded,
  );
  return <NativeTextInput {...rest} style={resolved.style} />;
}
