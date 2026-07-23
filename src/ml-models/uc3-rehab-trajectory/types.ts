export const MODEL_VERSION = "rehab_trajectory_rules_v0.2.0";
export const MODEL_FAMILY = "ACCESS-DP Long-Term Trajectory Failure";

export type EventType =
  | "NO_TRAJECTORY_FAILURE"
  | "TRAJECTORY_FAILURE_DETECTED"
  | "ROM_PLATEAU_TRAJECTORY_FAILURE"
  | "LOW_ADHERENCE_BARRIER"
  | "PAIN_LIMITED_PROGRESS"
  | "FATIGUE_LIMITED_PROGRESS"
  | "DATA_QUALITY_WARNING"
  | "INSUFFICIENT_DATA"
  | "URGENT_SAFETY_ESCALATION";

export type Severity =
  | "none"
  | "informational"
  | "non_emergency"
  | "urgent";

export interface PatientContext {
  patientId: string;
  displayName: string;
  ageYears: number;
  condition: string;
  setting: string;
  caregiverName: string;
  locationContext: string;
}

export interface ComplexityMetadata {
  finalScore: number;
  contributingFactors: string[];
  factorScores: Record<string, number>;
}

export interface EHRRehabContext {
  conditionGroup: string;

  complexityScore: number;

  complexityMetadata?: ComplexityMetadata;

  mobilityLimitations: string[];
  relevantHistory: string[];
  safetyConsiderations: string[];
  sourceSummary: string;
}

export interface RehabMetricPlan {
  metricName: RehabMetricName;
  baselineValue: number;
  targetValue: number;
  durationDays: number;
  higherIsBetter: boolean;
  expectedValues: number[];
}

export type RehabMetricName =
  | "romDegrees"
  | "exerciseReps"
  | "adherence"
  | "painScore"
  | "fatigueScore"
  | "walkingMinutes";

export interface MetricTargetOverride {
  baselineValue?: number;
  targetValue?: number;
  higherIsBetter?: boolean;
  enabled?: boolean;

  rationale?: string;

  source?: string;
}

export interface RehabPlanRuleOverrides {
  romGapThreshold?: number;
  plateauDaysThreshold?: number;
  adherenceMinimum?: number;
  painConcernThreshold?: number;
  fatigueConcernThreshold?: number;
  insufficientDataMinimumDays?: number;
}

export interface RehabPlanBuildOptions {
  durationDays?: number;

  metricTargets?: Partial<Record<RehabMetricName, MetricTargetOverride>>;

  ruleOverrides?: RehabPlanRuleOverrides;

  planSource?: string;

  planNote?: string;
}

export interface RehabPlanOverrideMetadata {
  hasOverrides: boolean;
  planSource?: string;
  planNote?: string;
  overriddenMetrics: RehabMetricName[];
  overriddenRules: string[];
}

export interface TrajectoryFailureRules {
  romGapThreshold: number;
  plateauDaysThreshold: number;
  minimumAdherenceForTrueFailure: number;
  minimumDataPoints: number;
}

export interface RehabPlan {
  planId: string;
  scenario: string;
  patient: PatientContext;
  conditionGroup: string;
  complexityScore: number;
  metricRelevance: Record<RehabMetricName, number>;
  durationDays: number;
  metrics: Record<RehabMetricName, RehabMetricPlan>;
  milestones: Record<RehabMetricName, number[]>;
  clinicianAuthoredGoals: string[];
  safetyBoundaries: string[];

  ruleThresholds?: {
    romGapThreshold: number;
    plateauDaysThreshold: number;
    adherenceMinimum: number;
    painConcernThreshold: number;
    fatigueConcernThreshold: number;
    insufficientDataMinimumDays: number;
  };

  overrideMetadata?: RehabPlanOverrideMetadata;
}

export interface DailyRehabLog {
  dayIndex: number;
  date?: string;

  romDegrees?: number;
  exerciseReps?: number;
  adherence?: number;
  painScore?: number;
  fatigueScore?: number;
  walkingMinutes?: number;

  exercisesAssigned?: number;
  exercisesCompleted?: number;
  therapyMinutesPlanned?: number;
  therapyMinutesCompleted?: number;
  sessionCompleted?: boolean;
  skippedReason?: string;

  adherenceSource?:
    | "existing_app_value"
    | "derived_from_daily_log"
    | "missing";
  adherenceDerivationNote?: string;

  symptoms?: string[];
  notes?: string;

  enteredBy?: "patient" | "caregiver" | "clinician" | "system";
  offlineCreatedAt?: string;
  syncedAt?: string;
}

export interface MetricAnalysis {
  metricName: string;
  finalActual: number | null;
  finalExpected: number | null;
  gap: number | null;
  gapPercent: number | null;
  recentSlope: number | null;
  plateauDays: number;
  dataPoints: number;
}

export interface DataQualityReport {
  totalExpectedDays: number;
  totalLoggedDays: number;
  missingDays: number[];
  completenessRatio: number;
  sufficientData: boolean;
  warnings: string[];
}

export interface EmergencyCheckResult {
  emergencyThresholdBreach: boolean;
  matchedSymptoms: string[];
  reasonCodes: string[];
  explanations: string[];
}

export interface RehabDecision {
  eventType: EventType;
  severity: Severity;
  requiresHumanReview: boolean;
  emergencyThresholdBreach: boolean;
  reviewPriorityScore: number;
  reasonCodes: string[];
  explanations: string[];
  metricAnalyses: Record<string, MetricAnalysis>;
  dataQuality: DataQualityReport;
  modelVersion: string;
  modelFamily: string;
  generatedAt: string;
}

export interface ShareRecordPayload {
  jsonrpc: "2.0";
  method: "share_record";
  params: {
    useCase: string;
    eventType: EventType;
    severity: Severity;
    patientId: string;
    requiresHumanReview: boolean;
    emergencyThresholdBreach: boolean;
    reviewPriorityScore: number;
    decisionSummary: string;
    reasonCodes: string[];
    encryptedBundleMetadata: {
      format: string;
      encryption: string;
      transportSecurity: string;
      localStorage: string;
      keyStorage: string;
    };
    fhirR4Hint: {
      resourceTypes: string[];
    };
    payload: {
      decision: RehabDecision;
      caregiverMessage: string;
      clinicianSummary: string;
    };
  };
  id: string;
}
