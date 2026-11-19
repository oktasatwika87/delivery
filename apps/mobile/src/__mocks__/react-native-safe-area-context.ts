/**
 * Tiruan sederhana react-native-safe-area-context untuk tes komponen.
 *
 * Pustaka aslinya butuh modul native, jadi di jest repo ini dipetakan ke
 * file ini lewat moduleNameMapper di jest.config.js.
 *
 * Yang ditiru: penyedia yang meneruskan children, SafeAreaView yang jadi
 * View biasa, pengambil inset yang selalu nol, dan ukuran jendela awal.
 */

import type { ReactElement, ReactNode } from 'react';

declare const module: { exports: unknown };

const React = require('react');
const ReactNative = require('react-native');

interface Inset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const INSET_NOL: Inset = { top: 0, bottom: 0, left: 0, right: 0 };

/** Penyedia area aman, hanya meneruskan children. */
function SafeAreaProvider({ children }: { children?: ReactNode }): ReactElement {
  return React.createElement(ReactNative.View, null, children);
}

/** Area aman, jadi View biasa saja. */
function SafeAreaView({
  children,
  ...sisa
}: {
  children?: ReactNode;
  [key: string]: unknown;
}): ReactElement {
  return React.createElement(ReactNative.View, sisa, children);
}

/** Inset area aman. Bisa diubah per tes. */
const useSafeAreaInsets = jest.fn(() => INSET_NOL);

const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: INSET_NOL,
};

module.exports = {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
  useSafeAreaInsets,
};
