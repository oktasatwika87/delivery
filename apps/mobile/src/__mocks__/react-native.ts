/**
 * Stub minimal untuk react-native — dipakai oleh component test.
 *
 * Kenapa perlu stub ini:
 *   - `react-native` asli di-require oleh MapScreen.tsx untuk StyleSheet,
 *     View, Text, dll.
 *   - `react-native` asli Flow-typed dan komplek; di jest runtime, dia
 *     gagal resolve platform-specific files (../Utilities/Platform.android.js
 *     etc.) karena moduleFileExtensions default tidak include .android.js/.ios.js.
 *   - Untuk component test, kita tidak butuh implementasi native — cukup
 *     stub yang:
 *       1) me-return komponen yang dirender ke JSON tree (untuk query RNTL).
 *       2) StyleSheet.create() jadi pass-through.
 *
 * Komponen yang di-export HARUS mencakup semua yang dipakai oleh:
 *   - MapScreen.tsx: View, Text, TouchableOpacity, ActivityIndicator, Linking,
 *     StyleSheet.
 *   - @testing-library/react-native (detectHostComponentNames):
 *     View, Text, TextInput, Image, Switch, ScrollView, Modal.
 *     Jika salah satu undefined, RNTL throw "Element type is invalid".
 *
 * Ini TIDAK override mock yang sudah ada di <rootDir>/src/__mocks__/
 * (e.g. @maplibre/maplibre-react-native, react-native-config, dll).
 *
 * Module ini di-resolve via moduleNameMapper di jest.config.js.
 */

const React = require('react');

// ─── Helpers ────────────────────────────────────────────────────────
function makeComponent(displayName) {
  const Component = (props) => React.createElement(displayName, props, props.children);
  Component.displayName = displayName;
  return Component;
}

// ─── StyleSheet ─────────────────────────────────────────────────────
const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) => {
    if (style == null) return undefined;
    if (!Array.isArray(style)) return style;
    return Object.assign({}, ...style.filter(Boolean));
  },
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

// ─── Components ─────────────────────────────────────────────────────
const View = makeComponent('View');
const Text = makeComponent('Text');
const TextInput = makeComponent('TextInput');
const Image = makeComponent('Image');
const Switch = makeComponent('Switch');
const ScrollView = makeComponent('ScrollView');
const Modal = makeComponent('Modal');
const TouchableOpacity = makeComponent('TouchableOpacity');
const SectionList = makeComponent('SectionList');
const RefreshControl = makeComponent('RefreshControl');
const Button = (props) => {
  const { title, ...rest } = props;
  // Render as Text inside View so getByText can find the title
  return React.createElement(View, rest,
    React.createElement(Text, null, title)
  );
};
Button.displayName = 'Button';
const KeyboardAvoidingView = makeComponent('KeyboardAvoidingView');

class ActivityIndicator extends React.Component {
  render() {
    return React.createElement('ActivityIndicator', this.props);
  }
}

class Linking {
  static openSettings() {
    return Promise.resolve();
  }
  static openURL() {
    return Promise.resolve();
  }
}

// ─── Platform (cukup untuk unit test) ────────────────────────────────
const Platform = {
  OS: 'android',
  select: (obj) => obj.android || obj.default,
  Version: 35,
};

// ─── PermissionsAndroid ───────────────────────────────────────────────
const PermissionsAndroid = {
  PERMISSIONS: {
    ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
    ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  request: jest.fn().mockResolvedValue('granted'),
};

// ─── Re-exports minimal ─────────────────────────────────────────────
// Untuk hal yang tidak dipakai component ini tapi mungkin di-require
// transitively, kita re-export mock undefined (akan throw kalau dipakai).
const AppRegistry = { registerComponent: () => {} };
const NativeModules = {};
const PixelRatio = { get: () => 2, getFontScale: () => 1 };

module.exports = {
  ActivityIndicator,
  AppRegistry,
  Button,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  PermissionsAndroid,
  PixelRatio,
  Platform,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
};