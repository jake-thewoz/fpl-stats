import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { spacing, useTheme, useThemedStyles, type Colors } from '../theme';
import type { PullToRefreshProps } from './PullToRefresh';

/** react-native-web's ScrollView renders its `refreshControl` element as a
 *  wrapper around the scroll node, passing that node as children and its
 *  own style. */
type Props = PullToRefreshProps & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** Finger travel is damped so the indicator lags the finger, as on native. */
const PULL_RESISTANCE = 0.5;
/** Damped distance at which letting go triggers a refresh. */
const PULL_THRESHOLD_PX = 64;
const MAX_PULL_PX = 96;
const INDICATOR_SIZE_PX = 36;
/** Where the indicator rests while a refresh is in flight. */
const REFRESHING_OFFSET_PX = PULL_THRESHOLD_PX / 2;

/**
 * Touch-driven pull-to-refresh for the web build, so the installed web
 * app gets the same gesture as native. Listens on the wrapper rather
 * than the scroll node because the wrapper is the element we own.
 */
export function PullToRefresh({ refreshing, onRefresh, style, children }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const containerRef = useRef<View>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    // react-native-web host component refs are DOM elements.
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return;

    let startY: number | null = null;
    let distance = 0;

    const reset = () => {
      startY = null;
      distance = 0;
      setPullDistance(0);
    };
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      const singleTouchAtTop =
        event.touches.length === 1 && isScrolledToTop(event.target, container);
      startY = singleTouchAtTop && touch ? touch.clientY : null;
      distance = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (startY === null || !touch) return;
      const dragged = touch.clientY - startY;
      // Dragging up is an ordinary scroll; stop tracking this gesture.
      if (dragged <= 0) {
        reset();
        return;
      }
      distance = Math.min(dragged * PULL_RESISTANCE, MAX_PULL_PX);
      setPullDistance(distance);
    };
    const onTouchEnd = () => {
      if (startY !== null && distance >= PULL_THRESHOLD_PX) onRefreshRef.current?.();
      reset();
    };

    const listenerOptions = { passive: true };
    container.addEventListener('touchstart', onTouchStart, listenerOptions);
    container.addEventListener('touchmove', onTouchMove, listenerOptions);
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', reset);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', reset);
    };
  }, []);

  const pulling = pullDistance > 0;
  const armed = pullDistance >= PULL_THRESHOLD_PX;
  const offset = pulling ? pullDistance : REFRESHING_OFFSET_PX;

  return (
    <View ref={containerRef} style={[styles.container, style]}>
      {children}
      {pulling || refreshing ? (
        <View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              transform: [{ translateY: offset - INDICATOR_SIZE_PX }],
              opacity: refreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD_PX, 1),
            },
          ]}
          accessibilityLabel={refreshing ? 'Refreshing' : undefined}
        >
          {refreshing ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={[styles.arrow, armed && styles.arrowArmed]}>↓</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** True when neither the touched element nor any scroll container between
 *  it and the wrapper has been scrolled down. */
function isScrolledToTop(target: EventTarget | null, container: HTMLElement): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== container) {
    if (node.scrollTop > 0) return false;
    node = node.parentElement;
  }
  return true;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    container: { flex: 1, overflow: 'hidden' },
    indicator: {
      position: 'absolute',
      top: spacing.md,
      alignSelf: 'center',
      width: INDICATOR_SIZE_PX,
      height: INDICATOR_SIZE_PX,
      borderRadius: INDICATOR_SIZE_PX / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    arrow: { color: colors.textMuted, fontWeight: '700' },
    arrowArmed: { color: colors.accent, transform: [{ rotate: '180deg' }] },
  });
