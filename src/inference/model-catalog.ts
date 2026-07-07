import { Paths } from "expo-file-system";

export type ModelEntry = {
  id: string;
  displayName: string;
  file: string;
  hfRepo: string;
  hfFile: string;
  sizeBytes: number;
};

/**
 * Default SLM model. Single source of truth — every hardcoded fallback
 * `?? 'gemma-4-e2b'` across the app imports this constant.
 *
 * Gemma 4 E2B-it (Q4_K_M, ~2.4 GB) is the sole SLM for the app: text-only
 * clinical-decision + RAG role, smaller footprint, good llama.rn fit, and a
 * native `<|think|>` reasoning channel via jinja + `reasoning_format='auto'`.
 * The HealthGPT-Pro-4B/8B fallbacks were removed — Gemma 4 E2B is the only
 * supported model.
 */
export const DEFAULT_SLM_MODEL_ID = "gemma-4-e2b";

export const MODEL_CATALOG: ModelEntry[] = [
  {
    id: "gemma-4-e2b",
    displayName: "Gemma 4 E2B Instruct",
    file: "gemma-4-E2B-it-Q4_K_M.gguf",
    hfRepo: "unsloth/gemma-4-E2B-it-GGUF",
    hfFile: "gemma-4-E2B-it-Q4_K_M.gguf",
    sizeBytes: 2_403_612_800,
  },
];

export function resolveModelPath(file: string): string {
  return Paths.join(Paths.document, "models", file);
}

export function getHfDownloadUrl(entry: ModelEntry): string {
  return `https://huggingface.co/${entry.hfRepo}/resolve/main/${entry.hfFile}`;
}
