const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// TFLite models (Alert ML + NLU leaf-ir) — same as react-native-fast-tflite docs.
if (!config.resolver.assetExts.includes('tflite')) {
  config.resolver.assetExts.push('tflite');
}

// Ensure project-root assets/ is always resolvable from src/**
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, 'assets')];

module.exports = config;
