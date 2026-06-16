// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Expo's flat config enables import/no-unresolved, but it does not
      // resolve TypeScript imports without extensions. We rely on the TypeScript
      // compiler and Metro for resolution, so disable the rule for TS files.
      'import/no-unresolved': 'off',
    },
  },
]);
