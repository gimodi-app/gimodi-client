const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier/flat');

module.exports = [
  {
    ignores: ['dist/**', 'out/**'],
  },
  {
    files: ['src/main/**/*.js', 'src/*-preload.js', 'src/preload.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: 'error',
      'prefer-const': 'error',
    },
  },
  eslintConfigPrettier,
  {
    files: ['src/**/*.js'],
    rules: {
      curly: 'error',
    },
  },
];
