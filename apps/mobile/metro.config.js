// Metro entry — RN 0.75 uses @react-native/metro-config
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // WatermelonDB ada di workspace root's pnpm store — Metro perlu resolve ke source-nya
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../node_modules'),
    ],
  },
  watchFolders: [
    path.resolve(__dirname, '../../packages/shared'),
  ],
};

module.exports = mergeConfig(defaultConfig, config);

const path = require('path');