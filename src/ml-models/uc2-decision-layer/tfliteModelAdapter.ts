/**
 * TFLite model adapter for the tiny UC2 autoencoder.
 *
 * Production usage:
 *   - In Expo Go: interpreter is undefined → mock reconstruction is used.
 *   - In a native/dev-build with TFLite: pass a real interpreter object.
 *
 * This file is portable and has no React Native / Expo imports.
 * It matches the interface expected by the new runUC2DecisionLayer engine.
 *
 * Backward compat note:
 *   The old integration used TFLiteAutoencoderRunner (a function type).
 *   TfliteInterpreterLike is the new interface—the alertAutoencoderRunner.ts
 *   bridge wraps a TFLiteAutoencoderRunner into a TfliteInterpreterLike so both
 *   call paths continue to work.
 */

export interface TfliteInterpreterLike {
    run(input: number[]): Promise<number[]> | number[];
}

/**
 * Run the tiny autoencoder via TFLite interpreter if available,
 * or use a mock reconstruction for JS-only / Expo Go testing.
 *
 * The mock multiplies each scaled input by 0.96, which produces a small but
 * non-zero reconstruction error. This is intentionally above the anomaly
 * threshold for most inputs so dev/test flows exercise the anomaly path.
 * Do NOT rely on this for clinical validation.
 */
export async function runTinyAutoencoderTflite(
    scaledInput: number[],
    interpreter?: TfliteInterpreterLike
): Promise<number[]> {
    if (!interpreter) {
        // Mock reconstruction for Expo Go / JS-only validation.
        // Replace with a real TFLite module in a native dev build.
        return scaledInput.map((v) => v * 0.96);
    }

    const output = await interpreter.run(scaledInput);
    return output;
}
