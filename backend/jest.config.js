module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  // Prefer .ts over .js so stale compiled artifacts in lib/ or bin/
  // (left over from any past `tsc` build) never override the live TS
  // source. cdk synth already wins via `--prefer-ts-exts` in cdk.json.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['aws-cdk-lib/testhelpers/jest-autoclean'],
};
