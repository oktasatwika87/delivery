// Metro entry — RN 0.75 uses @react-native/metro-config
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // pnpm symlinks: Metro perlu opsi resmi unstable_enableSymlinks
    unstable_enableSymlinks: true,

    // Force resolve react ke satu lokasi (prevent duplicate React instance)
    alias: {
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
  },
  watchFolders: [
    // Watch entire monorepo root untuk resolve workspace packages
    path.resolve(__dirname, '../..'),
    // Workspace packages
    path.resolve(__dirname, '../../packages/shared'),
  ],
};

module.exports = mergeConfig(defaultConfig, config);