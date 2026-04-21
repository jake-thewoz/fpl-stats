// Interim config: read the API base URL from an EXPO_PUBLIC_* env var.
// #10 will migrate this to app.config.ts + expo-constants.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
