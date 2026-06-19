/**
 * Bridge between the loaded `AlertAutoencoder` (TFLite) and the UC2 decision
 * layer's `TFLiteAutoencoderRunner` contract.
 *
 * The decision layer expects a function `(scaledInput: number[]) =>
 * Promise<number[]>` that returns the model's reconstruction vector. This
 * factory wraps an `AlertAutoencoder` instance so the decision layer can run
 * the real on-device model without re-implementing the TFLite call.
 */
import type { AlertAutoencoder } from '../alert-autoencoder/alert-autoencoder';
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
