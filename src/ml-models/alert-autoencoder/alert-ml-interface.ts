/**
 * Alert ML model interface.
 *
 * Abstraction over the concrete TFLite autoencoder so the orchestrator can
 * swap between the real on-device model (Track B) and a deterministic mock
 * (Track A / Expo Go) without branching logic.
 */

import type { CoreVitals, ExtendedVitals, MLResult } from './types';

export interface AlertMlModel {
  readonly isLoaded: boolean;
  readonly threshold: number;
  load(): Promise<void>;
  release(): Promise<void>;
  runInference(core: CoreVitals, extended: ExtendedVitals, timestamp?: Date): Promise<MLResult>;
}
