import {
  getOnboardingProfile,
  getPrimaryIcdDisplay,
} from "@/services/onboarding/onboardingService";

const DEFAULT_PATIENT_ID = "default-patient";

export type DashboardPatientSummary = {
  patientId: string;
  patientName: string;
  patientInitials: string;
  patientAge: string;
  providerName: string;
  primaryDiagnosis: string;
  spo2Cutoff: string;
  baselineHeartRate: string;
  caregiverName: string;
  caregiverRelationship: string;
  comorbidityCount: number;
  source: "sqlite" | "onboarding";
};

export function getFallbackDashboardPatientSummary(): DashboardPatientSummary {
  const profile = getOnboardingProfile();
  const patient = profile.patient;
  const caregiver = profile.caregiver;

  return {
    patientId: DEFAULT_PATIENT_ID,
    patientName: patient.name,
    patientInitials: getInitials(patient.name),
    patientAge: patient.age,
    providerName: profile.primaryCareProvider.name,
    primaryDiagnosis: getPrimaryIcdDisplay(patient),
    spo2Cutoff: patient.spo2Cutoff ?? "88%",
    baselineHeartRate: patient.baselineHeartRate ?? "72-88 BPM",
    caregiverName: caregiver.name,
    caregiverRelationship: caregiver.relationship,
    comorbidityCount: patient.comorbidities?.length ?? 0,
    source: "onboarding",
  };
}

export async function getDashboardPatientSummary(
  patientId = DEFAULT_PATIENT_ID,
): Promise<DashboardPatientSummary> {
  const fallback = getFallbackDashboardPatientSummary();

  try {
    const { getCaregiverForPatient, getConditionsForPatient, getPatient } =
      await import("@/data");

    const patient = getPatient(patientId);

    if (!patient) {
      return fallback;
    }

    const caregiver = getCaregiverForPatient(patientId);
    const conditions = getConditionsForPatient(patientId);
    const primaryCondition = conditions[0];
    const primaryDiagnosis = primaryCondition
      ? formatCondition(primaryCondition.icd10, primaryCondition.name)
      : fallback.primaryDiagnosis;

    return {
      patientId,
      patientName: patient.name || fallback.patientName,
      patientInitials: getInitials(patient.name || fallback.patientName),
      patientAge: patient.age ?? fallback.patientAge,
      providerName: fallback.providerName,
      primaryDiagnosis,
      spo2Cutoff: patient.spo2Cutoff ?? fallback.spo2Cutoff,
      baselineHeartRate: patient.baselineHeartRate ?? fallback.baselineHeartRate,
      caregiverName: caregiver?.name ?? fallback.caregiverName,
      caregiverRelationship:
        caregiver?.relationship ?? fallback.caregiverRelationship,
      comorbidityCount:
        conditions.length > 0
          ? Math.max(conditions.length - 1, 0)
          : fallback.comorbidityCount,
      source: "sqlite",
    };
  } catch (error) {
    if (__DEV__) {
      console.warn("Patient summary database read failed:", error);
    }

    return fallback;
  }
}

function formatCondition(code: string | undefined, name: string): string {
  return code ? `${code} · ${name}` : name;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
