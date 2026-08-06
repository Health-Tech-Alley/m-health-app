// consoleCapture.ts

import { log } from "./logger";

let installed = false;

export function installConsoleCapture() {
  if (installed) {
    return;
  }
  installed = true;

  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  console.log = (...args) => {
    log.info(...args);
    original.log(...args);
  };

  console.warn = (...args) => {
    log.warn(...args);
    original.warn(...args);
  };

  console.error = (...args) => {
    log.error(...args);
    original.error(...args);
  };

  console.debug = (...args) => {
    log.debug(...args);
    original.debug(...args);
  };
}