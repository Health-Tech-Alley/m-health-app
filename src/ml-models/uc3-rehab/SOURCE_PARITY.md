# UC3 Rehab v2 Source Parity

## Model version

`rehab_trajectory_rules_v0.2.0`

## Authoritative source files

Source handoff root: `C:\Users\Sebastian\Downloads\uc3_handoff_v2\uc3_handoff`

The production engine port is based only on these reusable v2 source files:

- `src/types.ts`
- `src/adherence.ts`
- `src/complexity.ts`
- `src/plan.ts`
- `src/trajectory.ts`
- `src/plateau.ts`
- `src/scoring.ts`
- `src/safety.ts`
- `src/dataQuality.ts`
- `src/messages.ts`
- `src/mathUtils.ts`
- `src/decisionEngine.ts`
- `src/index.ts`

The following delivered files were not ported into production runtime:

- `src/syntheticLogs.ts`
- `src/scenarioTests.ts`
- `src/exampleRunner.ts`
- `examples/sample_uc3_input_payload.json`
- `examples/sample_uc3_output_payload.json`
- `src/shareRecord.ts`

## Mechanical adaptations

- Copied the reusable engine files into the app model convention at `src/ml-models/uc3-rehab/`.
- Removed `buildDefaultPatientContext` from runtime exports so the production engine does not carry the delivered James/Diane demo default.
- Removed `buildDefaultEhrRehabContext` from runtime exports so the production engine does not carry the delivered demo EHR default.
- Kept `buildEhrRehabContextFromExtractedProfile` from the v2 source because it is the reusable EHR-context builder, and it preserves Jay's complexity calculation.
- Removed the unused `round` import from `plan.ts` after removing the demo builders.
- Removed `ShareRecordPayload` from `types.ts` because sharing transport was explicitly out of scope for engine parity.
- Removed `shareRecord` and `syntheticLogs` exports from `index.ts` because sharing transport and synthetic runtime logs were explicitly out of scope.
- Added local parity tests under `__tests__` with copied scenario fixture data so synthetic logs remain test-only.

No formulas, constants, thresholds, durations, milestone calculation, adherence calculation, complexity calculation, classifications, reason codes, messages, or model version were intentionally changed.

## V2 source-versus-fixture discrepancies

### Delivered 28-day trajectory expectation versus actual result

Delivered `src/scenarioTests.ts` expects `trajectory_failure` to return `TRAJECTORY_FAILURE_DETECTED` using the default v2 plan.

Executable v2 source behavior for the delivered 28-day trajectory shape returns:

- eventType: `NO_TRAJECTORY_FAILURE`
- severity: `none`
- requiresHumanReview: `false`
- reviewPriorityScore: `0.844`
- reasonCodes: `NO_EMERGENCY_THRESHOLD_BREACH`, `HIGH_ADHERENCE`, `NINE_DAY_PLATEAU`
- ROM finalActual: `52.11`
- ROM finalExpected: `55.56`
- ROM gapPercent: `0.062`
- ROM plateauDays: `9`
- adherence finalActual: `0.89`
- data quality: 21 logged days of 28, missing days 22-28, sufficientData `true`

### Delivered low-adherence expectation versus actual result

Delivered `src/scenarioTests.ts` expects `low_adherence` to return `LOW_ADHERENCE_BARRIER` using the default v2 plan.

Executable v2 source behavior for the delivered low-adherence default-plan shape returns:

- eventType: `NO_TRAJECTORY_FAILURE`
- severity: `none`
- requiresHumanReview: `false`
- reviewPriorityScore: `0.819`
- reasonCodes: `NO_EMERGENCY_THRESHOLD_BREACH`
- ROM finalActual: `52.11`
- ROM finalExpected: `55.56`
- ROM gapPercent: `0.062`
- adherence finalActual: `0.42`
- adherence finalExpected: `0.83`
- adherence gapPercent: `0.493`

### Unchanged static sample-output discrepancy

Delivered `examples/sample_uc3_output_payload.json` remains inconsistent with executable v2 source behavior. It reports:

- eventType: `TRAJECTORY_FAILURE_DETECTED`
- reviewPriorityScore: `0.86`
- ROM finalExpected: `64.5`
- ROM recentSlope: `-0.055`
- adherence finalActual: `0.87`
- data quality: 21 logged days of 21

Executable v2 source with the 21-day diagnostic overrides returns `TRAJECTORY_FAILURE_DETECTED`, but with source-calculated values including reviewPriorityScore `0.947`, ROM recentSlope `-0.078`, and adherence finalActual `0.89`.

### 21-day diagnostic behavior

Executable v2 source with 21-day diagnostic metric overrides returns:

- eventType: `TRAJECTORY_FAILURE_DETECTED`
- severity: `non_emergency`
- requiresHumanReview: `true`
- reviewPriorityScore: `0.947`
- reasonCodes: `NO_EMERGENCY_THRESHOLD_BREACH`, `HIGH_ADHERENCE`, `ROM_BELOW_MILESTONE`, `NINE_DAY_PLATEAU`
- ROM finalActual: `52.11`
- ROM finalExpected: `64.5`
- ROM gapPercent: `0.192`
- ROM recentSlope: `-0.078`
- ROM plateauDays: `9`
- adherence finalActual: `0.89`
- adherence finalExpected: `0.89`
- data quality: 21 logged days of 21, sufficientData `true`

## Questions requiring Jay's confirmation

1. Should the executable v2 source be treated as authoritative over delivered `scenarioTests.ts` expectations and static sample JSON?
2. Is the v2 default plan duration of 28 days intentional for production engine behavior?
3. Should the delivered `trajectory_failure` scenario expectation be updated to `NO_TRAJECTORY_FAILURE` under the 28-day default/high-complexity source behavior, or should source logic change later?
4. Should the delivered `low_adherence` scenario expectation be updated to `NO_TRAJECTORY_FAILURE` under the 28-day default/high-complexity source behavior, or should source logic change later?
5. Should the 21-day diagnostic override set be the canonical demonstration scenario for `TRAJECTORY_FAILURE_DETECTED`?
6. Should static `examples/sample_uc3_output_payload.json` be regenerated from executable v2 source, and which run configuration should it use?
7. Should derived adherence from rounded raw completion fields be the canonical adherence behavior when existing app adherence is absent?
8. Is `buildEhrRehabContextFromExtractedProfile` the intended production-facing complexity entry point for the app integration layer?
9. Are the default high-complexity threshold adjustments, especially ROM gap `0.25` and plateau threshold `12`, intended to suppress default 28-day trajectory and low-adherence events?
