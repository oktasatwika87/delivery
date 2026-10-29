/**
 * Stub minimal untuk react-native, dipakai oleh component test.
 *
 * Kenapa perlu stub ini:
 *   - `react-native` asli di-require oleh MapScreen.tsx untuk StyleSheet,
 *     View, Text, dll.
 *   - `react-native` asli Flow-typed dan komplek; di jest runtime, dia
 *     gagal resolve platform-specific files (../Utilities/Platform.android.js
 *     etc.) karena moduleFileExtensions default tidak include .android.js/.ios.js.
 *   - Untuk component test, kita tidak butuh implementasi native, cukup
 *     stub yang:
 *       1) me-return komponen yang dirender ke JSON tree (untuk query RNTL).
 *       2) StyleSheet.create() jadi pass-through.
 *
 * Komponen yang di-export HARUS mencakup semua yang dipakai oleh:
 *   - MapScreen.tsx: View, Text, TouchableOpacity, ActivityIndicator, Linking,
 *     StyleSheet.
 *   - Komponen di src/components: View, Text, TextInput, Pressable,
 *     ActivityIndicator, StyleSheet.
 *   - @testing-library/react-native (detectHostComponentNames):
 *     View, Text, TextInput, Image, Switch, ScrollView, Modal.
 *     Jika salah satu undefined, RNTL throw "Element type is invalid".
 *
 * Ini TIDAK override mock yang sudah ada di <rootDir>/src/__mocks__/
 * (e.g. @maplibre/maplibre-react-native, react-native-config, dll).
 *
 * Module ini di-resolve via moduleNameMapper di jest.config.js.
 */

import type { ComponentType, ReactElement, ReactNode } from 'react';
declare const module: { exports: unknown };

const React = require('react');

// Helpers
function makeComponent(displayName: string) {
  const Component = (props: Record<string, unknown>) => React.createElement(displayName, props, props.children);
  Component.displayName = displayName;
  return Component;
}

// StyleSheet
const StyleSheet = {
  create: (styles: Record<string, unknown>) => styles,
  flatten: (style: unknown) => {
    if (style == null) return undefined;
    if (!Array.isArray(style)) return style;
    return Object.assign({}, ...style.filter(Boolean));
  },
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

// Components
const View = makeComponent('View');
const Text = makeComponent('Text');
const TextInput = makeComponent('TextInput');
const Image = makeComponent('Image');
const Switch = makeComponent('Switch');
const ScrollView = makeComponent('ScrollView');
const Modal = makeComponent('Modal');
const TouchableOpacity = makeComponent('TouchableOpacity');

// Pressable stub. Gaya dan isi boleh berupa fungsi yang menerima keadaan
// tekan, jadi dipanggil dengan keadaan tidak ditekan.
interface StateTekan {
  pressed: boolean;
}

type GayaFungsi = (state: StateTekan) => unknown;
type AnakFungsi = (state: StateTekan) => ReactNode;

function adalahGayaFungsi(nilai: unknown): nilai is GayaFungsi {
  return typeof nilai === 'function';
}

function adalahAnakFungsi(nilai: unknown): nilai is AnakFungsi {
  return typeof nilai === 'function';
}

const Pressable = (props: Record<string, unknown>) => {
  const { style, children, ...rest } = props;
  const gaya = adalahGayaFungsi(style) ? style({ pressed: false }) : style;
  const isi = adalahAnakFungsi(children) ? children({ pressed: false }) : children;
  return React.createElement('Pressable', { ...rest, style: gaya }, isi);
};
Pressable.displayName = 'Pressable';
// SectionList stub, makeComponent() alone only renders props.children, but
// the real SectionList takes no children: it renders `sections` itself via
// renderItem/renderSectionHeader. A dumb passthrough stub silently renders
// NOTHING for every section/item, which made every OrdersScreen.spec.tsx
// assertion on rendered card/badge text pass or fail vacuously regardless of
// actual component state (root cause of the badge test failures, see
// OrdersScreen.spec.tsx "pending action badge" describe block). This stub
// actually walks sections/data and calls renderItem/renderSectionHeader,
// same as the real component would, so RNTL queries can find the output.
function SectionList(props: any) {
  const {
    sections = [],
    renderItem,
    renderSectionHeader,
    keyExtractor,
    ListEmptyComponent,
    ...rest
  } = props;
  const totalItems = sections.reduce(
    (sum: number, section: any) => sum + (section.data ? section.data.length : 0),
    0,
  );
  const children: any[] = [];
  if (totalItems === 0 && ListEmptyComponent) {
    children.push(
      React.isValidElement(ListEmptyComponent)
        ? ListEmptyComponent
        : React.createElement(ListEmptyComponent, { key: 'empty' }),
    );
  } else {
    sections.forEach((section: any, sectionIndex: number) => {
      if (renderSectionHeader) {
        children.push(
          React.createElement(
            React.Fragment,
            { key: `section-header-${sectionIndex}` },
            renderSectionHeader({ section }),
          ),
        );
      }
      (section.data || []).forEach((item: any, itemIndex: number) => {
        const key = keyExtractor
          ? keyExtractor(item, itemIndex)
          : `section-${sectionIndex}-item-${itemIndex}`;
        if (renderItem) {
          children.push(
            React.createElement(
              React.Fragment,
              { key },
              renderItem({ item, index: itemIndex, section }),
            ),
          );
        }
      });
    });
  }
  return React.createElement(View, rest, children);
}
SectionList.displayName = 'SectionList';
const RefreshControl = makeComponent('RefreshControl');
const Button = (props: any) => {
  const { title, ...rest } = props;
  // Render as Text inside View so getByText can find the title
  return React.createElement(View, rest,
    React.createElement(Text, null, title)
  );
};
Button.displayName = 'Button';
const KeyboardAvoidingView = makeComponent('KeyboardAvoidingView');
// FlatList stub: me-makeComponent() saja tidak cukup karena FlatList
// asli tidak pakai children, tapi render data lewat renderItem.
// Stub ini memanggil renderItem / ListEmptyComponent / ListHeaderComponent /
// ListFooterComponent supaya RNTL bisa query output yang sesungguhnya.
interface FlatListProps {
  data?: readonly unknown[];
  renderItem?: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
  ListEmptyComponent?: ReactElement | ComponentType;
  ListHeaderComponent?: ReactElement | ComponentType;
  ListFooterComponent?: ReactElement | ComponentType;
  [key: string]: unknown;
}
function FlatList(props: FlatListProps): ReactElement {
  const {
    data = [],
    renderItem,
    keyExtractor,
    ListEmptyComponent,
    ListHeaderComponent,
    ListFooterComponent,
    ...rest
  } = props;
  const children: unknown[] = [];
  if (ListHeaderComponent) {
    children.push(
      React.isValidElement(ListHeaderComponent)
        ? React.cloneElement(ListHeaderComponent, { key: 'list-header' })
        : React.createElement(ListHeaderComponent, { key: 'list-header' }),
    );
  }
  if (data.length === 0 && ListEmptyComponent) {
    children.push(
      React.isValidElement(ListEmptyComponent)
        ? React.cloneElement(ListEmptyComponent, { key: 'list-empty' })
        : React.createElement(ListEmptyComponent, { key: 'list-empty' }),
    );
  } else {
    data.forEach((item: unknown, index: number) => {
      const key = keyExtractor ? keyExtractor(item, index) : `flatlist-item-${index}`;
      if (renderItem) {
        children.push(
          React.createElement(
            React.Fragment,
            { key },
            renderItem({ item, index }),
          ),
        );
      }
    });
  }
  if (ListFooterComponent) {
    children.push(
      React.isValidElement(ListFooterComponent)
        ? React.cloneElement(ListFooterComponent, { key: 'list-footer' })
        : React.createElement(ListFooterComponent, { key: 'list-footer' }),
    );
  }
  return React.createElement(View, rest, children);
}
FlatList.displayName = 'FlatList';

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

// Platform (cukup untuk unit test)
const Platform = {
  OS: 'android',
  select: (obj: Record<string, unknown>) => obj.android || obj.default,
  Version: 35,
};

// PermissionsAndroid
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

// Re-exports minimal
// Untuk hal yang tidak dipakai component ini tapi mungkin di-require
// transitively, kita re-export mock undefined (akan throw kalau dipakai).
const AppRegistry = { registerComponent: () => {} };
const NativeModules = {};
const PixelRatio = { get: () => 2, getFontScale: () => 1 };

module.exports = {
  ActivityIndicator,
  AppRegistry,
  Button,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  PermissionsAndroid,
  PixelRatio,
  Platform,
  Pressable,
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