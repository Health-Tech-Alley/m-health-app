import type { ScalerParams, UC2Scaler, PatientProfile } from "./uc2Types";
import { AE_INPUT_DIM, FEATURE_ORDER } from "./uc2Constants";

// ── Watch12 12D scaler (production path) ─────────────────────────────────────

/**
 * Scale a 12-dimensional Watch-native AE feature vector.
 *
 * Strict validation:
 *   - input length must be exactly 12
 *   - scaler mean length must be exactly 12
 *   - scaler scale length must be exactly 12
 *   - if scaler carries feature_order / feature_cols, must match FEATURE_ORDER exactly
 *
 * Rejects old 18D scalers with a descriptive error.
 */
export function scaleVector(
    input: number[],
    scaler: ScalerParams,
    profile?: PatientProfile
): number[] {
    if (input.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 scaleVector] Input length mismatch: got ${input.length}, expected ${AE_INPUT_DIM}. ` +
            `If you are passing a legacy 18D vector, use the v1 compat path (scaleFeatures) instead.`
        );
    }

    if (scaler.mean.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 scaleVector] Scaler mean length mismatch: got ${scaler.mean.length}, expected ${AE_INPUT_DIM}. ` +
            (scaler.mean.length === 18
                ? "A legacy 18D scaler was supplied. Load tiny_uc2_scaler12.json for Watch12."
                : "Check that the scaler was loaded from tiny_uc2_scaler12.json.")
        );
    }

    if (scaler.scale.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 scaleVector] Scaler scale length mismatch: got ${scaler.scale.length}, expected ${AE_INPUT_DIM}. ` +
            (scaler.scale.length === 18
                ? "A legacy 18D scaler was supplied. Load tiny_uc2_scaler12.json for Watch12."
                : "Check that the scaler was loaded from tiny_uc2_scaler12.json.")
        );
    }

    // Validate feature order if the scaler declares it
    const declaredOrder = scaler.feature_order ?? scaler.feature_cols;
    if (declaredOrder && declaredOrder.length > 0) {
        if (declaredOrder.length !== AE_INPUT_DIM) {
            throw new Error(
                `[Watch12 scaleVector] Scaler feature_order length mismatch: got ${declaredOrder.length}, expected ${AE_INPUT_DIM}.`
            );
        }
        for (let i = 0; i < AE_INPUT_DIM; i++) {
            if (declaredOrder[i] !== FEATURE_ORDER[i]) {
                throw new Error(
                    `[Watch12 scaleVector] Scaler feature_order mismatch at index ${i}: ` +
                    `got "${declaredOrder[i]}", expected "${FEATURE_ORDER[i]}". ` +
                    `Scaler must match canonical Watch12 FEATURE_ORDER.`
                );
            }
        }
    }

    return input.map((value, i) => {
        const feat = FEATURE_ORDER[i];
        const popMean = scaler.mean[i] ?? 0;
        const scale = scaler.scale[i] === 0 ? 1 : (scaler.scale[i] ?? 1);

        // Adaptive Patient Baseline Normalization:
        // Adjusted Feature = Live Value - (mu_p - mu_population)
        const patientMean = profile?.rolling_7d_mean?.[feat];
        const adjustedValue =
            typeof patientMean === "number"
                ? value - (patientMean - popMean)
                : value;

        return (adjustedValue - popMean) / scale;
    });
}

/**
 * Inverse-scale a 12-dimensional Watch12 reconstructed AE vector.
 * Same dimension validation as scaleVector.
 */
export function inverseScaleVector(input: number[], scaler: ScalerParams): number[] {
    if (input.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 inverseScaleVector] Input length mismatch: got ${input.length}, expected ${AE_INPUT_DIM}.`
        );
    }
    if (scaler.mean.length !== AE_INPUT_DIM || scaler.scale.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 inverseScaleVector] Scaler dimensions must be ${AE_INPUT_DIM}. ` +
            `Got mean=${scaler.mean.length}, scale=${scaler.scale.length}.`
        );
    }

    return input.map((value, i) => {
        const mean = scaler.mean[i] ?? 0;
        const scale = scaler.scale[i] === 0 ? 1 : (scaler.scale[i] ?? 1);
        return value * scale + mean;
    });
}

// ── @compat Legacy scaler (v1 compat path only) ───────────────────────────────

/**
 * @deprecated Legacy 18D scaler used by runUC2DecisionLayer v1 compat path.
 * Does NOT enforce 12D. MUST NOT be used for Watch12 AE scoring.
 */
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
