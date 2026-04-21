import type { ExpoConfig, ConfigContext } from 'expo/config';

const DEV_DEFAULT_API_BASE_URL = 'http://localhost:3000';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'mobile',
  slug: config.slug ?? 'mobile',
  extra: {
    ...config.extra,
    apiBaseUrl: process.env.API_BASE_URL ?? DEV_DEFAULT_API_BASE_URL,
  },
});
