/**
 * Tiruan sederhana react-native-svg untuk tes komponen.
 *
 * react-native-svg asli butuh native module, jadi di jest repo ini
 * dipetakan ke file ini lewat moduleNameMapper di jest.config.js.
 * Yang dibutuhkan tes cuma props Svg dan Path, jadi komponennya
 * meneruskan props itu apa adanya.
 *
 * Polanya sama dengan tiruan react-native di src/__mocks__/react-native.ts.
 */

import type { ReactElement } from 'react';
declare const module: { exports: unknown };

const React = require('react');

function makeComponent(displayName: string) {
  const Component = (props: Record<string, unknown>): ReactElement =>
    React.createElement(displayName, props, props.children);
  Component.displayName = displayName;
  return Component;
}

const Svg = makeComponent('Svg');
const Path = makeComponent('Path');

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Path,
};
