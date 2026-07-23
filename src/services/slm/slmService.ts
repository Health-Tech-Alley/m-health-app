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
import { DEFAULT_SLM_MODEL_ID, MODEL_CATALOG } from "@/inference/model-catalog";
import { getHfToken } from "@/services/hf-token-store";
import { downloadModel } from "@/services/model-download";
import { isModelInstalled } from "@/services/model-storage";
import type { PatientRecordSnapshot } from "@/data/repositories/patientRecordRepository";
import { CONCIERGE_GENERATION_DEEP } from "@/constants/concierge";
import { TOOL_SCHEMAS } from "@/orchestration/mcp/tool-registry";
import { filterToolsForSkill, getSkillPromptFragment } from "@/orchestration/skills";
import { stripControlTokens } from "@/utils/stripControlTokens";
import {
  caregiverToneInstruction,
  escalationBlock,
  healthMonitorToolInstruction,
  patientBlock,
  personaPreamble,
  sensitiveTopicsInstruction,
  toolsBlock,
  type PriorDecisionEntry,
} from "@/orchestration/prompt-fragments";
import type { McpToolSummary } from "@/knowledge";

export { DEFAULT_SLM_MODEL_ID };
export const CAREGIVER_SLM_MODEL_ID = DEFAULT_SLM_MODEL_ID;

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
  const hasCuratedConditionRoles = confirmedConditions.some((condition) =>
    Boolean(condition.conditionRole),
  );
  const primary =
    confirmedConditions.find((c) => c.conditionRole === 'primary_diagnosis') ??
    snapshot.primaryCondition ??
    confirmedConditions.find((c) => c.isPrimary) ??
    confirmedConditions[0];
  const comorbidities = hasCuratedConditionRoles
    ? confirmedConditions.filter((c) => c.conditionRole === 'active_comorbidity')
    : confirmedConditions.filter((c) => c !== primary);

  return {
    patientName: snapshot.patient?.preferredName?.trim() || snapshot.patient?.name,
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
  skillId?: string;
}): Promise<CaregiverAssistantResponse> {
  const { provider, prompt, context = {}, onToken, signal, skillId } = params;

  const systemContext = buildCaregiverSystemContext(context, skillId ? { skillId } : undefined);

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
    CONCIERGE_GENERATION_DEEP,
  );

  return {
    answer: stripControlTokens(result.text).answer,
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

export function buildCaregiverSystemContext(
  context: CaregiverAssistantContext,
  options?: {
    skillId?: string;
    priorDecisions?: PriorDecisionEntry[];
    /**
     * When set (including empty array), replaces the default caregiver-chat
     * tool dump — used by Pre-SLM NLU budgeted tool injection (planning/35).
     */
    toolsOverride?: McpToolSummary[];
  },
): string {
  const caregiverFirst = (context.caregiverName ?? "").trim().split(/\s+/)[0] || "there";
  const patientFirst = (context.patientName ?? "").trim().split(/\s+/)[0] || "the patient";
  const relationshipLine = context.caregiverRelationship
    ? `When referring to ${patientFirst}, you can use the relationship (e.g. "your ${context.caregiverRelationship.toLowerCase()}") when it feels natural.`
    : "";

  const toneInstruction = caregiverToneInstruction(context.caregiverMedicalComfortLevel);
  const sensitiveTopics = sensitiveTopicsInstruction(context.caregiverMedicalComfortLevel);

  const preamble = [
    personaPreamble({ voice: 'chat', caregiverFirst, patientFirst }),
    relationshipLine,
    toneInstruction,
    "",
    "RESPONSE STYLE",
    "- When suggesting an action, lead with the action, not the reasoning.",
    "- When you do list steps, use a short bulleted list. Otherwise write prose.",
    "- Use Markdown sparingly: **bold** for one key term, short lists for steps. No long preambles.",
    "",
    "USING THE CAREGIVER'S NAME",
    "- Use the caregiver's name RARELY. Only in the very first message of a conversation, or in genuinely urgent/emotional situations.",
    "- NEVER start every response with the name. This feels robotic and repetitive.",
    "- For 95% of responses, do NOT use the name at all. Just answer directly.",
    "- BAD: \"Luis, the morning dose is at 8 AM.\" / \"Luis, yes, that's a common side effect.\"",
    "- GOOD: \"The morning dose is at 8 AM.\" / \"Yes, that's a common side effect.\"",
    "",
    "SAFETY RECOMMENDATIONS",
    "- Include safety monitoring advice (\"watch for X\", \"call if Y happens\") only when the query involves a concerning symptom, vital sign abnormality, or clinical uncertainty.",
    "- For straightforward information queries (drug side effects, scheduling, general education), answer the question directly without appending safety caveats.",
    "- Reserve emergency guidance (\"call 911\", \"go to the ER\") for clear red-flag situations.",
    "",
    sensitiveTopics,
    "",
    "CITING SOURCES",
    "- When the CLINICAL KNOWLEDGE block is provided and you use information from it, append that chunk's exact tag after the claim.",
    "- Tags look like [PubMed #1], [MedlinePlus #2], [Drug Label #3], [Care Plan #4] — always include the source name and the # number from the block.",
    "- Example: \"Common side effects include nausea and dizziness [Drug Label #1].\" or \"Studies show improved outcomes with early intervention [PubMed #2].\"",
    "- Do not invent tags or drop the # index. Don't cite for general knowledge not taken from the block.",
    "",
    "NEVER",
    "- Never diagnose. Never name a condition not already in the patient's record.",
    "- Never prescribe, change a dose, or stop a medication. Restate the regimen; flag when to call the prescriber.",
    "- Never replace a clinician, an emergency line, or the care plan.",
    "- Never invent numbers, medication names, or thresholds that aren't in the care context.",
    "",
    "IDENTITY LOCK",
    `- You are speaking only to ${caregiverFirst} about ${patientFirst} (the loaded patient record).`,
    `- If the user clearly refers to a different patient or claims to be a different caregiver, do NOT apply this record's meds/conditions to that other person. Ask them to confirm identity or switch profiles first.`,
    "",
    escalationBlock(context.primaryCareProviderName),
    "",
    "VOICE",
    `— "${caregiverFirst}, ${patientFirst}'s SpO2 dropped to 88% — below her safe zone. Given her COPD, I'd watch her breathing and call Dr. ${(context.primaryCareProviderName ?? "her doctor").split(/\s+/).slice(-1)[0] ?? "the doctor"} if it doesn't improve in 10 minutes."`,
    `— "You already gave the morning dose at 8 — the next one is due around 8 PM."`,
    `— "Prednisone is a steroid that calms inflammation and quietens the immune system — that's why it helps ${patientFirst}'s breathing. Most people notice more appetite and trouble sleeping; in rare cases, more serious reactions have been reported, so it's worth flagging anything unusual to the prescriber."`,
    "",
  ].filter(Boolean).join("\n");

  // The patient block uses the structured patient data from the context,
  // falling back to the legacy free-text fields for older callers.
  const pBlock = patientBlock({
    name: context.patientName ?? 'Unknown',
    age: context.patientAge,
    primaryCondition: context.primaryCondition,
    comorbidities: (context.comorbidities ?? []).map((c) => c.name),
    symptoms: context.symptoms ?? [],
    medications: context.patientCurrentMedications ?? context.medicationSummary,
    spo2Cutoff: context.patientSpo2Cutoff,
    baselineHeartRate: context.patientBaselineHeartRate,
  });

  // A compact, chat-specific context summary that preserves the older
  // caregiver-facing fields (daily routine, "on the caregiver's mind", PCP,
  // safety) that the chat path used to inject. Replaces the older
  // hand-rolled `CARE CONTEXT` block.
  const ctxLines: string[] = ["CARE CONTEXT (summary)"];
  if (context.patientBaselineDailyRoutine ?? context.scheduleSummary) {
    ctxLines.push(`Daily routine: ${context.patientBaselineDailyRoutine ?? context.scheduleSummary}.`);
  }
  if (context.activeConcern ?? context.caregiverMainConcern) {
    ctxLines.push(`On the caregiver's mind: ${context.activeConcern ?? context.caregiverMainConcern}.`);
  }
  if (context.primaryCareProviderName) {
    ctxLines.push(`PCP: ${context.primaryCareProviderName}${context.primaryCareProviderPhone ? ` · ${context.primaryCareProviderPhone}` : ""}.`);
  }
  if (context.safetyNotes) {
    ctxLines.push(`Safety: ${context.safetyNotes}.`);
  }
  const ctx = ctxLines.join("\n");

  // Chat path defaults to caregiver-chat (tools + Health Monitor rules).
  // Explicit non-chat skills keep their own fragment without chat tool block.
  const skillId = options?.skillId;
  const skillFragment = getSkillPromptFragment(skillId ?? '');
  const toolsSkillId = !skillId || skillId === 'caregiver-chat' ? 'caregiver-chat' : null;

  const prior = options?.priorDecisions ?? [];

  let toolsSection = '';
  if (options?.toolsOverride !== undefined) {
    if (options.toolsOverride.length > 0) {
      toolsSection = `\n${toolsBlock(options.toolsOverride)}\n\n${healthMonitorToolInstruction()}\n`;
    }
  } else if (toolsSkillId) {
    const visibleTools = filterToolsForSkill(toolsSkillId, TOOL_SCHEMAS);
    const toolSummaries: McpToolSummary[] = visibleTools.map((t) => ({
      name: t.name,
      description: t.description,
      params: Object.fromEntries(
        Object.entries(t.params).map(([name, p]) => [
          name,
          { type: p.type, required: p.required ?? false },
        ]),
      ),
    }));
    if (toolSummaries.length > 0) {
      toolsSection = `\n${toolsBlock(toolSummaries)}\n\n${healthMonitorToolInstruction()}\n`;
    }
  }

  return `${preamble}\n${pBlock}\n\n${ctx}\n${prior.length > 0 ? `\nPRIOR DECISIONS\n${prior.map((e) => `- ${e.at.slice(0, 10)} · ${e.verb} · ${e.summary}`).join('\n')}\n` : ''}${skillFragment ? `\n${skillFragment}\n` : ''}${toolsSection}`;
}
