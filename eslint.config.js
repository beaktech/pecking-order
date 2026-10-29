import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', 'data/**', 'exports/**', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/**/*.js', 'test/**/*.js', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['browser/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]
