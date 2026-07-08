import type { ScalerParams, UC2Scaler } from "./uc2Types";

export function scaleFeatures(
    rawFeatures: number[],
    scaler: UC2Scaler
): number[] {
    if (rawFeatures.length !== scaler.mean.length) {
        throw new Error(
            `Feature length mismatch. Got ${rawFeatures.length}, expected ${scaler.mean.length}`
        );
    }

    return rawFeatures.map((value, i) => {
        const scale = scaler.scale[i] === 0 ? 1 : scaler.scale[i];
        return (value - scaler.mean[i]) / scale;
    });
}

export function scaleVector(input: number[], scaler: ScalerParams): number[] {
    return input.map((value, i) => {
        const mean = scaler.mean[i] ?? 0;
        const scale = scaler.scale[i] === 0 ? 1 : scaler.scale[i] ?? 1;
        return (value - mean) / scale;
    });
}

export function inverseScaleVector(input: number[], scaler: ScalerParams): number[] {
    return input.map((value, i) => {
        const mean = scaler.mean[i] ?? 0;
        const scale = scaler.scale[i] === 0 ? 1 : scaler.scale[i] ?? 1;
        return value * scale + mean;
    });
}
