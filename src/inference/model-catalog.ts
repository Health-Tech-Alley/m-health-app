import { Paths } from "expo-file-system";

/**
 * Model family — drives chat-template behavior and generation sampling.
 * `gemma4` = Gemma 4 E2B (think-prefix channel, Google/Unsloth sampling).
 * `qwen3` = Qwen3-derived (Bonsai 8B, jinja-native `<think>` template).
 * `lfm2` = Liquid LFM2.5 (hybrid conv+GQA, template-native `<think>`, low-temp
 *          sampling; NLU-decided reasoning — no-think FAST via concierge.ts).
 */
export type ModelFamily = "gemma4" | "qwen3" | "lfm2";

export type ThinkProfile =
  | { mode: "gemma4-prefix"; openTag?: string; closeTag?: string }
  | { mode: "template-native"; openTag?: string; closeTag?: string }
  | { mode: "none" };

export type ModelEntry = {
  id: string;
  displayName: string;
  file: string;
  hfRepo: string;
  hfFile: string;
  sizeBytes: number;
  /** Model family — drives chat-template and sampling behavior. */
  family: ModelFamily;
  /** Caregiver-facing one-liner for the model picker. */
  tagline: string;
  /** Short caregiver-facing comparison bullets. */
  bullets: string[];
  /** Preferred n_ctx on load; the runtime falls back on OOM. */
  preferredNCtx: number;
  /**
   * llama.rn `n_gpu_layers` for the first load attempt.
   * `-1` = offload all layers (Metal/CUDA). `0` = CPU only.
   * Q1_0 (1-bit Bonsai) has Metal kernels in llama.rn 0.12.x; TQ2_0 ternary
   * does NOT (it would hard-crash the process under Metal).
   */
  nGpuLayers: number;
  /** Generation sampling defaults (DEEP profile) for this model. */
  sampling: { temperature: number; topP: number; topK: number };
  /** How this model surfaces its reasoning channel. */
  think: ThinkProfile;
  /** Experimental models are flagged in the UI until Track B smoke passes. */
  experimental?: boolean;
};

/**
 * Default SLM model. Single source of truth — every hardcoded fallback
 * `?? 'gemma-4-e2b'` across the app imports this constant.
 *
 * Gemma 4 E2B-it (Q4_K_M, ~2.9 GB) remains the default Concierge model:
 * text-only clinical-decision + RAG role, good llama.rn fit, and a native
 * `<|think|>` reasoning channel via jinja + `reasoning_format='auto'`.
 */
export const DEFAULT_SLM_MODEL_ID = "gemma-4-e2b";

export const MODEL_CATALOG: ModelEntry[] = [
  {
    id: "gemma-4-e2b",
    displayName: "Gemma 4 E2B Instruct",
    file: "gemma-4-E2B-it-Q4_K_M.gguf",
    hfRepo: "unsloth/gemma-4-E2B-it-GGUF",
    hfFile: "gemma-4-E2B-it-Q4_K_M.gguf",
    sizeBytes: 3_106_738_272,
    family: "gemma4",
    tagline: "Default Concierge model — tuned for this app's thinking channel",
    bullets: [
      "~2.9 GB on-device footprint",
      "Strong instruction-following and caregiver tone",
      "Native <|think|> reasoning channel via llama.rn",
      "8K context on capable devices (falls back to 4K on low RAM)",
    ],
    preferredNCtx: 8192,
    nGpuLayers: -1,
    sampling: { temperature: 1.0, topP: 0.95, topK: 64 },
    think: { mode: "gemma4-prefix", openTag: "<think>", closeTag: "</think>" },
  },
  {
    id: "bonsai-8b-1bit",
    displayName: "Bonsai 8B (1-bit)",
    file: "Bonsai-8B-Q1_0.gguf",
    hfRepo: "prism-ml/Bonsai-8B-gguf",
    hfFile: "Bonsai-8B-Q1_0.gguf",
    sizeBytes: 1_158_654_496,
    family: "qwen3",
    tagline: "1-bit Qwen3-8B — GPU-accelerated and tiny (~1.15 GB)",
    bullets: [
      "~1.15 GB — Qwen3-8B at 1.125 bits/weight (Q1_0)",
      "Metal GPU inference on iOS — Q1_0 kernels are built into llama.rn",
      "Lower quality than the ternary pack (thinking avg ~70.5)",
      "Very small RAM footprint; 8K context (falls back to 4K on low RAM)",
    ],
    preferredNCtx: 8192,
    // Q1_0 has Metal mul_mat kernels in llama.rn 0.12.x — GPU offload is safe.
    nGpuLayers: -1,
    sampling: { temperature: 0.7, topP: 0.95, topK: 20 },
    think: { mode: "template-native", openTag: "<think>", closeTag: "</think>" },
    experimental: true,
  },
  {
    id: "lfm2-5-2-6b",
    displayName: "LFM2.5 2.6B",
    file: "LFM2.5-2.6B-Q4_K_M.gguf",
    hfRepo: "LiquidAI/LFM2.5-2.6B-GGUF",
    hfFile: "LFM2.5-2.6B-Q4_K_M.gguf",
    sizeBytes: 1_674_454_848,
    family: "lfm2",
    tagline: "Agentic on-device model — best tool use & instruction following in class",
    bullets: [
      "~1.67 GB — smaller than Gemma, stronger tool use (BFCLv4 56.9 vs 37.0)",
      "Hybrid LFM2 arch — Metal GPU offload, small KV cache, 128K native context",
      "Template-native <think> — NLU decides reasoning per turn (no-think FAST)",
      "Liquid-recommended sampling: temp 0.1 / top-k 50",
    ],
    preferredNCtx: 8192,
    // LFM2 Q4_K_M uses standard Metal kernels (llama.rn 0.12.x vendors
    // lfm2.cpp + hybrid memory). Offload all layers; LlamaRnProvider falls
    // back to CPU on the last rung if GPU init fails.
    nGpuLayers: -1,
    sampling: { temperature: 0.1, topP: 0.95, topK: 50 },
    think: { mode: "template-native", openTag: "<think>", closeTag: "</think>" },
    experimental: true,
  },
];

export function getModelEntry(modelId: string | null | undefined): ModelEntry | undefined {
  if (!modelId) return undefined;
  return MODEL_CATALOG.find((m) => m.id === modelId);
}

export function resolveModelPath(file: string): string {
  return Paths.join(Paths.document, "models", file);
}

export function getHfDownloadUrl(entry: ModelEntry): string {
  return `https://huggingface.co/${entry.hfRepo}/resolve/main/${entry.hfFile}`;
}

/**
 * Resolve the active Concierge model id.
 *
 * Rule: when exactly ONE model is installed, it is ALWAYS the default — the
 * persisted preference cannot point at a model that is not on-device. With
 * zero or 2+ installed: prefer the persisted default when it is installed,
 * otherwise the first installed catalog model, otherwise the default id
 * (surfaces should then show an install CTA).
 */
export function resolveActiveModelId(
  preferredId: string | null | undefined,
  isInstalled: (modelId: string) => boolean,
): string {
  const installedIds = MODEL_CATALOG.filter((m) => isInstalled(m.id)).map((m) => m.id);
  if (installedIds.length === 1) {
    return installedIds[0];
  }
  if (preferredId && getModelEntry(preferredId) && isInstalled(preferredId)) {
    return preferredId;
  }
  return installedIds[0] ?? DEFAULT_SLM_MODEL_ID;
}

/** Estimated KV-cache bytes per token (FP16) per family — used by the RAM gate. */
export const KV_BYTES_PER_TOKEN: Record<ModelFamily, number> = {
  gemma4: 50 * 1024,
  qwen3: 144 * 1024,
  // LFM2 hybrid: only 8 of 30 blocks are GQA attention (22 are conv blocks
  // with small recurrent state), so KV is far below the full-GQA qwen3.
  lfm2: 32 * 1024,
};
