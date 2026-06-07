import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

export default [
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // React source files
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // React hooks — critical bug prevention
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React best practices
      'react/jsx-uses-react': 'off', // React 17+ new JSX transform
      'react/react-in-jsx-scope': 'off', // React 17+ new JSX transform
      'react/jsx-uses-vars': 'error',
      'react/prop-types': 'off', // project does not use PropTypes

      // JS quality rules — errors only for high-confidence bugs
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off', // POS app logs to console intentionally
      'no-constant-condition': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unreachable': 'error',
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],

      // ESLint 10 yeni kuralları — codebase uyumluluğu için kapatıldı
      'no-useless-catch': 'off',
      'preserve-caught-error': 'off',  // error cause zinciri zorunlu değil
      'no-useless-assignment': 'warn',  // gerçek bug değil, yeniden yazma sırasında temizlenir
    },
  },
];
