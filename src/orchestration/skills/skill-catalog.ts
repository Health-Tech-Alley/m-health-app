/**
 * Caregiver-concierge skill catalog.
 *
 * Per planning/17: 4 core skills (explain-anomaly, clarifying-qa,
 * next-steps, portal-message-draft) plus caregiver-chat (free-form chat
 * default) and visit-prep. Each ships with a prompt fragment and a strict
 * tool allow-list.
 *
 * Selection (per doc 17 open question #1) is explicit for the first pass;
 * the orchestrator picks the right skill at each call site.
 *
 * Tula attribution: the eight skill slots mirror Tula's eight live skills
 * (see planning/17 §1). Patterns + eval tasks are adapted from Tula's
 * Patient Agent Eval Standard v0.1 (Apache-2.0). No code was copied —
 * patterns only.
 */

import { registerSkill, type Skill } from './skill-registry';

const SKILLS: Skill[] = [
  {
    id: 'explain-anomaly',
    name: 'Explain an anomaly',
    purpose:
      'Translate the active health alert into plain language for the caregiver. ' +
      'Lead with the action they should take, then why, then any red flags. ' +
      'Cite clinical evidence; ground claims in the ML model output (top features).',
    tulaAnalog: '(new — extends myhealth-pulse with caregiver framing)',
    allowedTools: [
      'get_patient_profile',
      'get_recent_vitals',
      'get_active_thresholds',
      'get_active_alerts',
    ],
    evalTaskIds: ['ST-01-explain-spo2-drop', 'ST-01-explain-hr-spike', 'ST-01-avoid-diagnosis'],
    promptFragment: `SKILL: explain-anomaly
- The user just opened an alert. Translate it in plain language. Lead with the action.
- Use the ML model's top features as the WHY; the caregiver observations as ground truth.
- Never diagnose. Never override the rule engine. Cite clinical evidence in [docId] brackets.
- If information is missing, ask ONE multiple-choice clarifying question.
- When the alert involves a severe or terminal risk, state it plainly but tenderly — never lead with or dwell on the worst outcome. Move quickly to what the caregiver can do.`,
  },
  {
    id: 'clarifying-qa',
    name: 'Clarifying question',
    purpose:
      'Take the caregiver\'s answer to a previous clarifying question, log it as an ' +
      'observation, and re-run the explain flow with the new fact.',
    tulaAnalog: '(new — single-action discipline from epic-note)',
    allowedTools: ['log_observation', 'get_patient_profile', 'get_recent_vitals'],
    evalTaskIds: ['ST-01-qa-ground-truth-ack', 'ST-01-qa-no-open-question'],
    promptFragment: `SKILL: clarifying-qa
- The caregiver answered a multiple-choice question. Re-explain with the new fact.
- Do NOT re-ask the same question. Do NOT ask new open-ended questions.
- The answer is ground truth. If it makes the alert irrelevant, say so and propose Monitor at home.`,
  },
  {
    id: 'next-steps',
    name: 'Propose next steps',
    purpose:
      'Recommend 1-4 next-step options from the canonical 8-action taxonomy ' +
      '(call_911, go_to_er, contact_pcp, geofence_service, schedule_urgent_appt, ' +
      'share_record, monitor_home, log_note). Order by urgency.',
    tulaAnalog: 'epic-note (drafting)',
    allowedTools: [
      'get_patient_profile',
      'get_recent_vitals',
      'get_active_thresholds',
      'get_active_alerts',
      'schedule_appointment',
      'list_upcoming_appointments',
      'set_follow_up_reminder',
    ],
    evalTaskIds: ['ST-03-911-first', 'ST-03-er-included', 'ST-03-pcp-when-stable'],
    promptFragment: `SKILL: next-steps
- Output EXACTLY the NEXT_STEPS block, in this format:
  NEXT_STEPS:
  - [<actionId>] <label>
- Order by urgency. Severity-3 must include call_911 and/or go_to_er first.
- Allowed action ids: call_911, go_to_er, contact_pcp, geofence_service, schedule_urgent_appt, share_record, monitor_home, log_note.`,
  },
  {
    id: 'portal-message-draft',
    name: 'Draft a portal message',
    purpose:
      'Draft a clinician-facing message the caregiver can review, edit, and ' +
      'send through the secure messaging store. NEVER auto-sent — consent-gated.',
    tulaAnalog: 'epic-note',
    allowedTools: [
      'get_patient_profile',
      'get_recent_vitals',
      'log_observation',
    ],
    evalTaskIds: ['ST-02-message-structured', 'ST-02-message-no-diagnosis', 'ST-02-message-asks-question'],
    promptFragment: `SKILL: portal-message-draft
- Draft a clinician-facing message in plain, respectful prose.
- Structure: 1) one-line summary, 2) the caregiver's observation, 3) any specific question.
- Never name a diagnosis. The clinician decides. Flag any red flags the clinician should know about.
- The message is DRAFTED. The caregiver confirms before anything is sent.`,
  },
  {
    id: 'caregiver-chat',
    name: 'Caregiver chat (default)',
    purpose:
      'Free-form caregiver chat. Practical, warm, adaptive length. Use the patient ' +
      'context to personalize. No tools needed unless the caregiver asks for ' +
      'something that requires live data (appointments, vitals).',
    allowedTools: [
      'get_patient_profile',
      'get_recent_vitals',
      'get_active_thresholds',
      'list_upcoming_appointments',
      'evaluate_hypothetical_vitals',
    ],
    evalTaskIds: ['ST-conversational-tone', 'ST-name-personalization', 'ST-concise'],
    promptFragment: `SKILL: caregiver-chat
- Conversational caregiver support. Address the caregiver by first name.
- Adapt response length to the query: brief for simple questions, detailed when warranted. Lead with the action.
- When you do list steps, use a short bulleted list. Otherwise write prose.
- Use the patient's care context to personalize. If a number is needed and isn't in context, ask.
- When describing a medication, lead with what it's for, then common effects, then a brief gentle note on serious reactions. Favor the type of reaction over the worst outcome (e.g. "serious allergic reactions have been reported" rather than "death is possible").
- When the caregiver describes vitals, a what-if scenario, or asks the Health Monitor to analyze numbers, you may propose the tool by emitting exactly one line:
  ACTION: evaluate_hypothetical_vitals({"blood_oxygen":86,"heart_rate":110,"respiratory_rate":28})
- SpO2 is 0–100 percent (86, not 0.86). Do not invent ML scores or claim Health Monitor results before the caregiver confirms the tool run.
- When the caregiver gives vitals or a what-if, the app may run Health Monitor automatically after your reply. After proposing ACTION, do not invent scores; wait for monitor results in a follow-up turn.`,
  },
  {
    id: 'visit-prep',
    name: 'Pre-visit summary',
    purpose:
      'Build a pre-appointment summary for the caregiver to bring to a visit: ' +
      'recent vitals, current meds, open alerts, and any caregiver observations.',
    tulaAnalog: 'prep-my-visit',
    allowedTools: [
      'get_patient_profile',
      'get_recent_vitals',
      'get_active_alerts',
      'get_active_thresholds',
      'list_upcoming_appointments',
    ],
    evalTaskIds: ['ST-visit-prep-structured', 'ST-visit-prep-no-diagnosis'],
    promptFragment: `SKILL: visit-prep
- Build a one-page visit summary for the caregiver to bring to the next appointment.
- Sections: 1) Patient + visit info, 2) Recent vitals (24-72h), 3) Current meds, 4) Open alerts / observations, 5) 2-3 questions to ask.
- Do not diagnose. Stick to the patient's documented conditions. Cite sources when relevant.`,
  },
  {
    // planning/33 §11.1 — review the imported longitudinal EHR and
    // produce a caregiver-facing summary grounded in CDA narrative
    // chunks retrieved via BM25. Read-only — no tool calls.
    id: 'summarize-ehr',
    name: 'Summarize the longitudinal EHR',
    purpose:
      'Review the patient\'s longitudinal EHR (multiple CDA documents, ' +
      'discharge instructions, plan of treatment, functional status) and ' +
      'produce a 3-paragraph caregiver-facing summary: what happened, ' +
      'where things stand, what to watch.',
    tulaAnalog: '(new — extends myhealth-pulse with longitudinal review)',
    allowedTools: ['get_patient_profile', 'get_recent_vitals'],
    evalTaskIds: ['ST-ehr-summary-citations', 'ST-ehr-summary-no-invention'],
    promptFragment: `SKILL: summarize-ehr
- The user just imported a zip of CDA documents and wants a longitudinal review.
- The CLINICAL KNOWLEDGE block contains the imported CDA narrative chunks
  (discharge instructions, plan of treatment, functional status) tagged
  with [CDA-DOCxxxx-...].
- Produce a 3-paragraph summary for the caregiver:
  1. WHAT HAPPENED — the key clinical events (surgeries, ED visits, admissions).
  2. WHERE THINGS STAND — current active conditions, medications, functional status.
  3. WHAT TO WATCH — trends or patterns the caregiver should monitor.
- Cite every claim as [CDA-DOCxxxx-...]. Do not invent events that are
  not in the citations. If a section has no evidence, say so explicitly.
- When the record includes severe or terminal events (cardiac arrest, ICU, hospice, death), mention them plainly but tenderly — never lead with the worst outcome, never dwell. One sentence, then move to what it means for the caregiver now.`,
  },
  {
    // Disability-first care gaps for complex home care (not ambulatory HEDIS panels).
    id: 'detect-care-gaps',
    name: 'Detect care gaps',
    purpose:
      'Cross-reference the patient\'s imported EHR and care context against ' +
      'disability-relevant home-care gaps (airway, aspiration, skin, seizure ' +
      'rescue, autonomic dysreflexia, transfers, therapy follow-through). ' +
      'Output a bulleted list of gaps with recommended caregiver actions.',
    tulaAnalog: '(disability-first gap analysis on imported data)',
    allowedTools: ['get_patient_profile', 'get_recent_vitals'],
    evalTaskIds: ['ST-care-gaps-cited', 'ST-care-gaps-actionable'],
    promptFragment: `SKILL: detect-care-gaps
- The user wants a care-gap analysis based on the imported EHR and care plan.
- Focus on severely disabled / complex home-care risks — NOT generic adult
  preventive panels (do not prioritize colonoscopy schedules, routine adult
  immunization checklists, or ambulatory HEDIS boilerplate unless the EHR
  explicitly documents that gap as clinically material).
- Identify gaps such as:
  • Airway / breathing supports (suction plan, SpO2 cutoff awareness,
    rescue inhaler or BiPAP when respiratory conditions are present).
  • Aspiration / feeding safety (dysphagia precautions, G-tube plan).
  • Skin & pressure (repositioning schedule, brace/splint skin checks).
  • Seizure rescue med available and known when epilepsy/seizure history.
  • Autonomic dysreflexia awareness when Spina Bifida / SCI at T6 or above.
  • Transfer / fall-risk supports and equipment when mobility is limited.
  • Bowel/bladder program when incontinence or neurogenic bladder is present.
  • Missed or overdue therapy / specialist follow-up documented in the record.
  • Vitals outside the patient's personalized thresholds.
- Output: a bulleted list. Each gap should cite the source
  ([CDA-DOCxxxx-...] for EHR data, [PMID-...] for evidence) and propose
  ONE concrete action the caregiver can take.`,
  },
  {
    // planning/33 §11.3 — template-driven care-plan draft from the EHR.
    // The SLM fills a deterministic JSON template; it does NOT free-form
    // generate the care plan structure. Per the user: "I would like the
    // care plan output to tightly follow a well-designed template."
    id: 'draft-care-plan',
    name: 'Draft a care plan from the EHR (template-guided)',
    purpose:
      'Fill a structured care-plan template (goals, medication indications, ' +
      'thresholds, action items) from cited EHR evidence. The template ' +
      'structure and red flags are pre-filled — the SLM only populates fields.',
    tulaAnalog: '(new — template-guided plan generation from longitudinal EHR)',
    allowedTools: ['get_patient_profile', 'get_recent_vitals'],
    evalTaskIds: ['ST-care-plan-template-filled', 'ST-care-plan-cited'],
    promptFragment: `SKILL: draft-care-plan (template-guided)
- The user wants a care plan drafted from the imported EHR.
- A JSON template skeleton is provided in the user message.
- Fill ONLY these fields from the CLINICAL KNOWLEDGE citations:
  • goals[] — one per domain max, each with goalStatement + rationale cited as [CDA-DOCxxxx-...]
  • medications[].indication — what the med is for (from EHR)
  • medications[].monitoring — what to watch for this med
  • thresholds[] — ONLY if the EHR shows a documented target (e.g., "keep SpO2 > 92%")
  • actionItems[] — from discharge instructions / plan of treatment narrative
- DO NOT modify: patientSummary, redFlags (these are pre-filled and locked)
- Leave a field empty if no EHR evidence exists — do NOT invent values
- OUTPUT: the filled JSON template (valid JSON, no prose, no markdown fences)`,
  },
  {
    // doc 38 — UC3 Long-Term Trajectory Failure explain
    id: 'explain-rehab-trajectory',
    name: 'Explain rehab trajectory failure',
    purpose:
      'Explain a UC3 long-term rehab trajectory result to the caregiver in ' +
      'plain language. Input is structured: eventType, reasonCodes, ' +
      'metricAnalyses, dataQuality, plan targets.',
    tulaAnalog: '(new — extends explain-anomaly with rehab context)',
    allowedTools: [
      'get_patient_profile',
      'get_recent_vitals',
      'get_active_thresholds',
    ],
    evalTaskIds: ['UC3-explain-structured', 'UC3-message-no-diagnosis', 'UC3-message-includes-plateau-or-gap-facts'],
    promptFragment: `SKILL: explain-rehab-trajectory
- The user opened a UC3 rehab trajectory alert. Explain it in plain language. Lead with the action.
- Input is structured: eventType, reasonCodes, metricAnalyses, dataQuality, plan targets.
- Explain in plain language for the caregiver. Do NOT diagnose. Do NOT change severity. Do NOT invent vitals.
- Affirm adherence when HIGH_ADHERENCE is present — the caregiver is doing the work.
- Suggest discussing plan adjustment with clinician for TRAJECTORY_FAILURE_DETECTED.
- End with guidance, not medical advice. Use existing concierge rules.`,
  },
  {
    // doc 38 — UC4 provider summary rewrite
    id: 'uc4-provider-summary-rewrite',
    name: 'Rewrite UC4 provider summary',
    purpose:
      'Rewrite a deterministic UC4 provider summary for clinician readability. ' +
      'The summary is pre-generated; this skill only rewrites prose. Never scores.',
    tulaAnalog: '(new — provider-facing rewrite from deterministic summary)',
    allowedTools: ['get_patient_profile'],
    evalTaskIds: ['UC4-rewrite-facts-unchanged', 'UC4-rewrite-no-diagnosis', 'UC4-rewrite-no-score-change'],
    promptFragment: `SKILL: uc4-provider-summary-rewrite
- The app has generated a deterministic UC4 care-priority summary.
- REWRITE the prose for clinician readability. Keep ALL facts, scores, and templateIds exactly as provided.
- Do NOT add diagnosis language. Do NOT invent medication causality.
- Do NOT change any score, templateId, or safetyTag. Do NOT add watch areas.
- Return the rewritten summary as plain text with the same section headers.`,
  },
];

let registered = false;
export function ensureSkillsRegistered(): void {
  if (registered) return;
  for (const skill of SKILLS) {
    registerSkill(skill);
  }
  registered = true;
}

ensureSkillsRegistered();
