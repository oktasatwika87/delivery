/**
 * Tiruan sederhana react-native-svg untuk tes komponen.
 *
 * react-native-svg asli butuh native module, jadi di jest repo ini
 * dipetakan ke file ini lewat moduleNameMapper di jest.config.js.
 * Yang dibutuhkan tes cuma props Svg, Path, Polygon, G, Defs, Pattern, Rect,
 * LinearGradient, Stop, Circle, dan Line, jadi komponennya meneruskan props
 * itu apa adanya.
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
const Polygon = makeComponent('Polygon');
const G = makeComponent('G');
const Defs = makeComponent('Defs');
const Pattern = makeComponent('Pattern');
const Rect = makeComponent('Rect');
const LinearGradient = makeComponent('LinearGradient');
const Stop = makeComponent('Stop');
const Circle = makeComponent('Circle');
const Line = makeComponent('Line');

module.exports = {
  __esModule: true,
  default: Svg,
  Svg,
  Path,
  Polygon,
  G,
  Defs,
  Pattern,
  Rect,
  LinearGradient,
  Stop,
  Circle,
  Line,
};
