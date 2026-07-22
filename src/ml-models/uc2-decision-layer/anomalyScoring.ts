import { TopFeatureEvidence, AutoencoderResult, CompletedFeatureVector, FeatureName } from "./uc2Types";
import { AE_DEFAULT_THRESHOLD, AE_INPUT_DIM, FEATURE_ORDER } from "./uc2Constants";

// ── Watch12 reconstruction error ──────────────────────────────────────────────

/**
 * Compute MSE reconstruction error for the Watch12 12D AE.
 * Formula: MSE = (1/12) * sum_i((x_scaled_i - x_hat_scaled_i)^2)
 */
export function reconstructionError(
    xScaled: number[],
    xRecon: number[]
): number {
    if (xScaled.length !== xRecon.length) {
        throw new Error(
            `Reconstruction length mismatch. Got ${xRecon.length}, expected ${xScaled.length}`
        );
    }

    let sum = 0;

    for (let i = 0; i < xScaled.length; i++) {
        const diff = xScaled[i] - xRecon[i];
        sum += diff * diff;
    }

    return sum / xScaled.length;
}

export function getTopReconstructionContributions(
    xScaled: number[],
    xRecon: number[],
    featureOrder: readonly string[],
    topK = 5
): TopFeatureEvidence[] {
    return xScaled
        .map((value, i) => {
            const diff = value - xRecon[i];
            const contribution = diff * diff;

            return {
                feature: featureOrder[i],
                importance: contribution,
                score: contribution,
                abs_z: Math.abs(value),
                direction: "unknown" as const,
                source: "ae_reconstruction_contribution" as const,
            };
        })
        .sort((a, b) => b.importance - a.importance)
        .slice(0, topK);
}

/**
 * Compute the Watch12 autoencoder anomaly score.
 *
 * Strict validation:
 *   - scaledInput must be exactly 12 elements
 *   - reconstructedScaled must be exactly 12 elements
 *   - MSE denominator is always 12
 *   - top_contributors only reference the 12 canonical Watch12 feature names
 *
 * BP, glucose, pulse_pressure, MAP, and stress_level cannot appear in
 * top_contributors because they are not in FEATURE_ORDER.
 */
export function computeAutoencoderScore(
    scaledInput: number[],
    reconstructedScaled: number[],
    originalFeatures: CompletedFeatureVector,
    threshold = AE_DEFAULT_THRESHOLD
): AutoencoderResult {
    if (scaledInput.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 AE] scaledInput length mismatch: got ${scaledInput.length}, expected ${AE_INPUT_DIM}. ` +
            (scaledInput.length === 18
                ? "Legacy 18D input detected. Use the Watch12 12D pipeline."
                : "Check scaleVector output.")
        );
    }

    if (reconstructedScaled.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 AE] reconstructedScaled length mismatch: got ${reconstructedScaled.length}, expected ${AE_INPUT_DIM}. ` +
            (reconstructedScaled.length === 18
                ? "Legacy 18D reconstruction detected. Load tiny_uc2_autoencoder12.tflite."
                : "Check TFLite output.")
        );
    }

    const errors = scaledInput.map((v, i) => {
        const diff = v - reconstructedScaled[i];
        return diff * diff;
    });

    // MSE denominator is AE_INPUT_DIM (12) — matches Python notebook formula
    const ae_score =
        errors.reduce((sum, value) => sum + value, 0) / AE_INPUT_DIM;

    const top_contributors = errors
        .map((contribution, i) => ({
            feature: FEATURE_ORDER[i] as FeatureName,
            contribution,
            value: originalFeatures[FEATURE_ORDER[i]],
        }))
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 5);

    return {
        ae_score: Number(ae_score.toFixed(6)),
        ae_threshold: threshold,
        is_anomaly: ae_score > threshold,
        reconstructed: reconstructedScaled,
        top_contributors,
    };
}
