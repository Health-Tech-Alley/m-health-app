/**
 * MCP tool registry.
 *
 * This is the single source of truth for tools the orchestrator can call.
 * Tool descriptions are also used by the fused retriever for tool-RAG.
 */

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

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'get_patient_profile',
    description: 'Read the patient profile including conditions, meds, and baseline vitals.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
  },
  {
    name: 'get_recent_vitals',
    description: 'Read recent vital samples for a patient and vital type.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
      vitalType: { type: 'string', description: 'e.g. spo2, heart_rate', required: true },
      hours: { type: 'number', description: 'How many hours back to look', required: true },
    },
  },
  {
    name: 'get_active_thresholds',
    description: 'Read active alert thresholds for a patient.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
  },
  {
    name: 'get_active_alerts',
    description: 'Read open alerts for a patient.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
  },
  {
    name: 'log_observation',
    description: 'Record a caregiver observation tied to an alert.',
    params: {
      alertId: { type: 'string', description: 'Alert identifier', required: true },
      observation: { type: 'string', description: 'Free-text observation', required: true },
    },
  },
  {
    name: 'dispatch_alert_notification',
    description: 'Send an urgent alert notification (severity 3 fast path).',
    params: {
      alertId: { type: 'string', description: 'Alert identifier', required: true },
      bypassDnd: { type: 'boolean', description: 'Whether to bypass Do Not Disturb', required: true },
    },
  },
  {
    name: 'ask_clarifying_question',
    description: 'Ask the caregiver a multiple-choice clarifying question.',
    params: {
      question: { type: 'string', description: 'Question text', required: true },
      options: { type: 'string', description: 'JSON array of option labels', required: true },
      alertId: { type: 'string', description: 'Alert identifier', required: true },
    },
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
  },
  {
    name: 'delete_appointment',
    description: 'Cancel and delete an appointment. Requires confirmation.',
    params: {
      appointmentId: { type: 'string', description: 'Appointment identifier', required: true },
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
  },
  {
    name: 'list_upcoming_appointments',
    description: 'List the patient\'s upcoming (scheduled) appointments.',
    params: {
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
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
  },
  {
    name: 'delete_medication',
    description: 'Remove a medication (hard-delete for custom meds, deactivate for care-plan meds). Requires confirmation.',
    params: {
      medicationId: { type: 'string', description: 'Medication identifier', required: true },
      patientId: { type: 'string', description: 'Patient identifier', required: true },
    },
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
    return this.list().map(({ name, description, params }) => ({
      name,
      description,
      params,
    }));
  }
}
