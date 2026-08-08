/**
 * Jest setup file — load sebelum semua test dijalankan.
 *
 * Tujuan: menyediakan polyfill minimum yang dibutuhkan oleh component test
 * React Native (View, Text, hooks, dll.) tanpa harus load `react-native/jest/setup`
 * secara langsung. Alasannya: `setupFiles` di-Jest dieksekusi oleh Node runtime
 * SEBELUM transformer (babel-jest) berjalan — jadi kalau kita require file
 * di `node_modules/react-native/jest/setup.js` dari sini, file-file Flow-typed
 * di transitive deps (e.g. `@react-native/js-polyfills/error-guard.js`) tidak
 * akan di-strip type annotationsnya dan parsing gagal.
 *
 * Polyfill di sini HANYA yang relevan untuk unit/component test:
 *   - __DEV__ flag
 *   - IS_REACT_ACT_ENVIRONMENT (dipakai oleh @testing-library/react-native)
 *   - requestAnimationFrame / cancelAnimationFrame
 *   - performance.now polyfill
 *
 * Catatan: file ini TIDAK di-transform oleh babel-jest (transform hanya untuk
 * .tsx / .ts di project ini, lihat jest.config.js). Jadi JANGAN pakai
 * TypeScript / Flow syntax di sini.
 *
 * NativeModules (UIManager, dll.) sudah di-mock di moduleNameMapper / jest.mock
 * per test file — tidak perlu mock global di sini.
 */

global.IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperties(global, {
  __DEV__: {
    configurable: true,
    enumerable: true,
    value: true,
    writable: true,
  },
  cancelAnimationFrame: {
    configurable: true,
    enumerable: true,
    value: function (id) { return clearTimeout(id); },
    writable: true,
  },
  requestAnimationFrame: {
    configurable: true,
    enumerable: true,
    value: function (callback) {
      return setTimeout(function () { callback(jest.now()); }, 0);
    },
    writable: true,
  },
  nativeFabricUIManager: {
    configurable: true,
    enumerable: true,
    value: {},
    writable: true,
  },
  performance: {
    configurable: true,
    enumerable: true,
    value: {
      now: function () { return Date.now(); },
    },
    writable: true,
  },
});
