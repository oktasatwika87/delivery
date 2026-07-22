import tseslint from 'typescript-eslint';
import baseConfig from '../../eslint.config.mjs';

export default tseslint.config(
  ...baseConfig,
  {
    files: ['src/**/*.{ts,tsx}', 'App.tsx', 'index.js'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // React Native punya pola async yang sering perlu any
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);