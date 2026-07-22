/**
 * TFLite model adapter for the tiny UC2 autoencoder (Watch12 — 12D).
 *
 * Production usage:
 *   - In Expo Go: interpreter is undefined → mock reconstruction is used.
 *   - In a native/dev-build with TFLite: pass a real interpreter object.
 *
 * This file is portable and has no React Native / Expo imports.
 * It matches the interface expected by the runUC2DecisionLayerV2 engine.
 *
 * Dimension contract:
 *   - Input:  exactly 12 float32 values (Watch12 canonical order)
 *   - Output: exactly 12 float32 values (reconstruction of input)
 *
 * Backward compat note:
 *   The old integration used TFLiteAutoencoderRunner (a function type).
 *   TfliteInterpreterLike is the new interface — the alertAutoencoderRunner.ts
 *   bridge wraps a TFLiteAutoencoderRunner into a TfliteInterpreterLike so both
 *   call paths continue to work. The old v1 path uses a 18D runner but
 *   never calls this adapter.
 */

import { AE_INPUT_DIM, AE_OUTPUT_DIM } from "./uc2Constants";

export interface TfliteInterpreterLike {
    run(input: number[]): Promise<number[]> | number[];
}

/**
 * Run the tiny Watch12 autoencoder via TFLite interpreter if available,
 * or use a 12D mock reconstruction for JS-only / Expo Go testing.
 *
 * The mock multiplies each scaled input by 0.96, producing a small but
 * non-zero reconstruction error. This is intentionally above the anomaly
 * threshold for most inputs so dev/test flows exercise the anomaly path.
 * Do NOT rely on this for clinical validation.
 *
 * Strict validation:
 *   - scaledInput must be exactly 12 elements
 *   - interpreter output must be exactly 12 elements
 *   - nested [1, 12] batch outputs are unwrapped automatically
 *   - old 18D outputs are rejected explicitly
 */
export async function runTinyAutoencoderTflite(
    scaledInput: number[],
    interpreter?: TfliteInterpreterLike
): Promise<number[]> {
    if (scaledInput.length !== AE_INPUT_DIM) {
        throw new Error(
            `[Watch12 TFLite] Input dimension mismatch: got ${scaledInput.length}, expected ${AE_INPUT_DIM}. ` +
            (scaledInput.length === 18
                ? "A legacy 18D input was supplied. Use the 12D Watch-native feature vector."
                : "Ensure the feature vector was built with buildCompletedFeatureVector and scaled with scaleVector.")
        );
    }

    if (!interpreter) {
        // Mock reconstruction for Expo Go / JS-only validation.
        // Output is always 12D since input is validated to be 12D.
        return scaledInput.map((v) => v * 0.96);
    }

    const raw = await interpreter.run(scaledInput);

    // Unwrap nested batch output [1, 12] that some TFLite runtimes return
    const output = unwrapBatchOutput(raw);

    if (output.length !== AE_OUTPUT_DIM) {
        throw new Error(
            `[Watch12 TFLite] Output dimension mismatch: got ${output.length}, expected ${AE_OUTPUT_DIM}. ` +
            (output.length === 18
                ? "The loaded TFLite model appears to be the legacy 18D model. Load tiny_uc2_autoencoder12.tflite."
                : "Verify that tiny_uc2_autoencoder12.tflite was loaded correctly.")
        );
    }

    return output;
}

/**
 * Unwrap a possible nested batch output from TFLite.
 * If the interpreter returns [[v0, v1, ..., v11]] (outer array of length 1),
 * unwrap to [v0, v1, ..., v11].
 * If it returns a flat array, return as-is.
 */
function unwrapBatchOutput(raw: number[] | any): number[] {
    if (!Array.isArray(raw)) {
        throw new Error(`[Watch12 TFLite] Interpreter returned non-array output: ${typeof raw}`);
    }
    // Detect nested [[...]] shape
    if (raw.length === 1 && Array.isArray(raw[0])) {
        return raw[0] as number[];
    }
    return raw as number[];
}
