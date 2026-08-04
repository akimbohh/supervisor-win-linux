// ESLint flat config. Scoped to the Node backend + tests (the vanilla web/
// frontend relies on cross-file window globals via <script> concatenation and
// needs a separate browser-globals pass — tracked as follow-up). The highest-
// value rule here is no-unused-vars: it catches dead imports and the kind of
// silently-unused error bindings that let failures hide.
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'test/**/*.js', 'build.js', 'tools/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly',
        Buffer: 'readonly', __dirname: 'readonly', __filename: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        URL: 'readonly', global: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^(req|res|next)$', caughtErrors: 'none' }],
      'no-undef': 'error',
      'prefer-const': 'warn',
      // Empty catch blocks are an intentional, pervasive pattern here (best-
      // effort cleanup that must never throw); allow them but flag other empties.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-eval': 'off', // used deliberately in one test to load a browser fn
      'no-control-regex': 'off', // ANSI escape stripping needs \x1b etc.
    },
  },
  {
    ignores: ['web/**', 'web.backup-*/**', 'redesign/**', 'node_modules/**', 'data/**', 'server/lib/store.js.*'],
  },
];
