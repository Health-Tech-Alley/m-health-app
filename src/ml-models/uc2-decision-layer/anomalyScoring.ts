import { TopFeatureEvidence, AutoencoderResult, CompletedFeatureVector, FeatureName } from "./uc2Types";
import { AE_DEFAULT_THRESHOLD, FEATURE_ORDER } from "./uc2Constants";

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

export function computeAutoencoderScore(
    scaledInput: number[],
    reconstructedScaled: number[],
    originalFeatures: CompletedFeatureVector,
    threshold = AE_DEFAULT_THRESHOLD
): AutoencoderResult {
    const errors = scaledInput.map((v, i) => {
        const diff = v - reconstructedScaled[i];
        return diff * diff;
    });

    const ae_score =
        errors.reduce((sum, value) => sum + value, 0) / errors.length;

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
