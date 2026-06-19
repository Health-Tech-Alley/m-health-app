import {
    AppleWatchVitalsInput,
    CaregiverFinalAction,
    PatientProfileDefaults,
    UC2ContextualType,
} from "./uc2Types";

import { UC2_FEATURE_ORDER } from "./uc2Constants";
import { buildUC2FeatureVector } from "./featureEngineering";
import { scaleFeatures, UC2Scaler } from "./scaler";
import { runEmergencyRuleEngine } from "./emergencyRuleEngine";
import {
    reconstructionError,
    getTopReconstructionContributions,
} from "./anomalyScoring";
import {
    classifyInitialContextualType,
    fusePostHITLContext,
} from "./contextualRouting";
import { shouldShowCaregiverPrompt } from "./caregiverHitl";
import { finalDecision } from "./finalDecision";
import {
    buildInitialMCPPayload,
    buildFinalSLMPayload,
} from "./payloadBuilders";

export type TFLiteAutoencoderRunner = (
    scaledInput: number[]
) => Promise<number[]>;

export type UC2DecisionResult = {
    emergencyResult: ReturnType<typeof runEmergencyRuleEngine>;
    rawFeatures: number[];
    scaledFeatures: number[] | null;
    aeScore: number | null;
    threshold: number;
    isAnomaly: boolean;
    promptShown: boolean;
    initialAnomalyType: UC2ContextualType;
    postHitlAnomalyType: UC2ContextualType;
    topFeatureEvidence: ReturnType<typeof getTopReconstructionContributions>;
    featureQuality: Record<string, import("./uc2Types").FeatureQuality>;
    finalDecision: ReturnType<typeof finalDecision>;
    initialMCPPayload: ReturnType<typeof buildInitialMCPPayload> | null;
    finalSLMPayload: ReturnType<typeof buildFinalSLMPayload> | null;
};

export async function runUC2DecisionLayer(params: {
    eventId: string;
    input: AppleWatchVitalsInput;
    patientProfile?: PatientProfileDefaults;
    scaler: UC2Scaler;
    threshold: number;
    runTFLiteAutoencoder: TFLiteAutoencoderRunner;

    // These come after UI HITL. For pre-HITL mode, pass defaults
    caregiverFinalAction?: CaregiverFinalAction;
    caregiverSelectedCodes?: string[];
}): Promise<UC2DecisionResult> {
    const {
        eventId,
        input,
        patientProfile,
        scaler,
        threshold,
        runTFLiteAutoencoder,
    } = params;

    const caregiverFinalAction =
        params.caregiverFinalAction ?? "no_prompt_shown";

    const caregiverSelectedCodes = params.caregiverSelectedCodes ?? [];

    const featureVector = buildUC2FeatureVector(input, patientProfile);

    const emergencyResult = runEmergencyRuleEngine(featureVector.featureMap);

    if (emergencyResult.emergency) {
        const initialAnomalyType = "CRITICAL_EMERGENCY_ALERT" as const;
        const postHitlAnomalyType = "CRITICAL_EMERGENCY_ALERT" as const;

        const decision = finalDecision({
            emergency: true,
            promptShown: false,
            caregiverFinalAction: "no_prompt_shown",
            postHitlAnomalyType,
        });

        return {
            emergencyResult,
            rawFeatures: featureVector.rawFeatures,
            scaledFeatures: null,
            aeScore: null,
            threshold,
            isAnomaly: false,
            promptShown: false,
            initialAnomalyType,
            postHitlAnomalyType,
            topFeatureEvidence: [],
            featureQuality: featureVector.featureQuality,
            finalDecision: decision,
            initialMCPPayload: null,
            finalSLMPayload: null,
        };
    }

    const scaledFeatures = scaleFeatures(featureVector.rawFeatures, scaler);

    const reconstructed = await runTFLiteAutoencoder(scaledFeatures);

    const aeScore = reconstructionError(scaledFeatures, reconstructed);

    const isAnomaly = aeScore >= threshold;

    const topFeatureEvidence = getTopReconstructionContributions(
        scaledFeatures,
        reconstructed,
        UC2_FEATURE_ORDER,
        5
    );

    const initialAnomalyType = classifyInitialContextualType({
        emergency: false,
        isAnomaly,
        topFeatureEvidence,
    });

    const promptShown = shouldShowCaregiverPrompt({
        emergency: false,
        isAnomaly,
    });

    const initialMCPPayload = promptShown
        ? buildInitialMCPPayload({
            eventId,
            input,
            pipelinePath: emergencyResult.pipelinePath,
            aeScore,
            threshold,
            isAnomaly,
            initialAnomalyType,
            topFeatureEvidence,
            featureQuality: featureVector.featureQuality,
        })
        : null;

    const postHitlAnomalyType = fusePostHITLContext({
        initialType: initialAnomalyType,
        caregiverSelectedCodes,
    });

    const caregiverConfirmed = caregiverFinalAction === "confirm_concern";

    const decision = finalDecision({
        emergency: false,
        promptShown,
        caregiverFinalAction,
        postHitlAnomalyType,
    });

    const shouldBuildFinalSLMPayload =
        decision.final_notification_type === "SLM_SUMMARY_AND_PROVIDER_NOTE" ||
        decision.final_notification_type === "MONITORING_ADVICE";

    const finalSLMPayload = shouldBuildFinalSLMPayload
        ? buildFinalSLMPayload({
            eventId,
            input,
            emergencyResult,
            aeScore,
            threshold,
            isAnomaly,
            initialAnomalyType,
            postHitlAnomalyType,
            topFeatureEvidence,
            featureQuality: featureVector.featureQuality,
            caregiverFinalAction,
            caregiverConfirmed,
            caregiverSelectedCodes,
            finalDecision: decision,
        })
        : null;

    return {
        emergencyResult,
        rawFeatures: featureVector.rawFeatures,
        scaledFeatures,
        aeScore,
        threshold,
        isAnomaly,
        promptShown,
        initialAnomalyType,
        postHitlAnomalyType,
        topFeatureEvidence,
        featureQuality: featureVector.featureQuality,
        finalDecision: decision,
        initialMCPPayload,
        finalSLMPayload,
    };
}
