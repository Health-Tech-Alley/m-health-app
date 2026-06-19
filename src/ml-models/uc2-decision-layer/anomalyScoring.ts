import { TopFeatureEvidence } from "./uc2Types";

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
