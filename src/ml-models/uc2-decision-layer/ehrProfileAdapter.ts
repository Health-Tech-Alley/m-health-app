/**
 * EHR / patient profile adapter.
 *
 * This module converts FHIR Bundles or plain profile objects into the
 * UC2-internal PatientProfile type, which is then used by:
 *   - featureImputation.ts (fill missing 18-vector features with baseline)
 *   - personalizedThresholds.ts (compute personalized severity floors)
 *   - payloadBuilders.ts (enrich SLM/provider payloads with context)
 *
 * Architecture notes:
 *   - The AE model NEVER reads raw FHIR/EHR documents directly.
 *   - EHR values do NOT add new model features (model stays 18-input fixed).
 *   - EHR values do NOT suppress hard emergency alerts.
 *   - EHR values do NOT change ae_score or reconstruction error.
 *   - This file is portable: it can later be moved to a shared ehr-profile/
 *     folder if the app develops a broader EHR layer.
 *
 * Usage:
 *   import { patientProfileFromFhirBundle, patientProfileFromPlainObject } from './ehrProfileAdapter';
 *   const profile = patientProfileFromFhirBundle(patientId, fhirBundle);
 *   // OR
 *   const profile = patientProfileFromPlainObject(patientId, rawProfileData);
 */

import type { FhirBundle, PatientProfile } from "./uc2Types";

// ── FHIR helpers ──────────────────────────────────────────────────────────────

function codeText(resource: any): string | undefined {
    return (
        resource?.code?.text ||
        resource?.code?.coding?.[0]?.display ||
        resource?.medicationCodeableConcept?.text ||
        resource?.medicationCodeableConcept?.coding?.[0]?.display
    );
}

function observationValue(resource: any): number | undefined {
    if (typeof resource?.valueQuantity?.value === "number") {
        return resource.valueQuantity.value;
    }
    return undefined;
}

// ── FHIR → PatientProfile ─────────────────────────────────────────────────────

/**
 * Convert a FHIR R4 Bundle into a UC2 PatientProfile.
 *
 * Extracts:
 *   - Patient demographics (name, dob)
 *   - Conditions (active problems)
 *   - Medications (MedicationRequest + MedicationStatement)
 *   - Goals / CarePlan goals
 *   - Baseline vitals from Observation resources (HR, SpO2, RR, Temp, BP, glucose, HRV)
 *
 * Note: body_temperature baseline from FHIR is assumed to be in Fahrenheit
 * (consistent with the model's temperature feature unit).
 */
export function patientProfileFromFhirBundle(
    patient_id: string,
    bundle: FhirBundle
): PatientProfile {
    const profile: PatientProfile = {
        patient_id,
        conditions: [],
        medications: [],
        care_plan_goals: [],
        baseline: {},
        care_plan_thresholds: [],
    };

    for (const entry of bundle.entry ?? []) {
        const r = entry.resource;
        if (!r?.resourceType) continue;

        if (r.resourceType === "Patient") {
            profile.display_name =
                r.name?.[0]?.text ||
                [r.name?.[0]?.given?.join(" "), r.name?.[0]?.family]
                    .filter(Boolean)
                    .join(" ");
            profile.date_of_birth = r.birthDate;
        }

        if (r.resourceType === "Condition") {
            const txt = codeText(r);
            if (txt) profile.conditions?.push(txt);
        }

        if (
            r.resourceType === "MedicationRequest" ||
            r.resourceType === "MedicationStatement"
        ) {
            const txt = codeText(r);
            if (txt) profile.medications?.push(txt);
        }

        if (r.resourceType === "Goal") {
            const txt = r.description?.text || r.description?.coding?.[0]?.display;
            if (txt) profile.care_plan_goals?.push(txt);
        }

        if (r.resourceType === "CarePlan") {
            const txt = r.description || r.title;
            if (txt) profile.care_plan_goals?.push(txt);
        }

        if (r.resourceType === "Observation") {
            const label = codeText(r)?.toLowerCase() ?? "";
            const value = observationValue(r);
            if (value === undefined) continue;

            if (label.includes("heart rate")) profile.baseline!.resting_heart_rate = value;
            if (label.includes("oxygen") || label.includes("spo2"))
                profile.baseline!.blood_oxygen = value;
            if (label.includes("respiratory")) profile.baseline!.respiratory_rate = value;
            if (label.includes("temperature")) profile.baseline!.body_temperature = value;
            if (label.includes("systolic")) profile.baseline!.systolic_bp = value;
            if (label.includes("diastolic")) profile.baseline!.diastolic_bp = value;
            if (label.includes("glucose")) profile.baseline!.glucose_level = value;
            if (label.includes("hrv")) profile.baseline!.hrv_sdnn = value;
        }
    }

    return profile;
}

// ── Plain object → PatientProfile ─────────────────────────────────────────────

/**
 * Build a PatientProfile from a plain key-value profile object
 * (e.g., from app's local patient record, Redux state, or SQLite row).
 *
 * Accepts any partial profile data. Missing fields are left undefined so the
 * imputation layer can handle them gracefully.
 */
export function patientProfileFromPlainObject(
    patient_id: string,
    data: {
        display_name?: string;
        date_of_birth?: string;
        conditions?: string[];
        medications?: string[];
        care_plan_goals?: string[];
        resting_heart_rate?: number;
        baseline_spo2?: number;
        baseline_respiratory_rate?: number;
        baseline_body_temperature?: number;
        baseline_systolic_bp?: number;
        baseline_diastolic_bp?: number;
        baseline_glucose?: number;
        baseline_hrv_sdnn?: number;
        clinician_name?: string;
        clinician_role?: string;
        clinician_endpoint?: string;
    }
): PatientProfile {
    return {
        patient_id,
        display_name: data.display_name,
        date_of_birth: data.date_of_birth,
        conditions: data.conditions ?? [],
        medications: data.medications ?? [],
        care_plan_goals: data.care_plan_goals ?? [],
        baseline: {
            resting_heart_rate: data.resting_heart_rate,
            blood_oxygen: data.baseline_spo2,
            respiratory_rate: data.baseline_respiratory_rate,
            body_temperature: data.baseline_body_temperature,
            systolic_bp: data.baseline_systolic_bp,
            diastolic_bp: data.baseline_diastolic_bp,
            glucose_level: data.baseline_glucose,
            hrv_sdnn: data.baseline_hrv_sdnn,
        },
        care_plan_thresholds: [],
        clinician_recipient:
            data.clinician_name || data.clinician_role || data.clinician_endpoint
                ? {
                    name: data.clinician_name,
                    role: data.clinician_role,
                    endpoint: data.clinician_endpoint,
                }
                : undefined,
    };
}
