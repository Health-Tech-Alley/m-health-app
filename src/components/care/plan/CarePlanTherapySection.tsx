/**
 * Care plan "Therapy" section (planning/41 §5, §11).
 *
 * Hard-gated on `therapyContractPresent === true` (D9). Contains the daily
 * rehab check-in + progress result + progress metrics. Care-focus cards live
 * in CarePlanFocusSection (all personas). The caller must not render this
 * when the therapy contract is absent.
 *
 * This is a "thin" port of the original care.tsx therapy block — it owns
 * the same state (check-in completion, exercise toggles, field edits,
 * skipped reason) and delegates UC3/UC4 explain + respond through the
 * caller.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { InCardMiniChat } from '@/components/care/InCardMiniChat';
import { AppTheme } from '@/constants/theme';
import {
  getCurrentPatientSnapshot,
  usePatientRecord,
} from '@/contexts/patient-record-context';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslateFn } from '@/localization/i18n';
import {
  DAILY_CARE_SKIPPED_REASON_OPTIONS,
  DAILY_CARE_URGENT_SYMPTOM_OPTIONS,
  filterCompletedExerciseKeysForAssignments,
  getAssignedDevelopmentRehabExercises,
  mergeDailyCareUrgentSymptoms,
  upsertDailyCareEntry,
  type DailyCareEntry,
  type DailyCareUrgentSymptomCode,
  type PatientRecordSnapshot,
  type RehabExerciseAssignment,
  type RehabExerciseKey,
  type RehabilitationMeasurement,
  type RehabilitationMeasurementType,
} from '@/data';
import { getRehabilitationMeasurements } from '@/data/repositories/rehabilitationMeasurementRepository';
import { buildUc3ResultExplainPrompt } from '@/services/carePlan/careExplainPrompts';
import { buildUc3TherapySeedSupplement } from '@/services/carePlan/uc3TherapyChatContext';
import { evaluateAndPersistUc3Trajectory } from '@/services/uc3/uc3EvaluationService';
import { evaluateAndPersistUc4Priorities } from '@/services/uc4/uc4EvaluationService';
import {
  type Uc3ResultDisplay,
} from '@/services/uc3/uc3ResultPresenter';
import { createThemedSectionStyles } from './carePlanSectionStyles';

type DailyCareEditField =
  | 'setsCompleted'
  | 'exerciseRepetitions'
  | 'romDegrees'
  | 'walkingMinutes'
  | 'painScore'
  | 'fatigue';

type RequiredDailyLogField = Exclude<DailyCareEditField, 'setsCompleted'>;

const REQUIRED_DAILY_LOG_FIELDS: RequiredDailyLogField[] = [
  'exerciseRepetitions',
  'romDegrees',
  'walkingMinutes',
  'painScore',
  'fatigue',
];

export interface CarePlanTherapySectionProps {
  patientId: string;
  patientName: string;
  dailyEntry: DailyCareEntry | null;
  rehabExerciseAssignments: RehabExerciseAssignment[];
  uc3ResultDisplay: Uc3ResultDisplay;
  /** @deprecated Prefer in-card explain; kept optional for callers. */
  explainUc3Result?: () => void;
  refresh: () => void;
  /** Active care plan id (for daily care rows). May be null. */
  carePlanId?: string | null;
  /** Optional stable id for caching explain answers per UC3 result. */
  uc3ResultId?: string | null;
}

const VITAL_FIELDS: RehabilitationMeasurementType[] = [
  'rehabilitation_modified_ashworth',
  'rehabilitation_seated_postural_control',
  'rehabilitation_feeding_tolerance',
  'rehabilitation_communication_function',
  'rehabilitation_joint_contracture_rom',
];

/**
 * Option chips aligned to UC3 plan defaults for post-stroke rehab:
 * reps baseline~8 target~18, ROM baseline~30 target~65–90°, walk baseline~3–5
 * target~12+, pain/fatigue 0–10 clinical scales (concern ~4–5).
 */
const FIELD_OPTIONS: Record<DailyCareEditField, Array<{ value: number; label: string }>> = {
  setsCompleted: [],
  exerciseRepetitions: [
    { value: 0, label: '0' },
    { value: 5, label: '5' },
    { value: 8, label: '8' },
    { value: 10, label: '10' },
    { value: 15, label: '15' },
    { value: 20, label: '20' },
    { value: 25, label: '25' },
  ],
  romDegrees: [
    { value: 0, label: '0\u00b0' },
    { value: 15, label: '15\u00b0' },
    { value: 30, label: '30\u00b0' },
    { value: 45, label: '45\u00b0' },
    { value: 60, label: '60\u00b0' },
    { value: 75, label: '75\u00b0' },
    { value: 90, label: '90\u00b0' },
  ],
  walkingMinutes: [
    { value: 0, label: '0 min' },
    { value: 3, label: '3 min' },
    { value: 5, label: '5 min' },
    { value: 10, label: '10 min' },
    { value: 15, label: '15 min' },
    { value: 20, label: '20 min' },
    { value: 30, label: '30 min' },
    { value: 45, label: '45 min' },
  ],
  painScore: [
    { value: 0, label: '0 \u2014 none' },
    { value: 2, label: '2 \u2014 mild' },
    { value: 4, label: '4 \u2014 moderate' },
    { value: 5, label: '5 \u2014 moderate+' },
    { value: 6, label: '6 \u2014 strong' },
    { value: 8, label: '8 \u2014 severe' },
    { value: 10, label: '10 \u2014 worst' },
  ],
  fatigue: [
    { value: 0, label: '0 \u2014 none' },
    { value: 2, label: '2 \u2014 mild' },
    { value: 4, label: '4 \u2014 moderate' },
    { value: 5, label: '5 \u2014 moderate+' },
    { value: 6, label: '6 \u2014 strong' },
    { value: 8, label: '8 \u2014 severe' },
    { value: 10, label: '10 \u2014 exhausted' },
  ],
};

function fieldTitle(field: DailyCareEditField, t: TranslateFn): string {
  switch (field) {
    case 'setsCompleted':
      return t('care.therapy.dailySets');
    case 'exerciseRepetitions':
      return t('care.therapy.repetitions');
    case 'romDegrees':
      return t('care.therapy.rom');
    case 'walkingMinutes':
      return t('care.therapy.walking');
    case 'painScore':
      return t('care.therapy.pain');
    case 'fatigue':
      return t('care.therapy.fatigue');
  }
}

function fieldHint(field: DailyCareEditField, t: TranslateFn): string {
  switch (field) {
    case 'setsCompleted':
      return t('care.therapy.fieldHint.setsCompleted');
    case 'exerciseRepetitions':
      return t('care.therapy.fieldHint.exerciseRepetitions');
    case 'romDegrees':
      return t('care.therapy.fieldHint.romDegrees');
    case 'walkingMinutes':
      return t('care.therapy.fieldHint.walkingMinutes');
    case 'painScore':
      return t('care.therapy.fieldHint.painScore');
    case 'fatigue':
      return t('care.therapy.fieldHint.fatigue');
  }
}

function fieldOptionLabel(
  field: DailyCareEditField,
  option: { value: number; label: string },
  t: TranslateFn,
): string {
  if (field !== 'painScore' && field !== 'fatigue') return option.label;
  switch (option.value) {
    case 0:
      return t('care.therapy.option.none', { value: option.value });
    case 2:
      return t('care.therapy.option.mild', { value: option.value });
    case 4:
      return t('care.therapy.option.moderate', { value: option.value });
    case 5:
      return t('care.therapy.option.moderatePlus', { value: option.value });
    case 6:
      return t('care.therapy.option.strong', { value: option.value });
    case 8:
      return t('care.therapy.option.severe', { value: option.value });
    case 10:
      return field === 'fatigue'
        ? t('care.therapy.option.exhausted', { value: option.value })
        : t('care.therapy.option.worst', { value: option.value });
    default:
      return option.label;
  }
}

function skippedReasonLabel(value: string, fallback: string, t: TranslateFn): string {
  switch (value) {
    case 'fever':
      return t('care.therapy.skippedReason.fever');
    case 'vomiting':
      return t('care.therapy.skippedReason.vomiting');
    case 'chest pain':
      return t('care.therapy.skippedReason.chestPain');
    case 'shortness of breath':
      return t('care.therapy.skippedReason.shortnessOfBreath');
    case 'severe pain':
      return t('care.therapy.skippedReason.severePain');
    case 'fall':
      return t('care.therapy.skippedReason.fall');
    case 'injury':
      return t('care.therapy.skippedReason.injury');
    case 'clinician told us to stop':
      return t('care.therapy.skippedReason.clinicianStop');
    case 'doctor told us to stop':
      return t('care.therapy.skippedReason.doctorStop');
    case 'nurse told us to stop':
      return t('care.therapy.skippedReason.nurseStop');
    case 'urgent':
      return t('care.therapy.skippedReason.urgent');
    case 'emergency':
      return t('care.therapy.skippedReason.emergency');
    default:
      return fallback;
  }
}

function urgentSymptomLabel(value: DailyCareUrgentSymptomCode, fallback: string, t: TranslateFn): string {
  switch (value) {
    case 'new_weakness':
      return t('care.therapy.urgentSymptom.newWeakness');
    case 'chest_pain':
      return t('care.therapy.urgentSymptom.chestPain');
    case 'shortness_of_breath':
      return t('care.therapy.urgentSymptom.shortnessOfBreath');
    case 'severe_sudden_pain':
      return t('care.therapy.urgentSymptom.severeSuddenPain');
    case 'severe_pain':
      return t('care.therapy.urgentSymptom.severePain');
    case 'fall_with_injury':
      return t('care.therapy.urgentSymptom.fallWithInjury');
    case 'confusion':
      return t('care.therapy.urgentSymptom.confusion');
    case 'loss_of_consciousness':
      return t('care.therapy.urgentSymptom.lossOfConsciousness');
    default:
      return fallback;
  }
}

export function CarePlanTherapySection(props: CarePlanTherapySectionProps) {
  const {
    patientId,
    patientName,
    dailyEntry,
    rehabExerciseAssignments,
    uc3ResultDisplay,
    refresh,
    carePlanId,
    uc3ResultId,
  } = props;

  const { mutatePatientRecord, snapshot } = usePatientRecord();
  const theme = useTheme();
  const { t } = useTranslation();
  const sectionStyles = useMemo(() => createThemedSectionStyles(theme), [theme]);
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  const [uc3CompletionRunning, setUc3CompletionRunning] = useState(false);
  const [uc3CompletionStatus, setUc3CompletionStatus] = useState<string | null>(null);
  const [therapyCompletionConfirmVisible, setTherapyCompletionConfirmVisible] = useState(false);
  const [skippedReasonExpanded, setSkippedReasonExpanded] = useState(false);
  const [assignedExercisesExpanded, setAssignedExercisesExpanded] = useState(false);
  const [urgentSymptomsExpanded, setUrgentSymptomsExpanded] = useState(false);
  const [therapyExpanded, setTherapyExpanded] = useState(false);
  const [uc3ExplainOpen, setUc3ExplainOpen] = useState(false);
  const [editingField, setEditingField] = useState<DailyCareEditField | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');
  const [editError, setEditError] = useState<string>('');

  const activeAssignedExercises = useMemo(
    () => getAssignedDevelopmentRehabExercises(rehabExerciseAssignments),
    [rehabExerciseAssignments],
  );
  const activeAssignmentKeySet = useMemo(
    () => new Set(activeAssignedExercises.map((e) => e.key)),
    [activeAssignedExercises],
  );
  const completedAssignedExerciseKeySet = useMemo(
    () =>
      new Set(
        filterCompletedExerciseKeysForAssignments(
          dailyEntry?.completedExerciseKeys,
          rehabExerciseAssignments,
        ),
      ),
    [dailyEntry?.completedExerciseKeys, rehabExerciseAssignments],
  );
  const activeAssignmentListKey = useMemo(
    () => activeAssignedExercises.map((exercise) => exercise.key).join('|'),
    [activeAssignedExercises],
  );
  const therapySessionDate = dailyEntry?.entryDate ?? new Date().toISOString().slice(0, 10);
  const dailyLogCompletedCount = countCompletedDailyLogFields(dailyEntry);
  const completedAssignedExerciseCount = completedAssignedExerciseKeySet.size;
  const assignedExerciseTotalCount = activeAssignedExercises.length;
  const assignedExerciseValueLabel =
    assignedExerciseTotalCount > 0
      ? t('care.therapy.assignedExercisesValue', {
          completed: completedAssignedExerciseCount,
          total: assignedExerciseTotalCount,
        })
      : t('care.therapy.noExercisesAssigned');
  const assignedExerciseAccessibilityLabel =
    assignedExerciseTotalCount > 0
      ? t('care.therapy.assignedExercisesA11y', {
          completed: completedAssignedExerciseCount,
          total: assignedExerciseTotalCount,
          exerciseLabel:
            assignedExerciseTotalCount === 1
              ? t('care.therapy.exercise.one')
              : t('care.therapy.exercise.many'),
        })
      : t('care.therapy.noExercisesAssigned');
  const selectedUrgentSymptomCodes: DailyCareUrgentSymptomCode[] = useMemo(
    () =>
      DAILY_CARE_URGENT_SYMPTOM_OPTIONS
        .map((option) => option.value)
        .filter((code) => dailyEntry?.symptoms?.includes(code)),
    [dailyEntry?.symptoms],
  );
  const selectedUrgentSymptomKeySet = useMemo(
    () => new Set(selectedUrgentSymptomCodes),
    [selectedUrgentSymptomCodes],
  );

  const cpProgressMeasurements = useMemo(
    () => VITAL_FIELDS.flatMap((t) => getRehabilitationMeasurements(patientId, t)),
    [patientId],
  );

  const skippedReasonSummary =
    dailyEntry?.skippedReason
      ? skippedReasonLabel(dailyEntry.skippedReason, dailyEntry.skippedReason, t)
      : dailyEntry?.therapyCompleted
        ? t('care.therapy.completed')
        : t('care.therapy.noReasonRecorded');
  const assignedExercisesSummary = t('care.therapy.activeExercises', {
    count: activeAssignedExercises.length,
  });
  const urgentSymptomsSummary = selectedUrgentSymptomCodes.length
    ? t('care.therapy.flagged', { count: selectedUrgentSymptomCodes.length })
    : t('care.therapy.noneReportedToday');

  useEffect(() => {
    // Reset the field-edit modal when the active patient changes so a stale
    // edit doesn't carry over to a different patient. The setState calls
    // are intentional — this effect runs only when patientId changes, so
    // there is no cascading-render risk in practice.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingField(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditDraft('');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditError('');
  }, [patientId]);

  useEffect(() => {
    // Defer so the state update does not run synchronously within the effect
    // (react-hooks/set-state-in-effect).
    const handle = setTimeout(() => setTherapyExpanded(false), 0);
    return () => clearTimeout(handle);
  }, [patientId, therapySessionDate, activeAssignmentListKey]);

  // State-first daily-care patch: read the latest active-patient entry from
  // the store (not the `dailyEntry` prop, which can be stale during rapid
  // consecutive edits), apply the patch, persist only the affected row, and
  // roll back on failure. A full snapshot refresh is not required per field.
  const saveDailyCarePatch = useCallback(
    (patch: Partial<DailyCareEntry>): void => {
      if (!patientId) return;
      let nextEntry: DailyCareEntry | null = null;
      void mutatePatientRecord(
        (latestSnapshot: PatientRecordSnapshot) => {
          if (latestSnapshot.patient?.patientId !== patientId) {
            throw new Error(`Cannot save daily care for inactive patient: ${patientId}`);
          }
          const existing = latestSnapshot.todayDailyCareEntry;
          const assignedExerciseKeys = activeAssignedExercises.map((e) => e.key);
          const now = new Date().toISOString();
          nextEntry = {
            ...(existing ?? {
              entryId: `dce-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
              patientId,
              entryDate: now.slice(0, 10),
              therapyCompleted: false,
              setsCompleted: 0,
              recommendedSets: 0,
              caregiverConcern: false,
              createdAt: now,
            }),
            ...patch,
            patientId,
            carePlanId: existing?.carePlanId ?? carePlanId ?? null,
            assignedExerciseKeys,
            updatedAt: now,
          };
          const history = latestSnapshot.rehabDailyEntries ?? [];
          const has = history.some((e) => e.entryDate === nextEntry!.entryDate);
          const rehabDailyEntries = (has
            ? history.map((e) => (e.entryDate === nextEntry!.entryDate ? nextEntry! : e))
            : [...history, nextEntry!]
          ).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
          return {
            ...latestSnapshot,
            todayDailyCareEntry: nextEntry,
            rehabDailyEntries,
          };
        },
        () => {
          if (nextEntry) Object.assign(nextEntry, upsertDailyCareEntry(nextEntry));
        },
      ).catch((error) => {
        console.error('[CarePlanTherapySection] daily care update failed:', error);
        setUc3CompletionStatus(t('care.therapy.saveFailed'));
      });
    },
    [activeAssignedExercises, carePlanId, mutatePatientRecord, patientId, t],
  );

  const confirmTherapyCompleted = useCallback(async () => {
    if (uc3CompletionRunning) return;
    setTherapyCompletionConfirmVisible(false);
    setUc3CompletionRunning(true);
    setUc3CompletionStatus(t('care.therapy.progressUpdating'));
    try {
      saveDailyCarePatch({ therapyCompleted: true, skippedReason: null });
      const refreshedSnapshot = getCurrentPatientSnapshot();
      if (!refreshedSnapshot?.patient) {
        setUc3CompletionStatus(t('care.therapy.progressNotReady'));
        return;
      }
      const now = new Date();
      const uc3Result = await evaluateAndPersistUc3Trajectory(refreshedSnapshot, {
        evaluationKey: `therapy_completed:${refreshedSnapshot.todayDailyCareEntry?.entryDate ?? now.toISOString().slice(0, 10)}:${now.toISOString()}`,
        now,
      });
      const uc3Message =
        uc3Result.status === "success"
          ? uc3Result.persistedResult.eventType === "INSUFFICIENT_DATA"
            ? t('care.therapy.savedNeedsMoreData')
            : uc3Result.persistedResult.emergencyThresholdBreach || uc3Result.persistedResult.severity === "urgent"
              ? t('care.therapy.savedUrgent')
              : uc3Result.persistedResult.requiresHumanReview
                ? t('care.therapy.savedProviderReview')
                : t('care.therapy.savedUpdated')
          : uc3Result.status === "not_ready"
            ? t('care.therapy.savedNotReady')
            : t('care.therapy.savedUpdateFailed');
      setUc3CompletionStatus(uc3Message);
      if (uc3Result.status !== "success") {
        refresh();
        return;
      }
      refresh();
      const uc4Snapshot = getCurrentPatientSnapshot();
      if (!uc4Snapshot?.patient) {
        setUc3CompletionStatus(`${uc3Message} ${t('care.therapy.focusNotReady')}`);
        return;
      }
      try {
        const uc4Result = await evaluateAndPersistUc4Priorities(uc4Snapshot);
        const uc4Message =
          uc4Result.status === "success"
            ? uc4Result.runStatus === "completed"
              ? uc4Result.cards.length > 0
                ? t('care.therapy.focusChecklistUpdated')
                : t('care.therapy.focusNoNewCards')
              : uc4Result.runStatus === "paused"
                ? uc4Result.pauseReason
                  ? t('care.therapy.focusPausedWithReason', { reason: uc4Result.pauseReason })
                  : t('care.therapy.focusPaused')
                : t('care.therapy.focusNoNewCards')
            : uc4Result.status === "not_ready"
              ? t('care.therapy.focusNotReady')
              : t('care.therapy.focusUpdateFailed');
        setUc3CompletionStatus(`${uc3Message} ${uc4Message}`);
        if (uc4Result.status === "success") {
          refresh();
        }
      } catch (err) {
        console.error("[CarePlanTherapySection] UC4 update failed:", err);
        setUc3CompletionStatus(`${uc3Message} ${t('care.therapy.focusUpdateFailed')}`);
      }
    } catch (err) {
      console.error("[CarePlanTherapySection] UC3 update failed:", err);
      setUc3CompletionStatus(t('care.therapy.savedUpdateFailed'));
    } finally {
      setUc3CompletionRunning(false);
    }
  }, [uc3CompletionRunning, saveDailyCarePatch, refresh, t]);

  const handleTherapyCompletionPress = useCallback(() => {
    if (uc3CompletionRunning) return;
    const therapyCompleted = !dailyEntry?.therapyCompleted;
    if (!therapyCompleted) {
      setUc3CompletionStatus(null);
      setSkippedReasonExpanded(true);
      saveDailyCarePatch({
        therapyCompleted,
        skippedReason: dailyEntry?.skippedReason ?? null,
      });
      return;
    }
    setUc3CompletionStatus(null);
    setTherapyCompletionConfirmVisible(true);
  }, [uc3CompletionRunning, dailyEntry, saveDailyCarePatch]);

  const toggleCompletedAssignedExercise = useCallback(
    (exerciseKey: RehabExerciseKey) => {
      if (!activeAssignmentKeySet.has(exerciseKey)) return;
      let nextEntry: DailyCareEntry | null = null;
      void mutatePatientRecord(
        (latestSnapshot: PatientRecordSnapshot) => {
          if (latestSnapshot.patient?.patientId !== patientId) {
            throw new Error(`Cannot save daily care for inactive patient: ${patientId}`);
          }
          const existingEntry = latestSnapshot.todayDailyCareEntry;
          const assignedExerciseKeys = activeAssignedExercises.map((e) => e.key);
          const completedExerciseKeys = new Set(
            filterCompletedExerciseKeysForAssignments(
              existingEntry?.completedExerciseKeys,
              latestSnapshot.rehabExerciseAssignments,
            ),
          );
          if (completedExerciseKeys.has(exerciseKey)) {
            completedExerciseKeys.delete(exerciseKey);
          } else {
            completedExerciseKeys.add(exerciseKey);
          }
          const now = new Date().toISOString();
          nextEntry = {
            ...(existingEntry ?? {
              entryId: `dce-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
              patientId,
              entryDate: now.slice(0, 10),
              therapyCompleted: false,
              setsCompleted: 0,
              recommendedSets: 0,
              caregiverConcern: false,
              createdAt: now,
            }),
            patientId,
            carePlanId: existingEntry?.carePlanId ?? null,
            assignedExerciseKeys,
            completedExerciseKeys: Array.from(completedExerciseKeys),
            updatedAt: now,
          };
          return {
            ...latestSnapshot,
            todayDailyCareEntry: nextEntry,
            rehabDailyEntries: (() => {
              const has = latestSnapshot.rehabDailyEntries.some((e) => e.entryDate === nextEntry!.entryDate);
              return (has
                ? latestSnapshot.rehabDailyEntries.map((e) =>
                    e.entryDate === nextEntry!.entryDate ? nextEntry! : e,
                  )
                : [...latestSnapshot.rehabDailyEntries, nextEntry!]
              ).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
            })(),
          };
        },
        () => {
          if (nextEntry) Object.assign(nextEntry, upsertDailyCareEntry(nextEntry));
        },
      ).catch((error) => {
        console.error("[CarePlanTherapySection] daily care update failed:", error);
        setUc3CompletionStatus(t('care.therapy.saveFailed'));
      });
    },
    [activeAssignmentKeySet, activeAssignedExercises, mutatePatientRecord, patientId, t],
  );

  const toggleSkippedReason = useCallback(
    (reason: string) => {
      saveDailyCarePatch({
        therapyCompleted: false,
        skippedReason: dailyEntry?.skippedReason === reason ? null : reason,
      });
    },
    [dailyEntry?.skippedReason, saveDailyCarePatch],
  );

  const toggleUrgentSymptom = useCallback(
    (code: DailyCareUrgentSymptomCode) => {
      const nextSelected = new Set(selectedUrgentSymptomCodes);
      if (nextSelected.has(code)) nextSelected.delete(code);
      else nextSelected.add(code);
      saveDailyCarePatch({
        symptoms: mergeDailyCareUrgentSymptoms(
          dailyEntry?.symptoms ?? [],
          Array.from(nextSelected),
        ),
      });
    },
    [selectedUrgentSymptomCodes, dailyEntry?.symptoms, saveDailyCarePatch],
  );

  const openFieldEdit = useCallback(
    (field: DailyCareEditField) => {
      setEditingField(field);
      setEditError('');
      const current = dailyEntry?.[field];
      setEditDraft(Number.isFinite(current) ? String(current) : '');
    },
    [dailyEntry],
  );

  const selectFieldOption = useCallback(
    (field: DailyCareEditField, value: number) => {
      saveDailyCarePatch({ [field]: value } as Partial<DailyCareEntry>);
      setEditingField(null);
      setEditDraft('');
      setEditError('');
    },
    [saveDailyCarePatch],
  );

  if (!therapyExpanded) {
    return (
      <View style={sectionStyles.card}>
        <Text style={sectionStyles.title}>{t('care.therapy.title')}</Text>
        <View style={styles.compactStatsRow}>
          <View
            style={[styles.dailyFactBox, themedStyles.controlCard]}
            accessible
            accessibilityLabel={t('care.therapy.dailyLogsA11y', {
              completed: dailyLogCompletedCount,
              total: REQUIRED_DAILY_LOG_FIELDS.length,
            })}
          >
            <Text style={[styles.dailyFactLabel, themedStyles.mutedText]}>{t('care.therapy.dailyLogs')}</Text>
            <Text style={[styles.dailyFactValue, themedStyles.primaryText]}>
              {dailyLogCompletedCount} / {REQUIRED_DAILY_LOG_FIELDS.length}
            </Text>
          </View>
          <View
            style={[styles.dailyFactBox, themedStyles.controlCard]}
            accessible
            accessibilityLabel={assignedExerciseAccessibilityLabel}
          >
            <Text style={[styles.dailyFactLabel, themedStyles.mutedText]}>{t('care.therapy.assignedExercises')}</Text>
            <Text style={[styles.dailyFactValue, themedStyles.primaryText]}>{assignedExerciseValueLabel}</Text>
          </View>
        </View>
        <Pressable
          style={styles.continueButton}
          onPress={() => setTherapyExpanded(true)}
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
          accessibilityLabel={t('care.therapy.continueA11y')}
        >
          <Text style={styles.continueButtonText}>{t('care.therapy.continue')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel={t('care.therapy.title')}>
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>{t('care.therapy.title')}</Text>
        <View style={styles.expandedHeaderActions}>
          <Pressable
            onPress={() => setTherapyExpanded(false)}
            accessibilityRole="button"
            accessibilityState={{ expanded: true }}
            accessibilityLabel={t('care.therapy.showLessA11y')}
          >
            <Text style={[styles.showLessText, themedStyles.mutedText]}>{t('care.therapy.showLess')}</Text>
          </Pressable>
          <View style={sectionStyles.pill}>
            <Text style={sectionStyles.pillText}>{activeAssignedExercises.length}</Text>
          </View>
        </View>
      </View>
      <Text style={sectionStyles.subtitle}>
        {t('care.therapy.subtitle')}
      </Text>

      <View style={styles.completionRow}>
        <Pressable
          style={[styles.completionRowInner, uc3CompletionRunning && styles.completionRowDisabled]}
          onPress={handleTherapyCompletionPress}
          disabled={uc3CompletionRunning}
          accessibilityRole="checkbox"
          accessibilityState={{
            checked: Boolean(dailyEntry?.therapyCompleted),
            disabled: uc3CompletionRunning,
          }}
          accessibilityLabel={t('care.therapy.completedToday')}
        >
          <View
            style={[
              styles.completionCheckbox,
              themedStyles.actionBorder,
              dailyEntry?.therapyCompleted && styles.completionCheckboxChecked,
            ]}
          >
            {dailyEntry?.therapyCompleted ? (
              <Text style={styles.completionCheckmark}>{'\u2713'}</Text>
            ) : null}
          </View>
          <View style={styles.completionTextBlock}>
            <Text style={[styles.completionTitle, themedStyles.primaryText]}>{t('care.therapy.completedToday')}</Text>
            <Text style={[styles.completionSubtitle, themedStyles.supportingText]}>
              {t('care.therapy.markComplete')}
            </Text>
          </View>
        </Pressable>
      </View>

      {uc3CompletionStatus ? (
        <Text style={[styles.uc3CompletionStatus, themedStyles.supportingText]}>{uc3CompletionStatus}</Text>
      ) : null}

      {!dailyEntry?.therapyCompleted ? (
        <View style={[styles.accordionCard, themedStyles.dividerBorder]}>
          <Pressable
            style={styles.accordionHeader}
            onPress={() => setSkippedReasonExpanded((expanded) => !expanded)}
            accessibilityRole="button"
            accessibilityState={{ expanded: skippedReasonExpanded }}
            accessibilityLabel={t('care.therapy.whyNotCompletedA11y', {
              summary: skippedReasonSummary,
            })}
          >
            <View style={styles.accordionHeaderText}>
              <Text style={[styles.accordionTitle, themedStyles.primaryText]}>{t('care.therapy.whyNotCompleted')}</Text>
              <Text style={[styles.accordionSummary, themedStyles.mutedText]}>{skippedReasonSummary}</Text>
            </View>
            <Text style={[styles.accordionChevron, themedStyles.mutedText]}>{skippedReasonExpanded ? 'v' : '>'}</Text>
          </Pressable>
          {skippedReasonExpanded ? (
            <View style={styles.accordionBody}>
              <View style={styles.optionGrid}>
                {DAILY_CARE_SKIPPED_REASON_OPTIONS.map((option) => {
                  const selected = dailyEntry?.skippedReason === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.option, themedStyles.controlCard, selected && styles.optionSelected, selected && themedStyles.selectedOption]}
                      onPress={() => toggleSkippedReason(option.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.optionText, themedStyles.primaryText, selected && styles.optionTextSelected, selected && themedStyles.actionText]}>
                        {skippedReasonLabel(option.value, option.label, t)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.accordionCard, themedStyles.dividerBorder]}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setAssignedExercisesExpanded((expanded) => !expanded)}
          accessibilityRole="button"
          accessibilityState={{ expanded: assignedExercisesExpanded }}
          accessibilityLabel={`${t('care.therapy.assignedExercises')}. ${assignedExercisesSummary}`}
        >
          <View style={styles.accordionHeaderText}>
            <Text style={[styles.accordionTitle, themedStyles.primaryText]}>{t('care.therapy.assignedExercises')}</Text>
            <Text style={[styles.accordionSummary, themedStyles.mutedText]}>{assignedExercisesSummary}</Text>
          </View>
          <Text style={[styles.accordionChevron, themedStyles.mutedText]}>{assignedExercisesExpanded ? 'v' : '>'}</Text>
        </Pressable>
        {assignedExercisesExpanded ? (
          <View style={styles.accordionBody}>
            {activeAssignedExercises.length > 0 ? (
              <View style={styles.exerciseChecklist}>
                {activeAssignedExercises.map((exercise) => (
                  <ExerciseChecklistRow
                    key={exercise.key}
                    label={exercise.label}
                    checked={completedAssignedExerciseKeySet.has(exercise.key)}
                    onPress={() => toggleCompletedAssignedExercise(exercise.key)}
                  />
                ))}
              </View>
            ) : (
              <Text style={[styles.assignedExerciseEmpty, themedStyles.mutedText]}>{t('care.therapy.noExercisesAssignedSentence')}</Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={[styles.setsRow, themedStyles.dividerBorder]}>
        <View>
          <Text style={[styles.setsLabel, themedStyles.mutedText]}>{t('care.therapy.dailySets')}</Text>
          <Text style={[styles.setsValue, themedStyles.primaryText]}>{formatSets(dailyEntry)}</Text>
        </View>
        {dailyEntry && dailyEntry.recommendedSets > 0 ? (
          <View style={[styles.setsProgressTrack, themedStyles.controlSurface]}>
            <View
              style={[
                styles.setsProgressFill,
                {
                  width: `${Math.min(
                    100,
                    (dailyEntry.setsCompleted / Math.max(dailyEntry.recommendedSets, 1)) * 100,
                  )}%`,
                },
              ]}
            />
          </View>
        ) : null}
      </View>

      <View style={styles.rehabMetricGrid}>
        <EditableDailyFactBox label={t('care.therapy.repetitions')} value={dailyEntry?.exerciseRepetitions} unit="reps" onPress={() => openFieldEdit('exerciseRepetitions')} />
        <EditableDailyFactBox label={t('care.therapy.rom')} value={dailyEntry?.romDegrees} unit={'\u00b0'} onPress={() => openFieldEdit('romDegrees')} />
        <EditableDailyFactBox label={t('care.therapy.walking')} value={dailyEntry?.walkingMinutes} unit="min" onPress={() => openFieldEdit('walkingMinutes')} />
      </View>

      <View style={styles.symptomRow}>
        <EditableSymptomBox label={t('care.therapy.pain')} value={dailyEntry?.painScore} onPress={() => openFieldEdit('painScore')} />
        <EditableSymptomBox label={t('care.therapy.fatigue')} value={dailyEntry?.fatigue} onPress={() => openFieldEdit('fatigue')} />
      </View>

      <View
        style={[
          styles.accordionCard,
          themedStyles.dividerBorder,
          styles.accordionCardLast,
          selectedUrgentSymptomCodes.length > 0 && styles.accordionCardAlert,
          selectedUrgentSymptomCodes.length > 0 && themedStyles.urgentCard,
        ]}
      >
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setUrgentSymptomsExpanded((expanded) => !expanded)}
          accessibilityRole="button"
          accessibilityState={{ expanded: urgentSymptomsExpanded }}
          accessibilityLabel={t('care.therapy.urgentSymptomsA11y', {
            summary: urgentSymptomsSummary,
          })}
        >
          <View style={styles.accordionHeaderText}>
            <Text style={[styles.accordionTitle, themedStyles.primaryText, selectedUrgentSymptomCodes.length > 0 && styles.accordionTitleAlert]}>
              {t('care.therapy.urgentSymptoms')}
            </Text>
            <Text style={[styles.accordionSummary, themedStyles.mutedText]}>{urgentSymptomsSummary}</Text>
          </View>
          <Text style={[styles.accordionChevron, themedStyles.mutedText]}>{urgentSymptomsExpanded ? 'v' : '>'}</Text>
        </Pressable>
        {urgentSymptomsExpanded ? (
          <View style={styles.accordionBody}>
            <View style={styles.exerciseChecklist}>
              {DAILY_CARE_URGENT_SYMPTOM_OPTIONS.map((option) => (
                <ExerciseChecklistRow
                  key={option.value}
                  label={urgentSymptomLabel(option.value, option.label, t)}
                  checked={selectedUrgentSymptomKeySet.has(option.value)}
                  onPress={() => toggleUrgentSymptom(option.value)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>

      <Uc3ResultCard
        display={uc3ResultDisplay}
        explainOpen={uc3ExplainOpen}
        onExplain={() => {
          setTherapyExpanded(true);
          setUc3ExplainOpen(true);
        }}
      />

      <InCardMiniChat
        visible={uc3ExplainOpen}
        embedded
        title={t('care.therapy.explainProgress')}
        contextProfile="uc3_therapy"
        seedPrompt={buildUc3ResultExplainPrompt(uc3ResultDisplay, {
          therapySeedSupplement: buildUc3TherapySeedSupplement(
            getCurrentPatientSnapshot() ?? snapshot,
          ),
        })}
        cacheTitle={`rehab-progress:${uc3ResultId ?? therapySessionDate}:${uc3ResultDisplay.statusLabel}:${uc3ResultDisplay.dataQualityLabel ?? ''}:${uc3ResultDisplay.detailLines.join('|')}:${(snapshot?.rehabExerciseAssignments ?? []).map((a) => a.exerciseKey).join(',')}:${(snapshot?.medications ?? []).filter((m) => m.active !== false).map((m) => m.name).join(',')}:reps=${dailyEntry?.exerciseRepetitions ?? ''}:rom=${dailyEntry?.romDegrees ?? ''}:walk=${dailyEntry?.walkingMinutes ?? ''}:pain=${dailyEntry?.painScore ?? ''}:fat=${dailyEntry?.fatigue ?? ''}:done=${dailyEntry?.therapyCompleted ? 1 : 0}`}
        onClose={() => setUc3ExplainOpen(false)}
        enableObservationHitl
      />

      {/* Care-focus cards live in CarePlanFocusSection (all personas), not here. */}

      {cpProgressMeasurements.length > 0 ? (
        <ProgressMetric
          label={t('care.therapy.progressMostRecent')}
          measurements={cpProgressMeasurements}
          target={1}
          maxVal={1}
          unit=""
        />
      ) : null}

      <View style={[styles.consentRow, themedStyles.dividerBorder]}>
        <View style={[styles.consentDot, themedStyles.actionBackground]} />
        <Text style={[styles.consentText, themedStyles.supportingText]}>{t('care.therapy.sharingEnabled')}</Text>
      </View>

      <Modal
        visible={therapyCompletionConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!uc3CompletionRunning) setTherapyCompletionConfirmVisible(false);
        }}
      >
        <Pressable
          style={styles.confirmOverlay}
          onPress={() => {
            if (!uc3CompletionRunning) setTherapyCompletionConfirmVisible(false);
          }}
        >
          <Pressable style={[styles.confirmSheet, themedStyles.card]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.confirmTitle, themedStyles.primaryText]}>{t('care.therapy.confirmTitle')}</Text>
            <Text style={[styles.confirmMessage, themedStyles.supportingText]}>{t('care.therapy.confirmMessage')}</Text>
            <View style={styles.confirmActions}>
              <Pressable
                style={[styles.confirmButton, styles.confirmCancelButton, themedStyles.controlCard]}
                onPress={() => setTherapyCompletionConfirmVisible(false)}
                disabled={uc3CompletionRunning}
              >
                <Text style={[styles.confirmCancelText, themedStyles.primaryText]}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, styles.confirmPrimaryButton]}
                onPress={() => { void confirmTherapyCompleted(); }}
                disabled={uc3CompletionRunning}
              >
                <Text style={styles.confirmPrimaryText}>{t('common.confirm')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={editingField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setEditingField(null);
          setEditDraft('');
          setEditError('');
        }}
      >
        <Pressable
          style={styles.editOverlay}
          onPress={() => {
            setEditingField(null);
            setEditDraft('');
            setEditError('');
          }}
        >
          <Pressable style={[styles.editSheet, themedStyles.card]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.editTitle, themedStyles.primaryText]}>
              {editingField
                ? t('care.therapy.selectField', { field: fieldTitle(editingField, t) })
                : t('care.therapy.selectEntry')}
            </Text>
            {editingField ? (
              <Text style={[styles.editHint, themedStyles.supportingText]}>
                {fieldHint(editingField, t).replace('{patientName}', patientName)}
              </Text>
            ) : null}
            <View style={styles.optionGrid}>
              {(editingField ? FIELD_OPTIONS[editingField] : []).map((option) => {
                const field = editingField;
                if (!field) return null;
                const selected = editDraft === String(option.value);
                return (
                  <Pressable
                    key={`${field}-${option.value}`}
                    style={[styles.option, themedStyles.controlCard, selected && styles.optionSelected, selected && themedStyles.selectedOption]}
                    onPress={() => selectFieldOption(field, option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    >
                      <Text style={[styles.optionText, themedStyles.primaryText, selected && styles.optionTextSelected, selected && themedStyles.actionText]}>
                      {fieldOptionLabel(field, option, t)}
                      </Text>
                    </Pressable>
                );
              })}
            </View>
            {editError ? <Text style={styles.editError}>{editError}</Text> : null}
            <View style={styles.editActions}>
              <Pressable
                style={[styles.editButton, styles.editCancel, themedStyles.controlCard]}
                onPress={() => {
                  setEditingField(null);
                  setEditDraft('');
                  setEditError('');
                }}
              >
                <Text style={[styles.editCancelText, themedStyles.primaryText]}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ExerciseChecklistRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <Pressable
      style={[styles.exerciseChecklistRow, checked && styles.exerciseChecklistRowChecked]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.exerciseChecklistBox, themedStyles.actionBorder, checked && styles.exerciseChecklistBoxChecked]}>
        {checked ? <Text style={styles.exerciseChecklistCheck}>{'\u2713'}</Text> : null}
      </View>
      <Text style={[styles.exerciseChecklistLabel, themedStyles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

function EditableDailyFactBox({
  label,
  value,
  unit,
  onPress,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <Pressable
      style={[styles.dailyFactBox, themedStyles.controlCard]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('care.therapy.editA11y', { label })}
    >
      <Text style={[styles.dailyFactLabel, themedStyles.mutedText]}>{label}</Text>
      <Text style={[styles.dailyFactValue, themedStyles.primaryText]}>
        {value == null ? '\u2014' : `${value} ${unit}`.trim()}
      </Text>
    </Pressable>
  );
}

function EditableSymptomBox({
  label,
  value,
  onPress,
}: {
  label: string;
  value: number | null | undefined;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);

  return (
    <Pressable
      style={[styles.symptomBox, themedStyles.controlCard]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('care.therapy.editA11y', { label })}
    >
      <Text style={[styles.symptomLabel, themedStyles.mutedText]}>{label}</Text>
      <Text style={[styles.symptomValue, themedStyles.primaryText]}>{value == null ? '\u2014' : `${value}/10`}</Text>
    </Pressable>
  );
}

function Uc3ResultCard({
  display,
  onExplain,
  explainOpen,
}: {
  display: Uc3ResultDisplay;
  onExplain?: () => void;
  explainOpen?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const toneStyle =
    display.tone === 'urgent'
      ? themedStyles.urgentCard
      : display.tone === 'review'
        ? themedStyles.reviewCard
        : null;
  return (
    <View style={[styles.uc3ResultCard, themedStyles.controlCard, toneStyle]}>
      <View style={styles.uc3ResultHeader}>
        <Text style={[styles.uc3ResultKicker, themedStyles.primaryText]}>{t('care.therapy.progress')}</Text>
        {display.reviewLabel ? (
          <Text style={[styles.uc3ResultBadge, themedStyles.badge]}>{display.reviewLabel}</Text>
        ) : null}
      </View>
      <Text style={[styles.uc3ResultStatus, themedStyles.primaryText]}>{display.statusLabel}</Text>
      {display.generatedAtLabel ? (
        <Text style={[styles.uc3ResultMeta, themedStyles.mutedText]}>{display.generatedAtLabel}</Text>
      ) : null}
      {display.explanation ? (
        <Text style={[styles.uc3ResultExplanation, themedStyles.supportingText]}>{display.explanation}</Text>
      ) : null}
      {display.detailLines.length > 0 ? (
        <View style={styles.uc3ResultDetails}>
          {display.detailLines.map((line) => (
            <Text key={line} style={[styles.uc3ResultDetailLine, themedStyles.supportingText]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {onExplain && !explainOpen ? (
        <Pressable
          style={styles.uc3ExplainButton}
          onPress={onExplain}
          accessibilityRole="button"
          accessibilityLabel={t('care.therapy.explainProgress')}
        >
          <Text style={styles.uc3ExplainButtonText}>{t('care.priorities.explain')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ProgressMetric({
  label,
  measurements,
  target,
  maxVal,
  unit,
}: {
  label: string;
  measurements: RehabilitationMeasurement[];
  target: number;
  maxVal: number;
  unit: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const latest = measurements[measurements.length - 1];
  const value = latest?.value ?? 0;
  return (
    <View style={styles.progressMetric}>
      <View style={styles.progressMetricHeader}>
        <Text style={[styles.progressMetricLabel, themedStyles.primaryText]}>{label}</Text>
        <Text style={[styles.progressMetricValue, themedStyles.supportingText]}>
          {value}
          {unit ? ` ${unit}` : ''}
        </Text>
      </View>
      <View style={[styles.progressTrack, themedStyles.controlSurface]}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.min(100, (value / Math.max(maxVal, 1)) * 100)}%` },
          ]}
        />
        {target > 0 ? (
          <View
            style={[
              styles.progressTargetMarker,
              { left: `${Math.min(100, (target / Math.max(maxVal, 1)) * 100)}%` },
            ]}
          />
        ) : null}
      </View>
      {target > 0 ? (
        <Text style={[styles.progressTargetLabel, themedStyles.mutedText]}>
          {t('care.therapy.target', { target, unit: unit ? ` ${unit}` : '' })}
        </Text>
      ) : null}
    </View>
  );
}

function formatSets(entry: DailyCareEntry | null): string {
  if (!entry) return '\u2014';
  if (entry.recommendedSets > 0) {
    return `${entry.setsCompleted}/${entry.recommendedSets}`;
  }
  return String(entry.setsCompleted);
}

function countCompletedDailyLogFields(entry: DailyCareEntry | null): number {
  if (!entry) return 0;
  return REQUIRED_DAILY_LOG_FIELDS.filter((field) => Number.isFinite(entry[field])).length;
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === '#000000';
  const actionText = isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand;

  return StyleSheet.create({
    card: { backgroundColor: theme.appSurface, borderColor: theme.appBorder },
    controlCard: { backgroundColor: theme.appControlSurface, borderColor: theme.appBorder },
    controlSurface: { backgroundColor: theme.appControlSurface },
    selectedOption: { backgroundColor: theme.appBrandSoftSurface, borderColor: actionText },
    primaryText: { color: theme.appText },
    supportingText: { color: theme.appTextSupporting },
    mutedText: { color: theme.appTextMuted },
    actionText: { color: actionText },
    actionBackground: { backgroundColor: actionText },
    actionBorder: { borderColor: actionText },
    dividerBorder: { borderColor: theme.appBorder },
    urgentCard: {
      backgroundColor: isDark ? 'rgba(240,6,22,0.16)' : AppTheme.colors.dangerLight,
      borderColor: AppTheme.colors.danger,
    },
    reviewCard: {
      backgroundColor: isDark ? 'rgba(249,115,22,0.16)' : AppTheme.colors.warningSoft,
      borderColor: AppTheme.colors.warning,
    },
    badge: { backgroundColor: theme.appSurface },
  });
}

const styles = StyleSheet.create({
  compactStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  continueButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.brand,
  },
  continueButtonText: {
    color: AppTheme.colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  expandedHeaderActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  showLessText: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '900',
  },
  completionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  completionRowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  completionRowDisabled: {
    opacity: 0.6,
  },
  completionCheckbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: AppTheme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  completionCheckboxChecked: {
    backgroundColor: AppTheme.colors.brand,
  },
  completionCheckmark: {
    color: AppTheme.colors.white,
    fontSize: 16,
    fontWeight: '900',
  },
  completionTextBlock: {
    flex: 1,
  },
  completionTitle: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  completionSubtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  uc3CompletionStatus: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 6,
  },
  accordionCard: {
    borderTopWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingTop: 10,
    marginTop: 8,
  },
  accordionCardLast: {
    borderBottomWidth: 1,
    paddingBottom: 10,
  },
  accordionCardAlert: {
    backgroundColor: AppTheme.colors.dangerLight,
    borderRadius: 12,
    borderTopWidth: 0,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  accordionHeaderText: {
    flex: 1,
  },
  accordionTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  accordionTitleAlert: {
    color: AppTheme.colors.danger,
  },
  accordionSummary: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  accordionChevron: {
    color: AppTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '900',
  },
  accordionBody: {
    paddingBottom: 8,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  optionSelected: {
    backgroundColor: AppTheme.colors.brandSoft,
    borderColor: AppTheme.colors.brand,
  },
  optionText: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  optionTextSelected: {
    color: AppTheme.colors.brand,
  },
  exerciseChecklist: {
    gap: 8,
  },
  exerciseChecklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  exerciseChecklistRowChecked: {
    opacity: 0.6,
  },
  exerciseChecklistBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: AppTheme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseChecklistBoxChecked: {
    backgroundColor: AppTheme.colors.brand,
  },
  exerciseChecklistCheck: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  exerciseChecklistLabel: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  assignedExerciseEmpty: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  setsRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  setsLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  setsValue: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 4,
  },
  setsProgressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.softSurface,
    marginTop: 8,
    overflow: 'hidden',
  },
  setsProgressFill: {
    height: '100%',
    backgroundColor: AppTheme.colors.brand,
    borderRadius: 4,
  },
  rehabMetricGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  dailyFactBox: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  dailyFactLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  dailyFactValue: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 4,
  },
  symptomRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  symptomBox: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  symptomLabel: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  symptomValue: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginTop: 4,
  },
  uc3ResultCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  uc3ResultCardUrgent: {
    backgroundColor: AppTheme.colors.dangerLight,
    borderColor: AppTheme.colors.danger,
  },
  uc3ResultCardReview: {
    backgroundColor: AppTheme.colors.warningSoft,
    borderColor: AppTheme.colors.warning,
  },
  uc3ResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  uc3ResultKicker: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  uc3ResultBadge: {
    color: AppTheme.colors.danger,
    fontSize: 11,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: AppTheme.colors.white,
  },
  uc3ResultStatus: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  uc3ResultMeta: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  uc3ResultExplanation: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  uc3ResultDetails: {
    gap: 4,
    marginTop: 6,
  },
  uc3ResultDetailLine: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  uc3ExplainButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    backgroundColor: AppTheme.colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  uc3ExplainButtonText: {
    color: AppTheme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
  uc4PriorityBlock: {
    borderTopWidth: 1,
    borderColor: AppTheme.colors.border,
    paddingTop: 14,
    marginTop: 14,
    marginBottom: 14,
    gap: 8,
  },
  urgentSymptomTitle: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: AppTheme.colors.border,
    gap: 8,
  },
  consentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AppTheme.colors.brand,
  },
  consentText: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  progressMetric: {
    marginTop: 12,
    marginBottom: 6,
  },
  progressMetricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  progressMetricLabel: {
    flex: 1,
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  progressMetricValue: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: AppTheme.colors.softSurface,
    overflow: 'hidden',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    backgroundColor: AppTheme.colors.brand,
  },
  progressTargetMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: AppTheme.colors.danger,
  },
  progressTargetLabel: {
    fontSize: 11,
    color: AppTheme.colors.textMuted,
    marginTop: 4,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmSheet: {
    width: '100%',
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 20,
    padding: 20,
  },
  confirmTitle: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  confirmMessage: {
    color: AppTheme.colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  confirmButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  confirmCancelButton: {
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  confirmPrimaryButton: {
    backgroundColor: AppTheme.colors.brand,
  },
  confirmCancelText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  confirmPrimaryText: {
    color: AppTheme.colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  editOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  editSheet: {
    width: '100%',
    backgroundColor: AppTheme.colors.surface,
    borderRadius: 20,
    padding: 20,
  },
  editTitle: {
    color: AppTheme.colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  editHint: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  editButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  editCancel: {
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  editCancelText: {
    color: AppTheme.colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  editError: {
    color: AppTheme.colors.danger,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
  },
});
