import { Paths } from "expo-file-system";

export type ModelEntry = {
  id: string;
  displayName: string;
  file: string;
  hfRepo: string;
  hfFile: string;
  sizeBytes: number;
};

export const MODEL_CATALOG: ModelEntry[] = [
  {
    id: "healthgpt-pro-4b",
    displayName: "HealthGPT Pro 4B (Q4_K_M)",
    file: "HealthGPT-Pro-4B.Q4_K_M.gguf",
    hfRepo: "mradermacher/HealthGPT-Pro-4B-GGUF",
    hfFile: "HealthGPT-Pro-4B.Q4_K_M.gguf",
    sizeBytes: 2_600_000_000,
  },
  {
    id: "gemma-4-e4b",
    displayName: "Gemma 4 E4B Instruct (UD-Q2_K_XL)",
    file: "gemma-4-E4B-it-UD-Q2_K_XL.gguf",
    hfRepo: "unsloth/gemma-4-E4B-it-GGUF",
    hfFile: "gemma-4-E4B-it-UD-Q2_K_XL.gguf",
    sizeBytes: 3_757_417_632,
  },
  {
    id: "gemma-4-e2b",
    displayName: "Gemma 4 E2B Instruct (UD-Q2_K_XL)",
    file: "gemma-4-E2B-it-UD-Q2_K_XL.gguf",
    hfRepo: "unsloth/gemma-4-E2B-it-GGUF",
    hfFile: "gemma-4-E2B-it-UD-Q2_K_XL.gguf",
    sizeBytes: 2_403_612_800,
  },
];

export function resolveModelPath(file: string): string {
  return Paths.join(Paths.document, "models", file);
}

export function getHfDownloadUrl(entry: ModelEntry): string {
  return `https://huggingface.co/${entry.hfRepo}/resolve/main/${entry.hfFile}`;
}
