// Metro entry - RN 0.75 pakai @react-native/metro-config
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const defaultConfig = getDefaultConfig(projectRoot);

// Folder build yang tidak boleh ditonton Metro. Gradle bikin file sementara
// di android/.gradle lalu menghapusnya di tengah build, dan watcher Metro
// mati dengan ENOENT kalau ikut menonton ke situ.
const blockList = new RegExp(
  [
    String.raw`[\\/]android[\\/]\.gradle[\\/]`,
    String.raw`[\\/]android[\\/]\.cxx[\\/]`,
    String.raw`[\\/]android[\\/]build[\\/]`,
    String.raw`[\\/]android[\\/]app[\\/]build[\\/]`,
    String.raw`[\\/]ios[\\/]build[\\/]`,
    String.raw`[\\/]ios[\\/]Pods[\\/]`,
    String.raw`[\\/]apps[\\/]backend[\\/]`,
  ].join('|'),
);

const config = {
  resolver: {
    blockList,
    // Force resolve react ke satu lokasi (cegah instance React ganda)
    alias: {
      react: path.resolve(projectRoot, 'node_modules/react'),
      'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
    },
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
  },
  watchFolders: [
    path.resolve(monorepoRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'packages/shared'),
  ],
};

module.exports = mergeConfig(defaultConfig, config);
