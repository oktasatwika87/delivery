/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Diperluas ke .spec.tsx supaya component test (e.g. MapScreen.spec.tsx)
  // tidak silently skip. .ts tetap included.
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  moduleNameMapper: {
    '^@delivery/shared$': '<rootDir>/../../packages/shared/dist',
    '^react-native-config$': '<rootDir>/src/__mocks__/react-native-config.ts',
    '^react-native-keychain$': '<rootDir>/src/__mocks__/react-native-keychain.ts',
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/__mocks__/@react-native-async-storage/async-storage.ts',
    '^@maplibre/maplibre-react-native$': '<rootDir>/src/__mocks__/@maplibre/maplibre-react-native.ts',
    // Stub minimal react-native — package asli Flow-typed & platform-specific
    // (./Utilities/Platform.android.js, dll) gagal resolve di jest runtime.
    // Untuk component test cukup StyleSheet + View/Text/TouchableOpacity/
    // ActivityIndicator/Linking/Platform — semuanya dipakai MapScreen.tsx.
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts',
  },
  // Transformer setup — urutan penting karena preset ts-jest inject
  // '^.+\\.tsx?$' → ts-jest, yang akan override tanpa kita urus.
  // Kita pakai pattern SPESIFIK (.tsx, .ts, .js) supaya tidak konflik.
  // - .tsx → babel-jest + @react-native/babel-preset (butuh JSX + Flow stripping)
  // - .ts  → ts-jest (unit test murni, no JSX)
  // - .js  → babel-jest + @react-native/babel-preset (untuk RN libs Flow-typed
  //          yang lolos moduleNameMapper, e.g. transitive deps)
  transform: {
    '^.+\\.tsx$': [
      'babel-jest',
      {
        presets: ['module:@react-native/babel-preset'],
        babelrc: false,
        configFile: false,
      },
    ],
    '^.+\\.js$': [
      'babel-jest',
      {
        presets: ['module:@react-native/babel-preset'],
        babelrc: false,
        configFile: false,
      },
    ],
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  // Allow transformasi node_modules/react-native, @react-native/*, dll.
  // Hanya untuk file yang lolos moduleNameMapper (mis. transitive deps
  // @react-native/js-polyfills, @react-native/normalize-colors, dll).
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?(?:jest-)?@?react-native|@react-native-community|@react-navigation|@testing-library)',
  ],
  // Setup file — lihat jest.setup.js untuk detail.
  setupFiles: ['<rootDir>/jest.setup.js'],
};