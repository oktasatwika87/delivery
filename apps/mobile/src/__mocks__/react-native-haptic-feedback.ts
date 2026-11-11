/**
 * Tiruan sederhana react-native-haptic-feedback untuk tes komponen.
 *
 * Pustaka aslinya butuh modul native, jadi di jest repo ini dipetakan ke
 * file ini lewat moduleNameMapper di jest.config.js.
 *
 * Yang ditiru cuma pemanggilan trigger dan triggerPattern, jadi keduanya
 * dicatat sebagai jest.fn() supaya bisa diperiksa.
 *
 * Polanya sama dengan tiruan react-native-svg di src/__mocks__/.
 */

declare const module: { exports: unknown };

const trigger = jest.fn();
const triggerPattern = jest.fn();

module.exports = {
  __esModule: true,
  default: {
    trigger,
    triggerPattern,
  },
  trigger,
  triggerPattern,
};

// Supaya file ini jadi modul, bukan skrip global yang menabrak variabel
// module bawaan Node.
export {};
