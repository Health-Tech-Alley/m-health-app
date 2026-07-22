/**
 * Care tab — reworked IA (Care tab rework).
 *
 * Sections rendered, in order:
 *   Patient strip → Care plan header (+ "What changed" modal) →
 *   Review (only when pending + writable) → Your priorities (grouped UC4 +
 *   plan priorities, care timeline, medication areas to watch) →
 *   Goals & activities (categorized, with care considerations + safety notes) →
 *   Monitoring (always) → Therapy (hard-gated) → Backup & restore.
 *
 * UC4 evaluates on tab focus (throttled) so every patient gets priorities.
 * SLM explanations run in a transient popup (load → stream → unload, no
 * fast path) instead of navigating away.
 *
 * No engineering jargon in user-facing copy: never "ADCP", "UC2/3/4", "ML",
 * "HITL". The plan-as-RAG + Concierge continue to read from the plan
 * even in read-only mode; only mutation is gated.
 *
 * State management: AGENTS.md authority preserved — no snapshot, Redux,
 * or new migration edits. All patient/EHR reads come from the snapshot
 * via the existing `usePatientRecord` hook.
 */

import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MainTabHeader } from "@/components/MainTabHeader";
import { SlmInsightSheet } from "@/components/slm-insight-sheet";
import { CarePlanHeaderCard } from "@/components/care/plan/CarePlanHeaderCard";
import { CarePlanReviewSection } from "@/components/care/plan/CarePlanReviewSection";
import { CarePrioritiesSection } from "@/components/care/plan/CarePrioritiesSection";
import { CarePlanMonitoringSection } from "@/components/care/plan/CarePlanMonitoringSection";
import { CarePlanTherapySection } from "@/components/care/plan/CarePlanTherapySection";
import {
  CarePlanGoalsSection,
  type CategoryExplainRequest,
  type GoalExplainRequest,
} from "@/components/care/plan/CarePlanGoalsSection";
import { CarePlanBackupSection } from "@/components/care/plan/CarePlanBackupSection";
import { WhatChangedSheet } from "@/components/care/plan/WhatChangedSheet";
import { AppTheme } from "@/constants/theme";
import { useCriticalAlert } from "@/contexts/critical-alert-context";
import { usePatientRecord } from "@/contexts/patient-record-context";
import {
  type DailyCareEntry,
  type Threshold,
} from "@/data";
import { useCarePlanViewModel } from "@/hooks/useCarePlanViewModel";
import { useActivePatientView } from "@/hooks/useActivePatientView";
import {
  displayClinical,
  getCaregiverDisplay,
  getCaregiverRoleDisplay,
  getPatientAgeDisplay,
  getPatientDisplayName,
  getPrimaryDiagnosisDisplay,
} from "@/utils/patientDisplay";
import {
  getUc3ResultDisplay,
  type Uc3ResultDisplay,
} from "@/services/uc3/uc3ResultPresenter";
import { submitUc4CaregiverResponse } from "@/services/uc4/uc4EvaluationService";
import { evaluateUc4OnCareFocus } from "@/services/uc4/uc4TriggerService";
import {
  buildCarePrioritiesView,
} from "@/services/carePlan/carePrioritiesService";
import {
  buildCategoryExplainPrompt,
  buildConsiderationExplainPrompt,
  buildGoalOrActivityExplainPrompt,
  buildTimelineExplainPrompt,
  buildUc4CardExplainPrompt,
  buildWatchAreaExplainPrompt,
} from "@/services/carePlan/careExplainPrompts";
import { proposeMedicationWatchArea } from "@/services/carePlan/watchAreaProposalService";
import type { MedicationWatchArea } from "@/services/carePlan/carePrioritiesService";
import {
  caregiverConfirmProposal as caregiverConfirmProposalForUi,
  caregiverRejectProposal as caregiverRejectProposalForUi,
} from "@/services/carePlan/mlPlanProposalService";
import { getActiveConsents } from "@/data";
import { ensureDefaultAdcpBackupConsent } from "@/services/consent/defaultConsents";

export default function CareScreen() {
  const { patientId, snapshot, refresh } = usePatientRecord();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { reopenOnCareFocus } = useCriticalAlert();
  const { vm } = useCarePlanViewModel();
  const activePatient = useActivePatientView();

  const patientName = getPatientDisplayName(activePatient);
  const patientAge = getPatientAgeDisplay(activePatient);
  const diagnosis = getPrimaryDiagnosisDisplay(activePatient);
  const caregiverName = getCaregiverDisplay(activePatient);
  const caregiverRole = getCaregiverRoleDisplay(activePatient);

  // Re-surface the severity-3 critical-alert popup whenever the Care tab is
  // (re)opened, until the alert is dismissed or resolved. Also run UC4 on
  // focus (throttled) so every patient gets care-focus priorities, not only
  // patients in the therapy flow.
  useFocusEffect(
    useCallback(() => {
      reopenOnCareFocus();
      const outcome = evaluateUc4OnCareFocus();
      if (outcome.kind === 'evaluated') {
        refresh();
      }
    }, [reopenOnCareFocus, refresh]),
  );

  // Daily care entry is sourced from SQLite only. Opening the screen must not
  // seed demo values for a patient that has not recorded care today.
  const entry = snapshot?.todayDailyCareEntry ?? null;
  const dailyEntry: DailyCareEntry | null = entry;

  const latestUc3Result = snapshot?.latestUc3TrajectoryResult ?? null;
  const uc3ResultDisplay: Uc3ResultDisplay = useMemo(
    () => getUc3ResultDisplay(latestUc3Result),
    [latestUc3Result],
  );
  const uc4PriorityCards = useMemo(
    () => snapshot?.latestUc4PriorityCards ?? [],
    [snapshot?.latestUc4PriorityCards],
  );
  const rehabExerciseAssignments = useMemo(
    () => snapshot?.rehabExerciseAssignments ?? [],
    [snapshot?.rehabExerciseAssignments],
  );

  const primaryPlan = snapshot?.carePlan ?? null;
  const goals = snapshot?.carePlanGoals ?? [];
  const thresholds: Threshold[] = snapshot?.thresholds ?? [];

  const pendingProposals = useMemo(
    () =>
      (snapshot?.pendingPlanProposals ?? []).filter((p) =>
        ['draft', 'awaiting_hitl', 'awaiting_ml_vet'].includes(p.status),
      ),
    [snapshot?.pendingPlanProposals],
  );

  // Unified transient Concierge explanation popup (load → stream → unload).
  const [explainRequest, setExplainRequest] = useState<{ title: string; prompt: string } | null>(
    null,
  );
  const openExplain = useCallback((title: string, prompt: string) => {
    setExplainRequest({ title, prompt });
  }, [setExplainRequest]);

  const [whatChangedVisible, setWhatChangedVisible] = useState(false);

  const handleUc4Respond = useCallback(
    (
      card: { cardId: string; templateId: string },
      action: import('@/services/uc4/uc4EvaluationService').Uc4CardResponseAction,
      payload: {
        observationCodes: string[];
        contextCodes: string[];
        caregiverRequestedProviderReview: boolean;
      },
    ) => {
      if (!patientId) return;
      submitUc4CaregiverResponse({
        patientId,
        cardId: card.cardId,
        templateId: card.templateId,
        action,
        observationCodes: payload.observationCodes,
        contextCodes: payload.contextCodes,
        caregiverRequestedProviderReview: payload.caregiverRequestedProviderReview,
      });
      refresh();
    },
    [patientId, refresh],
  );

  // Consolidated priorities view: grouped UC4 + plan priorities, timeline,
  // medication areas to watch (read-only derivation over snapshot + plan).
  const prioritiesView = useMemo(
    () => buildCarePrioritiesView(snapshot, vm.plan),
    [snapshot, vm.plan],
  );

  // Goals & activities section also renders when only care considerations
  // (onboarding concerns, safety notes) exist — even with no imported goals.
  const hasCareConsiderations = Boolean(
    snapshot?.caregiver?.mainConcern?.trim() ||
      snapshot?.caregiver?.stressOrSupportNeeds?.trim() ||
      (snapshot?.symptoms ?? []).some((symptom) => symptom.category === 'other') ||
      snapshot?.safetyNotes?.trim() ||
      vm.safetyLines.length > 0,
  );

  const explainUc4Card = useCallback(
    (cardId: string) => {
      const card = uc4PriorityCards.find((candidate) => candidate.cardId === cardId);
      if (!card) return;
      openExplain('Explain this care focus', buildUc4CardExplainPrompt(card));
    },
    [uc4PriorityCards, openExplain],
  );

  const handleExplainTimeline = useCallback(() => {
    openExplain('Explain this timeline', buildTimelineExplainPrompt(prioritiesView.timeline));
  }, [openExplain, prioritiesView.timeline]);

  const handleExplainGoalItem = useCallback(
    (request: GoalExplainRequest) => {
      openExplain(
        request.kind === 'goal' ? 'Explain this goal' : 'Explain this activity',
        buildGoalOrActivityExplainPrompt(request),
      );
    },
    [openExplain],
  );

  const handleExplainCategory = useCallback(
    (request: CategoryExplainRequest) => {
      openExplain(`Explain ${request.categoryLabel}`, buildCategoryExplainPrompt(request));
    },
    [openExplain],
  );

  const handleExplainConsideration = useCallback(
    (text: string) => {
      openExplain('Discuss this with Concierge', buildConsiderationExplainPrompt(text));
    },
    [openExplain],
  );

  const handleExplainWatchArea = useCallback(
    (area: MedicationWatchArea) => {
      openExplain('Explain areas to watch', buildWatchAreaExplainPrompt(area));
    },
    [openExplain],
  );

  const handleAddWatchAreaToPlan = useCallback(
    (area: MedicationWatchArea) => {
      if (!patientId) return;
      const proposal = proposeMedicationWatchArea({ patientId, area });
      if (proposal) {
        Alert.alert(
          'Added to your review',
          `Watch areas for ${area.medicationName} are waiting for your confirmation in the review section.`,
        );
        refresh();
      } else {
        Alert.alert(
          'Already covered',
          `Watch areas for ${area.medicationName} are already on the care plan or awaiting your review.`,
        );
      }
    },
    [patientId, refresh],
  );

  const handleConfirmPendingProposal = useCallback(
    (proposalId: string) => {
      if (!patientId) return;
      const result = caregiverConfirmProposalForUi(proposalId);
      if (result.blocked) {
        Alert.alert("Care plan is in view-only mode", result.blockMessage);
      }
      refresh();
    },
    [patientId, refresh],
  );
  const handleRejectPendingProposal = useCallback(
    (proposalId: string, reason: string) => {
      if (!patientId) return;
      caregiverRejectProposalForUi(proposalId, reason);
      refresh();
    },
    [patientId, refresh],
  );

  // Care plan backup consent — enabled by default (auto-grant once per patient).
  useEffect(() => {
    if (!patientId) return;
    ensureDefaultAdcpBackupConsent(patientId);
  }, [patientId]);

  const consents = useMemo(
    () => (patientId ? getActiveConsents(patientId) : []),
    // patientId is the only stable dep; settings.carePlanMode is intentionally
    // excluded — the consent store does not change when the read-only toggle
    // changes. Re-read after default grant via patientId.
    [patientId, snapshot?.lastRefreshedAt],
  );
  const backupConsentGranted = consents.some(
    (c) => c.scope === 'adcp_backup' && c.granted === true && !c.revokedAt,
  );

  // Therapy check-in scroll target — used when the route param
  // `focus=rehab-check-in` is set (deep link from Dashboard).
  const scrollRef = useRef<ScrollView | null>(null);
  const [therapySectionY, setTherapySectionY] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (focus !== "rehab-check-in" || therapySectionY <= 0) return;
      const handle = setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: Math.max(therapySectionY - 16, 0),
          animated: true,
        });
      }, 150);
      return () => clearTimeout(handle);
    }, [focus, therapySectionY]),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            explainRequest ? styles.contentWithMiniBar : null,
          ]}
        >
          <MainTabHeader
            title="Care"
            eyebrow="Caregiver Concierge ACCESS-DP"
            rightContent={<Text style={styles.patientName}>{patientName}</Text>}
          />

          <View style={styles.patientCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(patientName)}</Text>
            </View>
            <View style={styles.patientInfo}>
              <Text style={styles.patientCardName}>{patientName}</Text>
              <Text style={styles.patientDetail}>
                Age {patientAge} · {displayClinical(diagnosis)}
              </Text>
              <Text style={styles.patientMuted}>
                Caregiver {caregiverName} · {caregiverRole}
              </Text>
            </View>
          </View>

          <CarePlanHeaderCard
            vm={vm}
            onShowWhatChanged={() => setWhatChangedVisible(true)}
            whatChangedCount={vm.decisionDigest.length}
          />

          <CarePrioritiesSection
            view={prioritiesView}
            onExplainCard={(card) => explainUc4Card(card.cardId)}
            onExplainTimeline={handleExplainTimeline}
            onExplainWatchArea={handleExplainWatchArea}
            onAddWatchAreaToPlan={handleAddWatchAreaToPlan}
            onRespond={handleUc4Respond}
          />

          {vm.sections.showReview ? (
            <CarePlanReviewSection
              proposals={pendingProposals}
              onConfirm={handleConfirmPendingProposal}
              onReject={handleRejectPendingProposal}
            />
          ) : null}

          {vm.sections.showTherapy && patientId ? (
            <View
              onLayout={(event) => {
                setTherapySectionY(event.nativeEvent.layout.y);
              }}
            >
              <CarePlanTherapySection
                patientId={patientId}
                patientName={patientName}
                dailyEntry={dailyEntry}
                rehabExerciseAssignments={rehabExerciseAssignments}
                uc3ResultDisplay={uc3ResultDisplay}
                refresh={refresh}
                carePlanId={primaryPlan?.planId ?? null}
                uc3ResultId={latestUc3Result?.resultId ?? null}
              />
            </View>
          ) : null}

          {vm.sections.showGoals || hasCareConsiderations ? (
            <CarePlanGoalsSection
              patientId={patientId}
              primaryPlan={primaryPlan}
              goals={goals}
              caregiver={snapshot?.caregiver ?? null}
              symptoms={snapshot?.symptoms ?? []}
              safetyNotes={snapshot?.safetyNotes ?? ''}
              safetyLines={vm.safetyLines}
              onExplainItem={handleExplainGoalItem}
              onExplainCategory={handleExplainCategory}
              onExplainConsideration={handleExplainConsideration}
            />
          ) : null}

          <CarePlanMonitoringSection thresholds={thresholds} />

          <CarePlanBackupSection
            patientId={patientId}
            autoGrantConsent={backupConsentGranted}
            onRestored={refresh}
          />
        </ScrollView>

        <WhatChangedSheet
          visible={whatChangedVisible}
          items={vm.decisionDigest}
          onClose={() => setWhatChangedVisible(false)}
        />

        <SlmInsightSheet
          visible={explainRequest !== null}
          onClose={() => setExplainRequest(null)}
          title={explainRequest?.title ?? "Concierge explanation"}
          reason="care_explain"
          prompt={explainRequest?.prompt ?? ""}
          allowMinimize
        />
      </View>
    </SafeAreaView>
  );
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppTheme.colors.screen,
  },
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 40,
  },
  contentWithMiniBar: {
    paddingBottom: 120,
  },
  patientName: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  patientCard: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    ...AppTheme.shadow,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: AppTheme.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: AppTheme.colors.brand,
    fontSize: 18,
    fontWeight: '900',
  },
  patientInfo: {
    flex: 1,
  },
  patientCardName: {
    color: AppTheme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  patientDetail: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  patientMuted: {
    color: AppTheme.colors.brand,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 4,
  },
});
