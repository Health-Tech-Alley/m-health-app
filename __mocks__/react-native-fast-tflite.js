/**
 * Jest manual mock for react-native-fast-tflite.
 *
 * The real module loads the native NitroModules TurboModule at import time,
 * which does not exist in the Jest environment and crashes the worker. Tests
 * exercise ML logic through the in-repo mock implementations (e.g.
 * MockAlertAutoencoder), so a lightweight stub is sufficient: importing the
 * package must be side-effect free, and any accidental real inference fails
 * loudly instead of silently passing.
 */

function createStubModel() {
  const notReady = () => {
    throw new Error(
      'react-native-fast-tflite is mocked in Jest — no native TFLite runtime is available.',
    );
  };
  return {
    inputs: [],
    outputs: [],
    run: notReady,
    runSync: notReady,
    dispose: () => {},
  };
}

async function loadTensorflowModel() {
  return createStubModel();
}

function loadTensorflowModelFromBuffer() {
  return Promise.resolve(createStubModel());
}

module.exports = {
  loadTensorflowModel,
  loadTensorflowModelFromBuffer,
};
