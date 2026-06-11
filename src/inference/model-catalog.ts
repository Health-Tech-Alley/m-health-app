import { Paths } from 'expo-file-system';

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
    id: 'healthgpt-pro-4b',
    displayName: 'HealthGPT Pro 4B (Q4_K_M)',
    file: 'HealthGPT-Pro-4B.Q4_K_M.gguf',
    hfRepo: 'mradermacher/HealthGPT-Pro-4B-GGUF',
    hfFile: 'HealthGPT-Pro-4B.Q4_K_M.gguf',
    sizeBytes: 2_600_000_000,
  },
  {
    id: 'phi-4-mini',
    displayName: 'Phi-4 Mini Instruct (Q4_K_M)',
    file: 'Phi-4-mini-instruct-Q4_K_M.gguf',
    hfRepo: 'unsloth/Phi-4-mini-instruct-GGUF',
    hfFile: 'Phi-4-mini-instruct-Q4_K_M.gguf',
    sizeBytes: 2_300_000_000,
  },
  {
    id: 'gemma-4-e2b',
    displayName: 'Gemma 4 E2B Instruct (Q4_K_M)',
    file: 'gemma-4-E2B-it-Q4_K_M.gguf',
    hfRepo: 'unsloth/gemma-4-E2B-it-GGUF',
    hfFile: 'gemma-4-E2B-it-Q4_K_M.gguf',
    sizeBytes: 2_800_000_000,
  },
];

export function resolveModelPath(file: string): string {
  return Paths.join(Paths.document, 'models', file);
}

export function getHfDownloadUrl(entry: ModelEntry): string {
  return `https://huggingface.co/${entry.hfRepo}/resolve/main/${entry.hfFile}`;
}
