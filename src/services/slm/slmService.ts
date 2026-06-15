/**
 * Service layer for caregiver SLM assistant features.
 *
 * Official UI screens should call this service instead of directly importing
 * Ethan's playground UI, inference files, model storage files, or native ML code.
 */

import type {
    InferenceProvider,
    ChatMessage as ProviderChatMessage,
} from "@/inference/inference-provider";
import type { ModelEntry } from "@/inference/model-catalog";
import { MODEL_CATALOG } from "@/inference/model-catalog";
import { getHfToken } from "@/services/hf-token-store";
import { downloadModel } from "@/services/model-download";
import { isModelInstalled } from "@/services/model-storage";

export const CAREGIVER_SLM_MODEL_ID = "healthgpt-pro-4b";

export type CaregiverAssistantContext = {
  patientName?: string;
  caregiverName?: string;
  activeConcern?: string;
  recentVitalsSummary?: string;
  medicationSummary?: string;
  scheduleSummary?: string;
};

export type CaregiverAssistantResponse = {
  answer: string;
  reasoningContent?: string | null;
  safetyNote: string;
  source: "mock" | "native-slm" | "backend";
};

export function getCaregiverSLMModel(): ModelEntry {
  const model = MODEL_CATALOG.find(
    (entry) => entry.id === CAREGIVER_SLM_MODEL_ID,
  );

  if (!model) {
    throw new Error(`Caregiver SLM model not found: ${CAREGIVER_SLM_MODEL_ID}`);
  }

  return model;
}

export function isCaregiverSLMModelInstalled(): boolean {
  return isModelInstalled(getCaregiverSLMModel());
}

export async function downloadCaregiverSLMModel(params: {
  onProgress: (percent: number) => void;
}): Promise<void> {
  const model = getCaregiverSLMModel();
  const hfToken = await getHfToken();

  return new Promise((resolve, reject) => {
    downloadModel(model, hfToken, {
      onProgress: (bytesWritten, totalBytes) => {
        if (totalBytes > 0) {
          params.onProgress(Math.round((bytesWritten / totalBytes) * 100));
        }
      },
      onComplete: () => {
        params.onProgress(100);
        resolve();
      },
      onError: (error) => {
        reject(new Error(error));
      },
    });
  });
}

export async function askCaregiverAssistantWithProvider(params: {
  provider: InferenceProvider;
  prompt: string;
  context?: CaregiverAssistantContext;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}): Promise<CaregiverAssistantResponse> {
  const { provider, prompt, context = {}, onToken, signal } = params;

  const systemContext = buildCaregiverSystemContext(context);

  const messages: ProviderChatMessage[] = [
    {
      role: "system",
      content: systemContext,
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  const result = await provider.chat(
    messages,
    onToken ?? (() => {}),
    signal ?? new AbortController().signal,
  );

  return {
    answer: cleanAssistantText(result.text),
    reasoningContent: result.reasoningContent ?? null,
    safetyNote:
      "This assistant is a caregiver support prototype and does not replace emergency care or professional medical advice.",
    source: "native-slm",
  };
}

export async function askCaregiverAssistantMock(
  prompt: string,
  context: CaregiverAssistantContext = {},
): Promise<CaregiverAssistantResponse> {
  const patientName = context.patientName ?? "the patient";

  return {
    answer: `Mock caregiver assistant response for ${patientName}: ${prompt}`,
    reasoningContent: null,
    safetyNote:
      "This is a prototype response. In a real emergency, contact emergency services or the care team.",
    source: "mock",
  };
}

export function buildCaregiverSystemContext(context: CaregiverAssistantContext): string {
  return [
    "You are a caregiver support assistant inside a mobile health app.",
    "Give clear, calm, practical support for a non-clinical caregiver.",
    "Do not diagnose. Do not replace a clinician.",
    "Escalate urgent symptoms to emergency services or the care team.",
    "",
    `Patient: ${context.patientName ?? "Unknown"}`,
    `Caregiver: ${context.caregiverName ?? "Unknown"}`,
    `Active concern: ${context.activeConcern ?? "None provided"}`,
    `Recent vitals: ${context.recentVitalsSummary ?? "Not provided"}`,
    `Medications: ${context.medicationSummary ?? "Not provided"}`,
    `Schedule: ${context.scheduleSummary ?? "Not provided"}`,
  ].join("\n");
}

export function cleanAssistantText(text: string): string {
  return text.replace(/<\|[^>]*\|?>/g, "").trim();
}