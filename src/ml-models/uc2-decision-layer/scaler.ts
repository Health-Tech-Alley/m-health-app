export type UC2Scaler = {
    mean: number[];
    scale: number[];
};

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
