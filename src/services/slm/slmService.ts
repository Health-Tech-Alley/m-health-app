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
import type { PatientRecordSnapshot } from "@/data/repositories/patientRecordRepository";

export const CAREGIVER_SLM_MODEL_ID = "healthgpt-pro-4b";

export type CaregiverAssistantContext = {
  // Patient demographics & clinical picture
  patientName?: string;
  patientAge?: string;
  patientConditions?: string;
  /** Structured: primary condition name + ICD-10 code. */
  primaryCondition?: { name: string; icd10?: string; category?: string };
  /** Structured: comorbidity names with ICD-10 codes. */
  comorbidities?: { name: string; icd10?: string; category?: string }[];
  /** Structured: caregiver-reported symptoms. */
  symptoms?: { label: string; category: string }[];
  patientBaselineDailyRoutine?: string;
  patientCurrentMedications?: string;
  patientSpo2Cutoff?: string;
  patientBaselineHeartRate?: string;
  // Caregiver context
  caregiverName?: string;
  caregiverRelationship?: string;
  caregiverExperience?: string;
  caregiverAvailability?: string;
  caregiverLanguagePreference?: string;
  caregiverMedicalComfortLevel?: string;
  caregiverHobbiesOrRoutines?: string;
  caregiverMainConcern?: string;
  caregiverStressOrSupportNeeds?: string;
  caregiverBackup?: string;
  // Care team
  primaryCareProviderName?: string;
  primaryCareProviderPhone?: string;
  primaryCareProviderEmail?: string;
  // Safety
  emergencyContact?: string;
  safetyNotes?: string;
  // Convenience rollups
  activeConcern?: string;
  recentVitalsSummary?: string;
  medicationSummary?: string;
  scheduleSummary?: string;
};

/**
 * Build a CaregiverAssistantContext from the PatientRecordStore snapshot.
 * This is the preferred way to construct the context — it includes structured
 * conditions, comorbidities, and symptoms that the onboarding-profile-only
 * path doesn't have.
 */
export function buildCaregiverAssistantContextFromSnapshot(
  snapshot: PatientRecordSnapshot,
): CaregiverAssistantContext {
  const confirmedConditions = snapshot.conditions.filter((c) => !c.needsReview);
  const primary = confirmedConditions.find((c) => c.isPrimary) ?? confirmedConditions[0];
  const comorbidities = confirmedConditions.filter((c) => c !== primary);

  return {
    patientName: snapshot.patient?.name,
    patientAge: snapshot.patient?.age,
    patientConditions: snapshot.patient?.conditions,
    primaryCondition: primary
      ? { name: primary.name, icd10: primary.icd10, category: primary.category }
      : undefined,
    comorbidities: comorbidities.map((c) => ({
      name: c.name,
      icd10: c.icd10,
      category: c.category,
    })),
    symptoms: snapshot.symptoms.map((s) => ({ label: s.label, category: s.category })),
    patientBaselineDailyRoutine: snapshot.patient?.baselineDailyRoutine,
    patientCurrentMedications: snapshot.patient?.currentMedications,
    patientSpo2Cutoff: snapshot.patient?.spo2Cutoff,
    patientBaselineHeartRate: snapshot.patient?.baselineHeartRate,
    caregiverName: snapshot.caregiver?.name,
    caregiverRelationship: snapshot.caregiver?.relationship,
    caregiverExperience: snapshot.caregiver?.experience,
    caregiverAvailability: snapshot.caregiver?.availability,
    caregiverLanguagePreference: snapshot.caregiver?.languagePreference,
    caregiverMedicalComfortLevel: snapshot.caregiver?.medicalComfortLevel,
    caregiverHobbiesOrRoutines: snapshot.caregiver?.hobbiesOrRoutines,
    caregiverMainConcern: snapshot.caregiver?.mainConcern,
    caregiverStressOrSupportNeeds: snapshot.caregiver?.stressOrSupportNeeds,
    caregiverBackup: snapshot.caregiver?.backupCaregiver,
  };
}

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
  const preamble = [
    "You are the embedded caregiver-support assistant inside a mobile health app",
    "called Caregiver Concierge: ACCESS-DP. The app is built by Health Tech Alley",
    "for family caregivers of a severely disabled loved one (disability level ~3/5)",
    "with multiple comorbidities and a multi-specialist care team.",
    "",
    "The user typing to you is a NON-CLINICAL family caregiver — typically a spouse,",
    "parent, sibling, or adult child — using the app in real time, often with one",
    "hand, sometimes in a stressful or sleep-deprived moment. They are not a nurse",
    "or a doctor. They are doing their best.",
    "",
    "The PATIENT's full care plan, medications, vitals cadence, and emergency",
    "thresholds are provided below as structured context. You are expected to use",
    "this context as ground truth and to personalize every answer to it.",
    "",
    "WHAT KIND OF ANSWER IS EXPECTED",
    "------------------------------",
    "- Plain, calm, practical guidance a stressed caregiver can act on in seconds.",
    "- Short, scannable structure: lead with the bottom line, then 2–5 numbered or",
    "  bulleted steps, then any 'watch for' red flags.",
    "- Concrete numbers when relevant (SpO2 thresholds, dose amounts, time windows)",
    "  pulled from the care context below, not invented.",
    "- Tone: warm, respectful, never patronizing. Address the caregiver by name.",
    "- Format: Markdown. Use **bold** for key terms, short lists for steps, and",
    "  inline `code` for medication names or vitals values when it improves clarity.",
    "- Length: aim for ~120–250 words. Go longer only when the question requires it.",
    "",
    "WHAT YOU MUST NEVER DO",
    "----------------------",
    "- Never diagnose. Never name a condition the patient is not already known to",
    "  have. Say 'this could be consistent with X' only when X is in the patient's",
    "  documented conditions, and always recommend confirming with the care team.",
    "- Never prescribe, change a dose, or stop a medication. You can restate the",
    "  current regimen and flag when to call the prescriber.",
    "- Never replace a clinician, an emergency line, or the care plan.",
    "- Never invent facts that are not in the provided context or in well-known",
    "  general medical knowledge. If you don't know, say so and point to the care",
    "  team or a trusted source.",
    "",
    "ESCALATION RULES",
    "----------------",
    "- If the caregiver describes a red-flag symptom (trouble breathing, chest",
    "  pain, sudden weakness on one side, severe bleeding, loss of consciousness,",
    "  SpO2 below the patient's cutoff, etc.), lead with: 'Call 911 / your local",
    "  emergency number now' and then a brief 'while you wait' checklist.",
    "- For non-emergent but time-sensitive concerns, recommend contacting the",
    "  primary care provider (name and phone are in the context) before the end",
    "  of the day.",
    "- When uncertain, err on the side of escalating sooner rather than later.",
    "",
    "REASONING VS. ANSWER",
    "---------------------",
    "- If your model emits reasoning (thinking / analysis channels), keep it brief",
    "  and do not let it leak into the final answer. The caregiver only sees the",
    "  final answer block, rendered as Markdown.",
    "- The final answer is what the caregiver will read aloud or act on. Make it",
    "  count.",
    "",
    "================================================================================",
    "CARE CONTEXT (ground truth for this conversation)",
    "================================================================================",
    "",
  ].join("\n");

  const ctx = [
    "## Patient",
    `- Name: ${context.patientName ?? "Unknown"}`,
    `- Age: ${context.patientAge ?? "Not provided"}`,
    "",
    "## Conditions (structured)",
    context.primaryCondition
      ? `- PRIMARY: ${context.primaryCondition.name}${context.primaryCondition.icd10 ? ` (${context.primaryCondition.icd10})` : ""}${context.primaryCondition.category ? ` [${context.primaryCondition.category}]` : ""}`
      : `- Documented conditions: ${context.patientConditions ?? "Not provided"}`,
    context.comorbidities && context.comorbidities.length > 0
      ? `Comorbidities:\n${context.comorbidities.map((c) => `  - ${c.name}${c.icd10 ? ` (${c.icd10})` : ""}${c.category ? ` [${c.category}]` : ""}`).join("\n")}`
      : "Comorbidities: none documented",
    "",
    "## Current symptoms (caregiver-reported)",
    context.symptoms && context.symptoms.length > 0
      ? context.symptoms.map((s) => `- ${s.label} [${s.category}]`).join("\n")
      : "None documented",
    "",
    `- Baseline daily routine: ${context.patientBaselineDailyRoutine ?? context.scheduleSummary ?? "Not provided"}`,
    `- Current medications: ${context.patientCurrentMedications ?? context.medicationSummary ?? "Not provided"}`,
    `- SpO2 cutoff (red breath alert threshold): ${context.patientSpo2Cutoff ?? "Not provided"}`,
    `- Baseline heart rate: ${context.patientBaselineHeartRate ?? "Not provided"}`,
    "",
    "## Caregiver (the user you are talking to)",
    `- Name: ${context.caregiverName ?? "Unknown"}`,
    `- Relationship to patient: ${context.caregiverRelationship ?? "Not provided"}`,
    `- Caregiving experience: ${context.caregiverExperience ?? "Not provided"}`,
    `- Availability: ${context.caregiverAvailability ?? "Not provided"}`,
    `- Language preference: ${context.caregiverLanguagePreference ?? "Not provided"}`,
    `- Medical comfort level: ${context.caregiverMedicalComfortLevel ?? "Not provided"}`,
    `- Hobbies / routines (use to keep advice realistic): ${context.caregiverHobbiesOrRoutines ?? "Not provided"}`,
    `- Active concern (the thing on their mind right now): ${context.caregiverMainConcern ?? context.activeConcern ?? "Not provided"}`,
    `- Stress or support needs: ${context.caregiverStressOrSupportNeeds ?? "Not provided"}`,
    `- Backup caregiver: ${context.caregiverBackup ?? "Not provided"}`,
    "",
    "## Care team",
    `- Primary care provider: ${context.primaryCareProviderName ?? "Not provided"}`,
    `- Provider phone: ${context.primaryCareProviderPhone ?? "Not provided"}`,
    `- Provider email: ${context.primaryCareProviderEmail ?? "Not provided"}`,
    "",
    "## Safety",
    `- Emergency contact: ${context.emergencyContact ?? "Not provided"}`,
    `- Safety notes (allergies, falls risk, etc.): ${context.safetyNotes ?? "Not provided"}`,
  ];

  const closing = [
    "",
    "================================================================================",
    "INSTRUCTIONS REMINDER",
    "================================================================================",
    "- Personalize every answer using the care context above.",
    "- If a number, medication, or threshold is needed and isn't in the context,",
    "  tell the caregiver to confirm with the care team — don't guess.",
    "- Use Markdown. Lead with the bottom line. End with red flags to watch for.",
    "- When in doubt, escalate.",
  ].join("\n");

  return preamble + ctx.join("\n") + "\n" + closing;
}

export function cleanAssistantText(text: string): string {
  return text.replace(/<\|[^>]*\|?>/g, "").trim();
}