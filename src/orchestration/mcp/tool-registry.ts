/**
 * MCP tool registry.
 *
 * This is the single source of truth for tools the orchestrator can call.
 * Tool descriptions are also used by the fused retriever for tool-RAG.
 *
 * Per planning/17: each tool is tagged with the skill IDs that are allowed
 * to call it. The orchestrator's tool-RAG filter (see
 * `src/orchestration/skills/filterToolsForSkill`) uses these tags to enforce
 * a strict per-skill allow-list. The registry stays the single source of
 * truth; the skill catalog imports + composes these tags.
 */

import type { SkillId } from '@/orchestration/skills';

export type ToolParam = {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
  options?: string[]; // for multiple-choice params
};

export type ToolSchema = {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  /**
   * Skills that are allowed to call this tool. Empty array = not exposed
   * to any user-facing skill (orchestrator-internal use only).
   *
   * Optional for backward compatibility with hand-rolled RegisteredTool
   * objects (e.g. the agents/ registry). Missing values are treated as
   * empty (= orchestrator-internal).
   */
  allowedSkills?: SkillId[];
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export type RegisteredTool = ToolSchema & {
  handler: ToolHandler;
};

// Tools every skill that reads patient state may call.
const READ_ONLY_SKILLS: SkillId[] = [
  'explain-anomaly',
  'next-steps',
  'portal-message-draft',
  'caregiver-chat',
  'visit-prep',
];

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'get_patient_profile',
    description: 'Read the patient profile including conditions, meds, and baseline vitals.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
    allowedSkills: READ_ONLY_SKILLS,
  },
  {
    name: 'get_recent_vitals',
    description: 'Read recent vital samples for a patient and vital type.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
      vitalType: { type: 'string', description: 'e.g. spo2, heart_rate', required: true },
      hours: { type: 'number', description: 'How many hours back to look', required: true },
    },
    allowedSkills: READ_ONLY_SKILLS,
  },
  {
    name: 'get_active_thresholds',
    description: 'Read active alert thresholds for a patient.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
    allowedSkills: ['explain-anomaly', 'next-steps', 'caregiver-chat', 'visit-prep'],
  },
  {
    name: 'get_active_alerts',
    description: 'Read open alerts for a patient.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
    allowedSkills: ['explain-anomaly', 'next-steps', 'visit-prep'],
  },
  {
    name: 'log_observation',
    description: 'Record a caregiver observation tied to an alert.',
    params: {
      alertId: { type: 'string', description: 'Alert identifier', required: true },
      observation: { type: 'string', description: 'Free-text observation', required: true },
    },
    allowedSkills: ['clarifying-qa', 'portal-message-draft'],
  },
  {
    name: 'dispatch_alert_notification',
    description: 'Send an urgent alert notification (severity 3 fast path).',
    params: {
      alertId: { type: 'string', description: 'Alert identifier', required: true },
      bypassDnd: { type: 'boolean', description: 'Whether to bypass Do Not Disturb', required: true },
    },
    // Orchestrator-internal; never exposed to user-facing skills.
    allowedSkills: [],
  },
  {
    name: 'ask_clarifying_question',
    description: 'Ask the caregiver a multiple-choice clarifying question.',
    params: {
      question: { type: 'string', description: 'Question text', required: true },
      options: { type: 'string', description: 'JSON array of option labels', required: true },
      alertId: { type: 'string', description: 'Alert identifier', required: true },
    },
    allowedSkills: ['explain-anomaly'],
  },
  {
    name: 'schedule_appointment',
    description: 'Schedule an appointment for the patient. Persists to the appointments table and audit-logs. Requires confirmation.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
      providerName: { type: 'string', description: 'Provider name', required: false },
      reason: { type: 'string', description: 'Reason for visit', required: true },
      preferredDate: { type: 'string', description: 'ISO date (yyyy-mm-dd)', required: false },
      time: { type: 'string', description: 'Time label e.g. 10:30 AM', required: false },
      type: { type: 'string', description: 'Appointment type e.g. Primary care', required: false },
    },
    allowedSkills: ['next-steps'],
  },
  {
    name: 'update_appointment',
    description: 'Modify an existing appointment (date, time, provider, reason, etc.).',
    params: {
      appointmentId: { type: 'string', description: 'Appointment identifier', required: true },
      patientId: { type: 'string', description: 'Patient identifier', required: true },
      type: { type: 'string', description: 'New appointment type', required: false },
      providerName: { type: 'string', description: 'New provider name', required: false },
      date: { type: 'string', description: 'New ISO date', required: false },
      time: { type: 'string', description: 'New time label', required: false },
      reason: { type: 'string', description: 'New reason', required: false },
    },
    allowedSkills: [],
  },
  {
    name: 'delete_appointment',
    description: 'Cancel and delete an appointment. Requires confirmation.',
    params: {
      appointmentId: { type: 'string', description: 'Appointment identifier', required: true },
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
    allowedSkills: [],
  },
  {
    name: 'list_upcoming_appointments',
    description: 'List the patient\'s upcoming (scheduled) appointments.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
    allowedSkills: ['next-steps', 'caregiver-chat', 'visit-prep'],
  },
  {
    name: 'add_medication',
    description: 'Add a custom medication to the patient\'s regimen. Requires confirmation.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
      name: { type: 'string', description: 'Medication name', required: true },
      dosage: { type: 'string', description: 'Dose e.g. 2 puffs', required: false },
      frequency: { type: 'string', description: 'Instructions / frequency', required: false },
      timeOfDay: { type: 'string', description: 'Administration time (HH:mm)', required: false },
    },
    allowedSkills: [],
  },
  {
    name: 'update_medication',
    description: 'Edit a medication\'s name, dose, frequency, or administration time. Requires confirmation.',
    params: {
      medicationId: { type: 'string', description: 'Medication identifier', required: true },
      patientId: { type: 'string', description: 'Patient identifier', required: true },
      name: { type: 'string', description: 'New name', required: false },
      dosage: { type: 'string', description: 'New dose', required: false },
      frequency: { type: 'string', description: 'New instructions / frequency', required: false },
    },
    allowedSkills: [],
  },
  {
    name: 'delete_medication',
    description: 'Remove a medication (hard-delete for custom meds, deactivate for care-plan meds). Requires confirmation.',
    params: {
      medicationId: { type: 'string', description: 'Medication identifier', required: true },
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
    allowedSkills: [],
  },
  {
    name: 'set_follow_up_reminder',
    description: 'Set a follow-up reminder for the caregiver.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
      alertId: { type: 'string', description: 'Alert identifier', required: false },
      message: { type: 'string', description: 'Reminder message', required: true },
      delayMinutes: { type: 'number', description: 'Minutes from now', required: true },
    },
    allowedSkills: ['next-steps'],
  },
  {
    name: 'evaluate_hypothetical_vitals',
    description: 'Run the on-device Health Monitor (UC2 decision layer) over hypothetical vitals supplied by the SLM. Returns the anomaly score, threshold, severity, emergency flag, and top contributing features. Use this to answer "what would happen if her SpO2 dropped to X" questions.',
    params: {
      heart_rate: { type: 'number', description: 'Hypothetical heart rate (bpm)', required: false },
      blood_oxygen: { type: 'number', description: 'Hypothetical SpO2 (0-100 %)', required: false },
      blood_pressure_systolic: { type: 'number', description: 'Hypothetical systolic BP', required: false },
      blood_pressure_diastolic: { type: 'number', description: 'Hypothetical diastolic BP', required: false },
      glucose_level: { type: 'number', description: 'Hypothetical glucose (mg/dL)', required: false },
      body_temperature: { type: 'number', description: 'Hypothetical temp (°F)', required: false },
      respiratory_rate: { type: 'number', description: 'Hypothetical respiratory rate', required: false },
    },
    allowedSkills: ['caregiver-chat', 'explain-anomaly'],
  },
  {
    name: 'propose_care_plan_update',
    description:
      'Propose a care plan update for the patient. This only DRAFTS a proposal — it is enqueued for the caregiver to confirm or decline, and nothing applies without their confirmation plus a final review pass. Use this when a PLAN WATCH signal clearly fits the conversation.',
    params: {
      intent: {
        type: 'string',
        description: 'Which plan-update intent to draft.',
        required: true,
        options: [
          'promote_uc4_to_plan_task',
          'review_monitoring_contract',
          'propose_therapy_contract_patch',
        ],
      },
      cardId: {
        type: 'string',
        description: 'UC4 care-focus card id (promote_uc4_to_plan_task only).',
        required: false,
      },
      resultId: {
        type: 'string',
        description: 'UC3 trajectory result id (therapy-related intents).',
        required: false,
      },
    },
    allowedSkills: ['caregiver-chat'],
  },
];

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  schemas(): ToolSchema[] {
    return this.list().map(({ name, description, params, allowedSkills }) => ({
      name,
      description,
      params,
      allowedSkills: allowedSkills ?? [],
    }));
  }
}
