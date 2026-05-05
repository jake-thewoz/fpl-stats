// Flat config (ESLint 9+). Extends Expo's recommended base, with a
// minimal layer of project-specific rules. Strict rules that would
// flag thousands of context-legitimate violations (`no-magic-numbers`,
// `import/order`, return-type-required) are deliberately not enabled —
// the value of mechanizing the few rules we actually care about is
// lost if the lint output is dominated by noise.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  // TypeScript-only rules — the @typescript-eslint plugin is only
  // attached to .ts/.tsx files by the Expo flat config.
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    ignores: ['node_modules/', '.expo/', 'dist/', 'build/'],
  },
];
