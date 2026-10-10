import type { ExpoConfig, ConfigContext } from 'expo/config';
import { lightPalette } from './src/theme/colors.ts';

const DEV_DEFAULT_API_BASE_URL = 'http://localhost:3000';
const BRAND_BACKGROUND_COLOR = lightPalette.eggplant;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'mobile',
  slug: config.slug ?? 'mobile',
  splash: { ...config.splash, backgroundColor: BRAND_BACKGROUND_COLOR },
  android: {
    ...config.android,
    adaptiveIcon: {
      ...config.android?.adaptiveIcon,
      backgroundColor: BRAND_BACKGROUND_COLOR,
    },
  },
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL ?? DEV_DEFAULT_API_BASE_URL,
  },
});
