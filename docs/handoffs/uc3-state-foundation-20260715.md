# UC3 State Foundation Handoff

*Last updated: July 15, 2026*

## Checkpoint

Branch:

`sebastian`

Production checkpoint tag:

`mhealth-uc3-state-foundation-20260715`

Previous remote checkpoint:

`sebastian-v6.2.0-20260713`

Production commit series:

```text
2da6c5438eb6db9af3820bb54bd374e34c8baac4 Simplify caregiver onboarding inputs
5d41ba7aeaa12f79df64f63b3cd1cca2aa59b01a Add repository-backed rehab check-ins
b83435dcbb08635e1823083d51a5f1d2e66eda57 Import structured rehabilitation targets
584167883ba73c670f50682416bebd2da97c5528 Route patient identity and safety by patient
f4055280e1d7a9d496bd51afac790b08a7be4305 Refine Home and Care rehabilitation layout
```

## Completed Work

The repository-backed UC3 input and state foundation is complete.

The application now supports this data path:

```text
FHIR / onboarding / caregiver rehabilitation input
-> normalized SQLite
-> repositories
-> PatientRecordSnapshot / PatientRecordProvider
-> approved UC3 consumer
```

No UC3 consumer should read live patient data directly from raw FHIR, global
onboarding state, fixture files, component-local form state, direct repository
queries outside the state-building layer, or an immediate engine return value.

Generated UC3 output remains future work. When added, it should follow this path:

```text
UC3 engine result
-> durable SQLite derived-result record
-> repository
-> PatientRecordSnapshot / PatientRecordProvider
-> UI, alerts, and approved orchestration consumers
```

Generated output must not overwrite FHIR-backed, clinician-authored, caregiver-
entered, demographic, observation, CarePlan, or daily rehabilitation source facts.

## State Now Available

`PatientRecordSnapshot` now has repository-backed access to the UC3 source facts
needed for the future adapter:

- patient ID, preferred name, and formal name
- caregiver context
- conditions, primary condition, and diagnosis history
- patient-scoped Safety notes
- active CarePlan
- CarePlan activities
- CarePlan goals
- structured rehabilitation plan metrics
- today's rehabilitation entry
- bounded longitudinal rehabilitation daily entries
- functional observations
- Care Planning Context
- timeline and history context

Daily rehabilitation facts remain source facts. The state layer does not calculate
adherence, pain score, home rehabilitation day, complexity score, expected
progress, plateau, or trajectory failure.

## Persistence

The production branch preserves the SQLite migration sequence:

- migration 33 adds caregiver-entered daily rehabilitation fields
- migration 34 adds `care_plan_rehab_metrics`
- migration 35 is an intentionally documented no-op reserved for local database state
- migration 36 adds patient-scoped onboarding Safety notes

No migration 37 is part of this checkpoint.

Repository support now covers daily rehabilitation entries, bounded daily
rehabilitation history, patient-scoped Safety notes, and structured CarePlan
rehabilitation metrics.

## Structured Rehabilitation Metrics

FHIR import maps clinician-plan rehabilitation targets by stable code, not text.
Supported metric keys are:

```text
romDegrees
exerciseReps
adherence
painScore
fatigueScore
walkingMinutes
```

CarePlan activities remain Today's Rehab Tasks. Plan metrics remain read-only
baseline and target information and are not converted into caregiver tasks.

## Production History And Tests

The pushable production history intentionally contains no newly added, modified,
or deleted focused test files after `sebastian-v6.2.0-20260713`.

The full focused test versions are preserved locally only on:

```text
local/uc3-foundation-tests
C:\src\mhealth-local-tests
local-uc3-foundation-with-tests-20260715
```

Do not push the local-only test branch or the local-only backup tag.

## Remaining Work

Connect the future UC3 adapter to `PatientRecordSnapshot` only. The adapter still
needs approved definitions for condition grouping, complexity score, adherence,
pain score source, home rehabilitation day, offline behavior, and device
timestamps.

Persist UC3 results before any UI, alert, language-generation, or orchestration
consumer reads them. A future result schema should include patient and CarePlan
IDs, model family and version, generated time, input date window, event type,
severity recommendation, human-review and emergency-breach flags, review score,
reason codes, explanations, metric analyses, data quality, caregiver message,
clinician summary, active/stale/superseded state, linked alert ID, and timestamps.

Expose only a narrow latest-result summary through patient state, such as
`latestRehabTrajectoryResult`. Keep detailed result history repository-backed.

After durable results exist, add result UI, alert integration, and approved
orchestration consumers through the existing repository and state flow. Do not
calculate trajectory or clinical conclusions inside UI components.
