import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';
import {
  createAlertAutoencoderRunner,
  runUC2DecisionLayer,
  type AppleWatchVitalsInput,
  type CaregiverFinalAction,
  type UC2DecisionResult,
} from '@/ml-models/uc2-decision-layer';

export type EvaluateUC2WithExistingRuntimeParams = {
  vitals: AppleWatchVitalsInput;
  caregiverFinalAction?: CaregiverFinalAction;
  caregiverSelectedCodes?: string[];
  eventId?: string;
};

export type UC2ApplicationRuntime = {
  isReady(): boolean;
  evaluateUC2WithExistingRuntime(
    params: EvaluateUC2WithExistingRuntimeParams,
  ): Promise<UC2DecisionResult>;
};

export function createUC2ApplicationRuntime(
  mlModel: AlertAutoencoder,
): UC2ApplicationRuntime {
  return {
    isReady(): boolean {
      return mlModel.isLoaded && mlModel.scalerParams !== null;
    },

    async evaluateUC2WithExistingRuntime({
      vitals,
      caregiverFinalAction = 'no_prompt_shown',
      caregiverSelectedCodes = [],
      eventId = `uc2-${Date.now()}`,
    }: EvaluateUC2WithExistingRuntimeParams): Promise<UC2DecisionResult> {
      const scaler = mlModel.scalerParams;
      if (!scaler) {
        throw new Error('ML scaler not loaded');
      }
      if (!mlModel.isLoaded) {
        throw new Error('ML model not loaded');
      }

      return runUC2DecisionLayer({
        eventId,
        input: vitals,
        scaler: { mean: scaler.mean, scale: scaler.scale },
        threshold: mlModel.threshold,
        runTFLiteAutoencoder: createAlertAutoencoderRunner(mlModel),
        caregiverFinalAction,
        caregiverSelectedCodes,
      });
    },
  };
}
