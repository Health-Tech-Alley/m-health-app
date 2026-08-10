/**
 * Care tab — reworked IA + hero/spine presentation (Care tab rework).
 *
 * Presentation layer: the hero card ("Elena's Care Plan" + tri-state status
 * + Plan Pulse ring) anchors the tab, and the spine connector runs down the
 * left gutter linking every section — node colors = attention state, branch
 * thickness = content volume, a light packet travels only when something
 * needs review. Entrance choreography plays once per app session and honors
 * reduced-motion.
 *
 * Sections rendered, in order (each wrapped in a measured SpineSection):
 *   Hero (+ "What changed" modal) → Your priorities → Review (when pending +
 *   writable) → Therapy (hard-gated) → Goals & activities (categorized, with
 *   care considerations) → Safety rules (always/never) → Monitoring (always)
 *   → Backup & restore.
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
 * via the existing `usePatientRecord` hook. Plan Pulse + spine states are
 * read-only derivations.
 */

import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MainTabHeader } from "@/components/MainTabHeader";
import { SlmInsightSheet } from "@/components/slm-insight-sheet";
import { CarePlanHeroCard } from "@/components/care/plan/CarePlanHeroCard";
import {
  CareSpineConnector,
  SPINE_GUTTER,
  SpineSection,
  type SpineAttention,
  type SpineNode,
} from "@/components/care/plan/CareSpineConnector";
import { CarePlanReviewSection } from "@/components/care/plan/CarePlanReviewSection";
import { CarePrioritiesSection } from "@/components/care/plan/CarePrioritiesSection";
import { ObservationVitalsCard } from "@/components/care/ObservationVitalsCard";
import { CarePlanMonitoringSection } from "@/components/care/plan/CarePlanMonitoringSection";
import { CarePlanTherapySection } from "@/components/care/plan/CarePlanTherapySection";
import {
  CarePlanGoalsSection,
  type CategoryExplainRequest,
  type GoalExplainRequest,
} from "@/components/care/plan/CarePlanGoalsSection";
import { CarePlanBackupSection } from "@/components/care/plan/CarePlanBackupSection";
import { CarePlanSafetySection } from "@/components/care/plan/CarePlanSafetySection";
import { WhatChangedSheet } from "@/components/care/plan/WhatChangedSheet";
import { CareAskRegion } from "@/components/care/plan/CareAskRegion";
import {
  CarePlanAskChat,
  type CarePlanAskLaunch,
} from "@/components/careConcierge/CarePlanAskChat";
import type { AdcpProposalIntentId } from "@/data/adcp/types";
import { AppTheme } from "@/constants/theme";
import { useCriticalAlert } from "@/contexts/critical-alert-context";
import { usePatientRecord } from "@/contexts/patient-record-context";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/hooks/use-translation";
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
import { computePlanPulse } from "@/services/carePlan/planPulseService";
import {
  caregiverConfirmProposal as caregiverConfirmProposalForUi,
  caregiverRejectProposal as caregiverRejectProposalForUi,
} from "@/services/carePlan/mlPlanProposalService";
import { getActiveConsents } from "@/data";
import { ensureDefaultAdcpBackupConsent } from "@/services/consent/defaultConsents";

// The hero entrance (fade/slide + ring sweep + spine draw) plays once per app
// session on first Care-tab view, then stays settled.
let careEntrancePlayedThisSession = false;

export default function CareScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
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

  // Care soft-NLU / in-card ask chat (therapy-style mini chat + HITL).
  const [careAskLaunch, setCareAskLaunch] = useState<CarePlanAskLaunch | null>(null);

  const launchCareIntent = useCallback(
    (intentId: AdcpProposalIntentId, args?: Record<string, unknown>) => {
      setCareAskLaunch({ intent: intentId, args });
    },
    [setCareAskLaunch],
  );

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

  // Plan Pulse — hero score + attention (read-only derivation).
  const planPulse = useMemo(
    () => computePlanPulse(snapshot, vm.plan, vm.mode),
    [snapshot, vm.plan, vm.mode],
  );

  // Entrance choreography (once per session) + reduced-motion accessibility.
  const [playEntrance] = useState(() => {
    if (careEntrancePlayedThisSession) return false;
    careEntrancePlayedThisSession = true;
    return true;
  });
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Spine geometry: title-band Y from SpineSection (pinned, not section center).
  const [heroBottomY, setHeroBottomY] = useState<number | null>(null);
  const [spineNodeYs, setSpineNodeYs] = useState<Record<string, number>>({});
  const handleSpineMeasure = useCallback((id: string, titleY: number) => {
    setSpineNodeYs((current) =>
      current[id] === titleY ? current : { ...current, [id]: titleY },
    );
  }, []);

  const functionalScales = useMemo(() => {
    const fromPlan = vm.plan?.clinicalFraming?.functionalScales;
    if (fromPlan && Object.keys(fromPlan).length > 0) return fromPlan;
    const p = snapshot?.patient;
    if (!p) return null;
    const scales: Record<string, string> = {};
    if (p.gmfcs && p.gmfcs !== 'Not assessed') scales.gmfcs = p.gmfcs;
    if (p.fms && p.fms !== 'Not assessed') scales.fms = p.fms;
    if (p.macs && p.macs !== 'Not assessed') scales.macs = p.macs;
    if (p.cfcs && p.cfcs !== 'Not assessed') scales.cfcs = p.cfcs;
    if (p.edacs && p.edacs !== 'Not assessed') scales.edacs = p.edacs;
    return Object.keys(scales).length > 0 ? scales : null;
  }, [vm.plan?.clinicalFraming?.functionalScales, snapshot?.patient]);

  const careContextExtension = useMemo(() => {
    const raw = vm.plan?.extensions?.careContext;
    if (!raw || typeof raw !== 'object') return null;
    return raw as {
      mainConcern?: string;
      supportNeeds?: string;
      dailyRoutine?: string;
      mobilitySummary?: string;
      otherNotes?: string;
    };
  }, [vm.plan?.extensions]);

  // Goals & activities also renders when only care considerations exist
  // (onboarding concern/support/mobility/routine — not safety notes).
  const hasCareConsiderations = Boolean(
    snapshot?.caregiver?.mainConcern?.trim() ||
      snapshot?.caregiver?.stressOrSupportNeeds?.trim() ||
      (snapshot?.symptoms ?? []).some((symptom) => symptom.category === 'other') ||
      snapshot?.patient?.baselineDailyRoutine?.trim() ||
      (functionalScales && Object.keys(functionalScales).length > 0) ||
      careContextExtension?.mainConcern ||
      careContextExtension?.supportNeeds ||
      careContextExtension?.dailyRoutine ||
      careContextExtension?.mobilitySummary,
  );

  const safetyAlwaysNever = useMemo(
    () => vm.safetyLines.filter((line) => line.kind === 'always' || line.kind === 'never'),
    [vm.safetyLines],
  );

  // Spine section model: which sections are visible, their attention state,
  // and their content weight (drives node color + branch thickness).
  const spineSections = useMemo(() => {
    const unactioned = uc4PriorityCards.filter((card) => card.status === 'active').length;
    const goalsWeight = goals.length + (primaryPlan?.activities?.length ?? 0);
    const list: { id: string; attention: SpineAttention; weight: number }[] = [
      {
        id: 'priorities',
        attention:
          unactioned > 0 ? 'review' : prioritiesView.totalPriorities > 0 ? 'calm' : 'empty',
        weight: prioritiesView.totalPriorities,
      },
    ];
    if (vm.sections.showReview) {
      list.push({ id: 'review', attention: 'review', weight: pendingProposals.length });
    }
    if (vm.sections.showTherapy && patientId) {
      list.push({
        id: 'therapy',
        attention: dailyEntry ? 'calm' : 'review',
        weight: rehabExerciseAssignments.length,
      });
    }
    if (vm.sections.showGoals || hasCareConsiderations) {
      list.push({
        id: 'goals',
        attention: goalsWeight > 0 ? 'calm' : 'empty',
        weight: goalsWeight,
      });
    }
    if (safetyAlwaysNever.length > 0) {
      list.push({ id: 'safety', attention: 'calm', weight: safetyAlwaysNever.length });
    }
    list.push({
      id: 'monitoring',
      attention: thresholds.length > 0 ? 'calm' : 'empty',
      weight: thresholds.length,
    });
    list.push({ id: 'backup', attention: 'calm', weight: 1 });
    return list;
  }, [
    uc4PriorityCards,
    goals.length,
    primaryPlan?.activities?.length,
    prioritiesView.totalPriorities,
    vm.sections.showReview,
    vm.sections.showTherapy,
    vm.sections.showGoals,
    patientId,
    pendingProposals.length,
    dailyEntry,
    rehabExerciseAssignments.length,
    hasCareConsiderations,
    safetyAlwaysNever.length,
    thresholds.length,
  ]);

  const spineNodes: SpineNode[] = useMemo(
    () =>
      spineSections
        .filter((section) => spineNodeYs[section.id] != null)
        .map((section) => ({
          id: section.id,
          attention: section.attention,
          weight: section.weight,
          y: spineNodeYs[section.id],
        })),
    [spineSections, spineNodeYs],
  );

  const explainUc4Card = useCallback(
    (cardId: string) => {
      const card = uc4PriorityCards.find((candidate) => candidate.cardId === cardId);
      if (!card) return;
      openExplain(t("care.explain.careFocus"), buildUc4CardExplainPrompt(card));
    },
    [uc4PriorityCards, openExplain, t],
  );

  const handleExplainTimeline = useCallback(() => {
    openExplain(t("care.explain.timeline"), buildTimelineExplainPrompt(prioritiesView.timeline));
  }, [openExplain, prioritiesView.timeline, t]);

  const handleExplainGoalItem = useCallback(
    (request: GoalExplainRequest) => {
      openExplain(
        request.kind === 'goal' ? t("care.explain.goal") : t("care.explain.activity"),
        buildGoalOrActivityExplainPrompt(request),
      );
    },
    [openExplain, t],
  );

  const handleExplainCategory = useCallback(
    (request: CategoryExplainRequest) => {
      openExplain(
        t("care.explain.category", {
          category: request.displayCategoryLabel ?? request.categoryLabel,
        }),
        buildCategoryExplainPrompt(request),
      );
    },
    [openExplain, t],
  );

  const handleExplainConsideration = useCallback(
    (text: string) => {
      openExplain(t("care.explain.consideration"), buildConsiderationExplainPrompt(text));
    },
    [openExplain, t],
  );

  const handleExplainWatchArea = useCallback(
    (area: MedicationWatchArea) => {
      openExplain(t("care.explain.watchAreas"), buildWatchAreaExplainPrompt(area));
    },
    [openExplain, t],
  );

  const handleAddWatchAreaToPlan = useCallback(
    (area: MedicationWatchArea) => {
      if (!patientId) return;
      const proposal = proposeMedicationWatchArea({ patientId, area });
      if (proposal) {
        Alert.alert(
          t("care.alert.addedReview.title"),
          t("care.alert.addedReview.body", { medicationName: area.medicationName }),
        );
        refresh();
      } else {
        Alert.alert(
          t("care.alert.alreadyCovered.title"),
          t("care.alert.alreadyCovered.body", { medicationName: area.medicationName }),
        );
      }
    },
    [patientId, refresh, t],
  );

  const handleConfirmPendingProposal = useCallback(
    (proposalId: string) => {
      if (!patientId) return;
      const result = caregiverConfirmProposalForUi(proposalId);
      if (result.blocked) {
        Alert.alert(t("care.alert.viewOnly.title"), result.blockMessage);
      }
      refresh();
    },
    [patientId, refresh, t],
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
    <SafeAreaView style={[styles.safeArea, themedStyles.safeArea]} edges={["top"]}>
      <View style={[styles.root, themedStyles.root]}>
        <ScrollView
          ref={scrollRef}
          style={themedStyles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            themedStyles.content,
            explainRequest ? styles.contentWithMiniBar : null,
          ]}
        >
          <View style={styles.headerBleed}>
            <MainTabHeader
              title={t("care.header.title")}
              eyebrow={t("care.header.eyebrow")}
              icon="care"
            />
          </View>

          <CareSpineConnector
            heroBottomY={heroBottomY}
            nodes={spineNodes}
            playEntrance={playEntrance}
            reduceMotion={reduceMotion}
          />

          <View
            style={styles.heroBleed}
            onLayout={(event) => {
              const { y, height } = event.nativeEvent.layout;
              setHeroBottomY((current) => {
                const next = y + height;
                return current === next ? current : next;
              });
            }}
          >
            <CarePlanHeroCard
              vm={vm}
              pulse={planPulse}
              patientName={patientName}
              patientAge={patientAge}
              primaryDiagnosisLabel={displayClinical(diagnosis)}
              caregiverName={caregiverName}
              caregiverRole={caregiverRole}
              onShowWhatChanged={() => setWhatChangedVisible(true)}
              whatChangedCount={vm.decisionDigest.length}
              playEntrance={playEntrance}
              reduceMotion={reduceMotion}
            />
          </View>

          <SpineSection
            id="priorities"
            attention={
              uc4PriorityCards.some((card) => card.status === "active")
                ? "review"
                : prioritiesView.totalPriorities > 0
                  ? "calm"
                  : "empty"
            }
            onMeasure={handleSpineMeasure}
          >
            <CarePrioritiesSection
              view={prioritiesView}
              onExplainCard={(card) => explainUc4Card(card.cardId)}
              onExplainTimeline={handleExplainTimeline}
              onExplainWatchArea={handleExplainWatchArea}
              onAddWatchAreaToPlan={handleAddWatchAreaToPlan}
              onRespond={handleUc4Respond}
            />
          </SpineSection>

          {vm.sections.showReview ? (
            <SpineSection id="review" attention="review" onMeasure={handleSpineMeasure}>
              <CarePlanReviewSection
                proposals={pendingProposals}
                onConfirm={handleConfirmPendingProposal}
                onReject={handleRejectPendingProposal}
              />
            </SpineSection>
          ) : null}

          {vm.sections.showTherapy && patientId ? (
            <SpineSection
              id="therapy"
              attention={dailyEntry ? 'calm' : 'review'}
              onMeasure={handleSpineMeasure}
            >
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
            </SpineSection>
          ) : null}

          {vm.sections.showGoals || hasCareConsiderations ? (
            <SpineSection
              id="goals"
              attention={
                goals.length + (primaryPlan?.activities?.length ?? 0) > 0 ? 'calm' : 'empty'
              }
              onMeasure={handleSpineMeasure}
            >
              <CarePlanGoalsSection
                patientId={patientId}
                primaryPlan={primaryPlan}
                goals={goals}
                caregiver={snapshot?.caregiver ?? null}
                symptoms={snapshot?.symptoms ?? []}
                dailyRoutine={snapshot?.patient?.baselineDailyRoutine ?? null}
                functionalScales={functionalScales}
                careContextExtension={careContextExtension}
                onExplainItem={handleExplainGoalItem}
                onExplainCategory={handleExplainCategory}
                onExplainConsideration={handleExplainConsideration}
              />
            </SpineSection>
          ) : null}

          {safetyAlwaysNever.length > 0 ? (
            <SpineSection id="safety" attention="calm" onMeasure={handleSpineMeasure}>
              <CarePlanSafetySection
                lines={safetyAlwaysNever}
                onExplainLine={(line) =>
                  openExplain(
                    t("care.explain.safetyRule"),
                    buildConsiderationExplainPrompt(
                      `${line.kind === 'always' ? 'Always' : 'Never'}: ${line.text}`,
                    ),
                  )
                }
              />
            </SpineSection>
          ) : null}

          <SpineSection
            id="monitoring"
            attention={thresholds.length > 0 ? "calm" : "empty"}
            onMeasure={handleSpineMeasure}
          >
            <CarePlanMonitoringSection
              thresholds={thresholds}
              baselines={{
                spo2Cutoff: snapshot?.patient?.spo2Cutoff,
                baselineHeartRate: snapshot?.patient?.baselineHeartRate,
                baselineBloodOxygen: snapshot?.patient?.baselineBloodOxygen,
                baselineRespiratoryRate: snapshot?.patient?.baselineRespiratoryRate,
              }}
            />
          </SpineSection>

          <SpineSection id="recent-readings" attention="calm" onMeasure={handleSpineMeasure}>
            <ObservationVitalsCard />
          </SpineSection>

          <SpineSection id="backup" attention="calm" onMeasure={handleSpineMeasure}>
            <CarePlanBackupSection
              patientId={patientId}
              autoGrantConsent={backupConsentGranted}
              onRestored={refresh}
            />
          </SpineSection>

          <SpineSection id="ask" attention="calm" onMeasure={handleSpineMeasure}>
            <CareAskRegion
              patientId={patientId}
              writable={vm.mode !== "read_only"}
              onLaunchIntent={(intentId) => launchCareIntent(intentId)}
            >
              <CarePlanAskChat
                snapshot={snapshot}
                patientName={patientName !== "—" ? patientName : undefined}
                writable={vm.mode !== "read_only"}
                externalLaunch={careAskLaunch}
                onExternalLaunchConsumed={() => setCareAskLaunch(null)}
                onProposalResolved={refresh}
              />
            </CareAskRegion>
          </SpineSection>
        </ScrollView>

        <WhatChangedSheet
          visible={whatChangedVisible}
          items={vm.decisionDigest}
          onClose={() => setWhatChangedVisible(false)}
        />

        <SlmInsightSheet
          visible={explainRequest !== null}
          onClose={() => setExplainRequest(null)}
          title={explainRequest?.title ?? t("care.explain.conciergeExplanation")}
          reason="care_explain"
          prompt={explainRequest?.prompt ?? ""}
          allowMinimize
        />

      </View>
    </SafeAreaView>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { backgroundColor: theme.appBackground },
    root: { backgroundColor: theme.appBackground },
    scrollView: { backgroundColor: theme.appBackground },
    content: { backgroundColor: theme.appBackground },
  });
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
    // Left gutter reserved for the spine so lines never sit under the cards.
    // Header/hero pull back from the spine gutter; header uses normal tab gutters.
    paddingLeft: SPINE_GUTTER + 8,
    paddingRight: 18,
    paddingTop: 18,
    paddingBottom: 40,
  },
  contentWithMiniBar: {
    paddingBottom: 120,
  },
  // Align header with the normal tab header inset, separate from hero/socket geometry.
  headerBleed: {
    marginLeft: -(SPINE_GUTTER + 8 - 24),
    marginRight: 24 - 18,
    marginTop: 4,
  },
  // Hero spans full width including the spine gutter so the socket + spine line up.
  heroBleed: {
    marginLeft: -(SPINE_GUTTER + 8 - 18),
    marginRight: 0,
  },
  patientName: {
    color: AppTheme.colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
});
