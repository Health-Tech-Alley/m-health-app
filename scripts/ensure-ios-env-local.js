#!/usr/bin/env node
/**
 * Ensure `ios/.xcode.env.local` contains the local-only overrides needed by
 * this project. The file is sourced by the "Bundle React Native code and
 * images" build phase in `ios/mhealthapp.xcodeproj`.
 *
 * Why this script exists
 * ----------------------
 * `npx expo prebuild --clean` wipes the entire `ios/` folder before
 * regenerating it from the Expo template. The template only writes the
 * versioned `ios/.xcode.env`, not the user-local `ios/.xcode.env.local`,
 * so any override placed there is lost on every prebuild.
 *
 * Expo runs `pod install` (via expo-modules-autolinking) after regenerating
 * the native folder, and `pod install` is also triggered as part of
 * `npm install` when a Podfile exists. Either path brings us back here
 * via the `postinstall` lifecycle hook in package.json, so re-creating
 * the file in this script keeps the override in place across both flows.
 *
 * Behavior
 * --------
 * - Idempotent: safe to run repeatedly; merges with existing content.
 * - Skip silently if `ios/` does not exist yet (first `npm install` before
 *   the first `expo prebuild` — there's no `ios/` to write into).
 * - Does not delete other lines already in the file.
 */

const fs = require('fs');
const path = require('path');

const IOS_DIR = path.join(process.cwd(), 'ios');
const ENV_FILE = path.join(IOS_DIR, '.xcode.env.local');

const REQUIRED_LINES = [
  // Skip the Metro packager IP write into the .app bundle. Without this,
  // Xcode 15+ User Script Sandboxing blocks the `echo "$IP" > "$DEST/ip.txt"`
  // call in node_modules/expo/scripts/react-native-xcode.sh with a deny(1).
  'export SKIP_BUNDLING_METRO_IP=1',
];

function main() {
  if (!fs.existsSync(IOS_DIR)) {
    // No native folder yet — nothing to do. The next `expo prebuild` will
    // create it, and the next npm install after that will re-run us.
    process.exit(0);
  }

  let existing = '';
  if (fs.existsSync(ENV_FILE)) {
    existing = fs.readFileSync(ENV_FILE, 'utf8');
  }

  const existingLines = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );

  const missing = REQUIRED_LINES.filter((line) => !existingLines.has(line));
  if (missing.length === 0) {
    process.exit(0);
  }

  const additions = missing.join('\n') + '\n';
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(ENV_FILE, existing + prefix + additions, 'utf8');

  console.log(
    `[ensure-ios-env-local] Added ${missing.length} line(s) to ${path.relative(
      process.cwd(),
      ENV_FILE,
    )}`,
  );
}

main();
