// Metro entry — RN 0.75 uses @react-native/metro-config
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Force resolve react ke satu lokasi (prevent duplicate React instance)
    alias: {
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
    // Include monorepo root for workspace packages
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../node_modules'),
    ],
  },
  watchFolders: [
    // Watch entire monorepo root untuk resolve workspace packages
    path.resolve(__dirname, '../..'),
    // Workspace packages
    path.resolve(__dirname, '../../packages/shared'),
  ],
};

module.exports = mergeConfig(defaultConfig, config);
