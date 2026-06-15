# Alert Autoencoder ML Model

On-device autoencoder for anomaly detection in caregiver vitals and biometric streams.

## Purpose

This model detects out-of-range trends and anomalies in patient vitals (part of the Alert ML path in L5 Decision Engine). It runs entirely on-device via TensorFlow Lite.

## Files

- `alert-autoencoder.tflite` - Quantized TFLite model (autoencoder architecture)
- `scaler.json` - MinMaxScaler parameters for input normalization
- `metadata.json` - Model metadata (version, training date, input/output specs)
- `test-samples/samples.txt` - Test input samples for validation

## Architecture

Autoencoder trained to reconstruct normal vitals patterns. High reconstruction error indicates anomaly.

**Input:** Normalized vitals vector (heart rate, SpO2, temperature, etc.)
**Output:** Reconstruction error score (0.0 - 1.0, higher = more anomalous)

## Integration

Used by the Alert ML pipeline in L5 (Decision Engine) to generate risk scores before caregiver HITL review.

Target performance: F1 0.7-0.9, ROC/AUC 85%+

## Usage

```typescript
import { AlertAutoencoder } from '@/ml-models/alert-autoencoder';

const model = await AlertAutoencoder.load();
const normalizedInput = model.normalize(rawVitals);
const anomalyScore = await model.predict(normalizedInput);

if (anomalyScore > 0.8) {
  // Trigger alert flow
}
```

## Owner

Jay Modi - Predictive ML, wearables, push notifications
