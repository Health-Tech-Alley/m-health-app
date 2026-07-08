/**
 * Bridge between the loaded `AlertAutoencoder` (TFLite) and the UC2 decision
 * layer's TFLite contracts.
 *
 * The old decision layer expects a function `(scaledInput: number[]) =>
 * Promise<number[]>` (`TFLiteAutoencoderRunner`).
 *
 * The new v2 decision layer expects a `TfliteInterpreterLike` object with a `run` method.
 */
import type { AlertAutoencoder } from '../alert-autoencoder/alert-autoencoder';
import type { TfliteInterpreterLike } from './tfliteModelAdapter';

import type { TFLiteAutoencoderRunner } from './runUC2DecisionLayer';

export function createAlertAutoencoderRunner(
  model: AlertAutoencoder,
): TFLiteAutoencoderRunner {
  return async (scaledInput: number[]) => {
    if (!model.isLoaded) {
      await model.load();
    }
    return model.runReconstruction(scaledInput);
  };
}

export function createTfliteInterpreterAdapter(
  model: AlertAutoencoder,
): TfliteInterpreterLike {
  return {
    run: async (scaledInput: number[]) => {
      if (!model.isLoaded) {
        await model.load();
      }
      return model.runReconstruction(scaledInput);
    }
  };
}
