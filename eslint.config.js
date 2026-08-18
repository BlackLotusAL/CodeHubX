import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Terminal sanitization intentionally matches ANSI and control characters.
      'no-control-regex': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
