import { RefreshControl, type RefreshControlProps } from 'react-native';

export type PullToRefreshProps = Pick<RefreshControlProps, 'refreshing' | 'onRefresh'>;

/**
 * Pull-to-refresh for a ScrollView / FlatList `refreshControl` prop.
 * Native platforms use RefreshControl itself; `PullToRefresh.web.tsx`
 * supplies a working web version, since react-native-web's
 * RefreshControl renders nothing.
 *
 * Re-exported rather than wrapped: Android's ScrollView clones this
 * element with the scroll view as its children, which a wrapper would
 * have to forward untouched.
 */
export const PullToRefresh = RefreshControl;
