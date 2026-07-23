
internship 07/22

Stopped thinking


CURRENT_STATE(3).md
File

Got it — this is the Internship 07/22 current-state handoff for the mHealth project.

The document’s governing rules are to treat it as the architecture contract, stop when code conflicts with it, and avoid guessing.


Key recorded state:

Verified on July 23, 2026

Required branch: sebastian

Implementation HEAD before this documentation update: fc7f0fc13db6e6fb82676c2fd0b221e0b7e6ab66

Local sebastian is ahead of origin/development and origin/sebastian pending the approved push to origin/sebastian

Expected working tree: clean

No new release tag was created for this local update


Next priorities are a fresh development-integration audit/rebase decision, wearable integration and patient isolation, UC2-UC4 validation, SLM/Concierge/evidence validation, and broader integration testing before any release tag.



okay so now ethan has pushed new changes to development. We have to work on top of that. So we need to do a rebase onto the development branch. You as a senior architetural, and UI/UX expert will have to use codex as your tool. Create prompt, then we get anser from codex we review it and decide to move forward base on any input I offer. Remember we are following this approach
DietrichGebert/ponytail

wthouut breaking or changing the actual behaviour. Do not create refraction, abstraction, or unnecesary complecity. Follow possible path you could take, or exisitng features you could modify. Do not invent anything if you are not sure ask back for clarification. Also include a polished version of this instruction on the "CURRENT_STATE" file.

Worked for 4m 23s
I updated the operating contract and created the first Codex prompt.

CURRENT_STATE.md

The update adds:

A notice that Ethan’s new origin/development changes make the recorded SHAs historical until reverified.

A Codex–ChatGPT–user decision workflow.

The Ponytail minimum-change ladder.

Architecture and UI/UX preservation constraints.

Separate preflight, approved-rebase, conflict-resolution, and validation phases.

A ready-to-run Codex prompt for the read-only rebase assessment.

I treated Ponytail as the minimum-change discipline, not as the entire review process. Its own rules require tracing the real flow before choosing the smallest solution and prohibit sacrificing validation, error handling, security, or accessibility. Its dedicated review mode also explicitly excludes correctness, security, and performance, so those remain part of our normal architectural review.

The existing contract requires exact approval before a rebase and keeps audit, implementation, commit, and push as separate phases.




Initial Codex prompt
You are performing a read-only integration preflight for the mHealth repository.

Read CURRENT_STATE.md fully before doing anything. Treat it as the governing architecture, ownership, workflow, and Git contract.

Context:

Work only in C:\src\mhealth.

Remain on the existing sebastian branch.

Ethan has reportedly pushed new changes to origin/development.

We expect to rebase sebastian onto the latest verified origin/development, but the rebase is not authorized in this phase.

Preserve all actual application, clinical, persistence, state, accessibility, and UI behavior.

Follow the Ponytail minimum-change approach: understand the real flow first; reuse existing code and platform capabilities; avoid new abstractions, dependencies, parallel paths, refactors, and unnecessary complexity.

Perform only a read-only preflight:

Show the current directory and prove it is C:\src\mhealth.

Verify the current branch, HEAD, worktree, staged files, untracked files, and whether any merge, rebase, cherry-pick, revert, or bisect is in progress.

Fetch origin so the remote-tracking refs are current. Do not pull, merge, rebase, reset, restore, stage, commit, push, tag, create or switch branches, or edit files.

Report the exact SHAs for HEAD, origin/sebastian, and origin/development, including the ahead/behind counts among them.

List the commits newly present on origin/development since the documented baseline 0bea8bc15e2deefd36c8222005ebbd12c6d02167. Identify which appear to be Ethan’s changes using verified commit metadata. Do not infer authorship from filenames.

Summarize the changed files and functional areas in those commits, especially SLM, Concierge, evidence retrieval or orchestration, provenance, patient isolation, shared state, UI, and any files overlapping local sebastian commits.

Determine the exact local commits that a normal git rebase origin/development would replay.

Identify likely conflict files and explain the intended behavior on both sides. Do not propose broad refactors. State only behavior-preserving conflict-resolution principles.

Determine whether the repository snapshot in CURRENT_STATE.md is stale and list every field that must be updated after a successful rebase.

Stop and return the report. Do not perform the rebase or modify CURRENT_STATE.md.

Use this response structure:

Repository state

New development commits

Changed files and ownership boundaries

Local commits that would be replayed

Likely conflicts and behavior risks

Smallest safe next action

Exact rebase command proposed, but not executed

Post-rebase validation plan

Questions or discrepancies

Actions performed

Under Actions performed, explicitly confirm that no files, index state, commits, branches, tags, or Git history were changed. The only permitted repository mutation in this phase is updating remote-tracking refs through git fetch origin.

No rebase or repository mutation was performed. This environment has no Codex executable, and the connected GitHub app currently exposes no mHealth repository. Provide or connect the repository’s owner/repo identifier so the new development commits can be inspected and the Codex response reviewed.

you have to ask codex to do it and then.

Library
/
CURRENT_STATE.md


mHealth System Architecture and Engineering Contract
Purpose: This is the single read-first operating contract for AI-assisted work on the mHealth application.
Give this file to Codex, ChatGPT, or another engineer before asking for audits, design changes, or implementation.

Authority: Treat this document as the governing architecture and workflow contract.
When code and this document appear to disagree, stop, report the discrepancy, and ask for a decision. Do not guess.

2026-07-23 local state notice: sebastian contains approved local UI and onboarding commits on top of origin/development e4be3d9018e6f0bc9b41375fa4b490a1d500e107. Development integration, merge/rebase work, and release tagging remain separate later decisions. This documentation update is approved for a local commit and push only to origin/sebastian; it does not authorize pushing to origin/development, rebasing, merging, tagging, force-pushing, or changing the preservation stash.

1. Repository Snapshot
This snapshot was last verified on 2026-07-23.

Repository: C:\src\mhealth
Required branch: sebastian
Local branch: sebastian
Local implementation HEAD before this documentation commit: fc7f0fc13db6e6fb82676c2fd0b221e0b7e6ab66
Remote development SHA: e4be3d9018e6f0bc9b41375fa4b490a1d500e107
Remote sebastian SHA before approved push: 0bea8bc15e2deefd36c8222005ebbd12c6d02167
Local versus origin/development before documentation commit: 0 behind, 5 ahead
Local versus origin/sebastian before approved push: 0 behind, 12 ahead
Expected working tree before documentation edit: clean
Latest pushed tag: mhealth-generic-fhir-integration-v6-20260719 -> 87afab1ce1df612f9f0e724b5eee9bc257c153ac
Current verification date: 2026-07-23
Development integration: pending; local sebastian contains approved commits on top of origin/development e4be3d9018e6f0bc9b41375fa4b490a1d500e107
New release tag for this local update: none
After the approved documentation commit, verify the exact HEAD with `git rev-parse HEAD`. After the approved push to origin/sebastian, local sebastian and origin/sebastian should match that documentation commit.
Always verify the actual branch, HEAD, divergence, working tree, and staged state before doing anything.

If the repository state differs, stop and report the exact difference.

2. Non-Negotiable Git Rules
Do not perform any of these actions without explicit approval for the exact action:

create or switch branches;

create, delete, repair, or prune worktrees;

use another clone;

stage files;

commit;

amend;

tag;

push or force-push;

merge;

rebase;

reset;

restore files;

cherry-pick.

All work must remain in:

C:\src\mhealth
Do not switch away from:

sebastian
When a local commit is proposed:

Report the exact files.

Recommend the exact commit subject.

Wait for approval.

Stage only the approved files.

Verify the staged list.

Create only the approved local commit.

Do not push or tag.

Push and tag approval are separate decisions.

Temporary tests or probes may be used for local validation, but they must be removed before review unless permanent test-file approval is explicitly granted.

3. Engineering Method
Work in short phases with explicit decision boundaries:

read-only audit
→ report findings
→ explain the problem in plain language
→ propose the smallest complete solution
→ wait for approval
→ implement only the approved slice
→ validate locally
→ report exact diff and Git state
→ wait for commit approval
→ create local commit only
→ wait separately for push or tag approval
Do not combine audit, implementation, commit, and push into one action.

Do not make unrelated cleanup changes.

Do not silently expand scope.

When a proposed “small” change starts becoming large, pause before continuing.

Complexity pause thresholds
Pause and explain the intended behavior before implementation when a change appears likely to require any of the following:

more than three production files;

roughly more than 50 changed lines for a narrow fix;

a migration;

a new abstraction;

a new dependency;

a new state-management mechanism;

changes across more than one feature boundary.

These are pause thresholds, not rigid line limits. Clear and correct code is more important than code golf.

Minimum-safe-change principles
Before writing code:

Understand the complete runtime flow.

Reuse an existing correct helper, repository, hook, or pattern.

Prefer the correct shared boundary over a visible-screen patch.

Do not add an abstraction that was not needed.

Prefer boring, explicit code over clever compression.

Preserve validation, patient isolation, provenance, error handling, and accessibility.

Fix the root cause, not only the symptom.

Do not reduce code size by making behavior harder to follow.

4. Product Objective
The target is one generic application pipeline that can import and consume any conforming single-patient FHIR R4 collection Bundle.

Conforming FHIR R4 collection Bundle
→ structural and reference validation
→ exact raw preservation
→ terminology-driven normalization
→ normalized SQLite repositories
→ patient-isolated application state
→ UI and services consume normalized records
→ raw FHIR used only for provenance or unsupported detail
→ missing and unsupported data represented honestly
→ no automatic mock or demo fallback
“Generic” means:

no patient-name checks;

no patient-ID checks;

no profile-filename checks;

no manifest-ID-based clinical behavior;

no fixture-name logic;

no resource-order assumptions;

no fabricated EHR information;

no automatic Demo data;

no silent production fallback to mock data;

no behavior that depends on one bundled patient.

Different patients may legitimately contain different resources and fields.

The goal is not to force every patient to have identical data.

The goal is for the same pipeline to handle:

available data;

missing data;

partial data;

unsupported data;

invalid optional fields;

unresolved detail;

without inventing values.

5. Canonical Runtime Profiles
Canonical runtime Bundles are under:

src/data/fhir/patient-profiles/
Profiles:

elena-garcia.json
james-okafor.json
sofia-reyes.json
mike-thompson.json
Patient IDs:

Elena Garcia   68250
James Okafor   68261
Sofia Reyes    68262
Mike Thompson  68263
Current canonical birth dates:

Elena Garcia   1954-06-01
James Okafor   1959-04-12
Sofia Reyes    2003-09-18
Mike Thompson  1994-12-11
Compatibility manifest IDs that must not be casually renamed:

Elena manifest ID: elena-gracia
Mike manifest ID:  mike-ehr-v62
The legacy Mike fixture is not the canonical runtime source.

Canonical Mike runtime source:

src/data/fhir/patient-profiles/mike-thompson.json
Do not modify canonical JSON merely to simplify application logic.

Modify source JSON only when the source value is actually wrong or inconsistent and the correction remains FHIR-conformant.

6. FHIR Bundle Contract
The runtime importer requires:

resourceType = "Bundle";

type = "collection";

exactly one Patient;

nonempty Patient.id;

resourceType on every resource;

unique entry.fullUrl;

no duplicate resourceType/id identities;

exact local-reference resolution;

owner-scoped contained-reference resolution.

Invalid Bundles must fail before database writes begin.

Reference behavior
Exact entry.fullUrl references may resolve even when the target resource has no resource.id.

Relative ResourceType/id references resolve only when the target has both:

resourceType;

id.

Do not synthesize resource IDs.

Contained references such as #contained-id resolve only inside the resource that owns that contained entry.

Do not make contained IDs globally resolvable.

Patient identity
The imported clinical patient identity comes from the validated Bundle’s single:

Patient.id
Do not use:

manifest ID;

filename;

UI selection ID;

fixture identity;

caller fallback;

as the imported clinical patient ID.

7. Raw FHIR Preservation
Every valid resource is preserved before normalization inside the same transaction.

Raw payload_json must remain the exact original FHIR resource object.

Do not inject application-only properties into raw resources.

Raw identity is:

resource.id, when present;

otherwise entry.fullUrl.

Resource type remains a separate identity dimension.

Unknown or unsupported valid resources remain raw-only instead of failing the Bundle.

Repeated imports update existing raw records rather than creating duplicate copies.

Raw and normalized writes are atomic.

A failure after writes begin must roll back the transaction.

Do not move raw preservation outside the transaction.

8. FHIR-to-Application Data Path
Canonical patient JSON
→ FHIR Bundle
→ validation
→ raw-resource preservation
→ supported resource normalization
→ SQLite repositories
→ PatientRecordContext
→ Home / Care / Profile / More / Settings / services
Runtime-source rule
Raw FHIR is for provenance, exact source inspection, and unsupported detail.

Normalized SQLite repositories are for application-understood data.

PatientRecordContext is the active patient’s fast runtime record.

Screens should not read raw Bundle data when a normalized representation exists.

Redux raw-FHIR state is legacy and should not become a new dependency.

Schedule currently has a separate raw-FHIR dependency owned by Rahal.

9. Resource-by-Resource Handling
Patient
FHIR fields used include:

Patient.id;

Patient.name;

Patient.birthDate;

supported demographics.

Normalized destination:

patients
Application usage:

active-patient identity;

name;

saved age;

patient isolation;

Home, Care, Profile, and More.

Current canonical profiles use full birth dates:

YYYY-MM-DD
The importer calculates and saves age generically from Patient.birthDate.

No patient-specific birth-date logic is permitted.

Observation: standard vital signs
Recognized only through exact LOINC coding:

system = http://loinc.org
The importer searches every coding[] entry and does not assume the first coding is relevant.

Normalized destination:

health_samples
Supported examples include:

heart rate;

blood pressure;

temperature;

oxygen saturation;

respiratory rate;

weight;

height;

BMI.

Blood-pressure component codings are also searched by exact LOINC system.

Wrong-system same-code values remain raw-only.

Observation: local rehabilitation and longitudinal data
James and Sofia local system:

https://access-dp.local/fhir/CodeSystem/custom-observations
Mike local system:

https://mhealth.local/fhir/CodeSystem/functional-observation
Recognized only through exact:

Coding.system + Coding.code
Destinations include:

rehabilitation_measurements
patient_longitudinal_observations
Examples include:

gait speed;

range of motion;

grip strength;

balance;

fatigue;

pain;

mobility;

hydration;

sleep;

urinary symptoms;

vomiting episodes.

Some source codes contain prefixes such as james-, sofia-, or mike-.

Those prefixes are source-code names, not application identity checks.

Any patient carrying the same valid system and code would normalize identically.

Do not infer that local codes are equivalent to standard codes without an approved mapping decision.

Condition
Standard systems currently recognized exactly:

ICD-10:
http://hl7.org/fhir/sid/icd-10

SNOMED CT:
http://snomed.info/sct
The importer searches all codings.

It does not assume the first coding is relevant.

Text-only conditions remain visible without inventing a code or system.

Normalized destination:

patient_conditions
Application usage includes:

condition list;

primary diagnosis;

comorbidities;

diagnosis-role settings.

Do not make clinical-code equivalence decisions without owner approval.

MedicationRequest
Normalized destination:

medications
Current profile content intentionally represents displayed medications as active.

Medication-status redesign is deferred unless an inactive or historical medication is observed in the active list.

Historical medication context may remain in raw medication-review Basic resources rather than becoming an active prescription.

Do not fabricate missing medication status.

CarePlan
Normalized destination:

care_plans
Used for:

Care cards;

rehabilitation planning;

plan activities;

exercise assignments;

referenced care-team display information.

Do not reinterpret CarePlan clinical semantics without an approved decision.

Goal
Standalone Goal resources remain raw unless used through an existing supported path.

Goal target measures using:

https://access-dp.local/fhir/CodeSystem/rehab-plan-metric
may normalize into:

care_plan_rehab_metrics
Supported metric examples include:

range of motion;

exercise repetitions;

adherence;

pain;

fatigue;

walking minutes.

Unsupported Goal detail remains raw.

Basic: patient timeline
Exact classification:

system:
https://mhealth.local/fhir/CodeSystem/curated-context

code:
patient-timeline-event
Normalized destination:

patient_timeline_events
Basic: patient care context
Exact classification:

system:
https://mhealth.local/fhir/CodeSystem/basic-resource-type

code:
patient-care-context-item
Normalized destination:

patient_care_context_items
Basic: medication-review context
Exact system:

https://mhealth.local/fhir/CodeSystem/review-resource
Supported codes include:

medication-review
short-course-medication-history
perioperative-medication-context
iv-fluid-context
rescue-reversal-medication-context
These resources remain in raw FHIR storage and may be read as medication-review candidates.

They are not automatically treated as active prescriptions.

Do not classify Basic resources from code.text.

DocumentReference
Preserved raw.

Currently intentionally raw-only.

Do not claim document normalization when no normalized path exists.

ServiceRequest
Preserved raw.

Currently intentionally raw-only unless referenced through an already-supported CarePlan activity path.

RelatedPerson
Preserved raw.

FHIR import does not automatically turn RelatedPerson into the application caregiver.

Caregiver information may come from explicit onboarding or Demo data.

Practitioner
Standalone resources remain raw.

Practitioner references may be resolved generically for CarePlan display information.

CareTeam
Preserved raw.

No general normalized CareTeam repository currently exists.

Procedure, Encounter, Organization, Provenance
Preserved raw unless a specific supported importer path consumes part of the resource.

Do not fabricate normalized equivalents.

10. Terminology Rules
Matching priority:

exact Coding.system + Coding.code;

explicitly approved alias or ConceptMap;

explicit local-code registry;

unsupported raw-only.

Do not:

match clinical destinations from patient identity;

assume coding order;

match a familiar code under the wrong system;

invent code equivalence;

use display text to make an unapproved clinical decision;

normalize unsupported content merely because it looks similar.

Display text may be used as a label when the underlying clinical selection is already established safely.

11. Missing and Unsupported Data
Optional missing FHIR data must remain unavailable or omitted.

Do not replace missing information with:

0;

false;

the current time;

"normal";

"active";

"confirmed";

a default provider;

a default caregiver;

a Demo threshold;

a placeholder age;

synthetic readiness;

a patient-specific placeholder.

Missing, unsupported, stale, partial, and invalid are different states.

When a normalized destination cannot safely represent the source:

Preserve the original FHIR resource.

Keep it raw-only.

Report why normalization was skipped.

Continue with other valid resources when safe.

12. Observation Timestamps
Do not use the import clock as a missing clinical timestamp.

Current behavior:

effectiveDateTime is supported;

effectivePeriod.start is used when present;

effectivePeriod.end is used when start is absent;

issued is not silently treated as measurement time;

no usable effective time means raw-only;

no normalized sample is created;

missing effective time is reported.

Do not restore:

effectiveDateTime ?? new Date().toISOString()
13. EHR and Demo Separation
The UI has two intentionally different actions.

Import EHR only
This action:

imports the selected FHIR Bundle;

selects the imported patient;

preserves and normalizes supported EHR resources;

does not apply Demo onboarding presets;

does not invent caregiver, provider, safety, routine, threshold, or onboarding facts.

After EHR-only import, empty onboarding fields are intentional.

Demo data
Demo data requires explicit user action.

It may populate application-owned values such as:

caregiver information;

provider information;

routines;

safety information;

thresholds;

onboarding configuration.

Demo values must not be presented as EHR-derived.

For now, where EHR and onboarding can update the same application value, the latest deliberate update wins.

Do not automatically apply Demo data during FHIR import.

14. State Architecture
The application has four relevant state layers.

Local component state
Use for:

temporary UI interaction;

modal state;

typed input;

screen-only loading state;

values not shared across screens.

PatientRecordContext
Use for:

normalized active-patient data shared across screens;

patient-specific persisted runtime values;

conditions;

medications;

care plans;

daily care;

rehabilitation;

patient-specific settings;

derived active-patient views.

It answers:

What is the current selected patient’s connected application record?

Redux
Use for:

broad runtime state;

streaming or event-driven state;

live vitals;

legacy raw FHIR Bundle state;

global slices not naturally part of one patient snapshot.

Do not move all patient data into Redux merely to solve a local state problem.

SQLite
Use for durable persistence across app restarts.

SQLite is the saved copy.

In-memory state is the fast working copy.

15. Patient Selection and Refresh Invariant
Patient selection and patient refresh are separate operations.

Selection
setPatientId(patientId)
→ persist active_patient_id
→ load the selected patient snapshot
→ publish that patient
Only explicit selection may change the active patient.

Refresh
refreshPatientRecord(patientId?)
→ refresh only the currently active patient
→ ignore a stale request for another patient
→ never change active_patient_id
A stale background callback for Mike must not overwrite James after James becomes active.

Do not weaken this invariant.

16. Patient Snapshot
getPatientRecordSnapshot(patientId) assembles a broad active-patient record.

It may include:

patient;

caregiver;

conditions;

medications;

medication-review candidates;

symptoms;

wearable data;

thresholds;

care plans;

rehabilitation metrics;

exercise assignments;

today’s daily-care entry;

daily-care history;

UC3 and UC4 data;

care context;

timeline;

goals;

knowledge statistics;

enrichment statistics;

bundle status.

A complete snapshot reload is appropriate for:

startup;

patient switching;

FHIR import;

external/background writes;

explicit full refresh;

necessary post-bundler reconciliation.

It should not be the default response to one checkbox or small row update.

17. State-First SQLite Write Contract
For ordinary patient-specific interactions, use:

user action
→ update PatientRecord state immediately
→ UI responds immediately
→ persist only the affected SQLite row
→ success: keep the state
→ failure: roll back the affected state
→ no full PatientRecordSnapshot reload
The current shared helper is:

mutatePatientRecord(updateLatestSnapshot, persist)
Its responsibilities:

calculate from the latest active-patient snapshot;

publish the update immediately;

execute the existing repository write;

roll back safely when persistence fails;

prevent an older failed write from undoing a newer success;

prevent old in-flight work from updating another patient after a switch;

avoid full snapshot and live-vitals hydration after a successful small write.

Current converted interactions
State-first behavior is implemented for:

completed exercises in Care;

medication confirmation selections;

diagnosis-role and primary-diagnosis selection;

UC3 exercise assignments.

Do new features have to use it?
No.

Use mutatePatientRecord(...) only when:

the value belongs to the active patient;

it is shared across screens or services;

it must persist to SQLite;

the UI should update immediately;

rollback is needed on failure.

Use local component state for screen-only temporary data.

Use a full snapshot refresh for broad context changes.

Use Redux for global or streaming runtime state.

18. Rapid-Write Safety
Replacement arrays must calculate from the latest runtime state.

Unsafe behavior:

tap A reads []
tap B reads []
write A saves [A]
write B saves [B]
A is lost
Required behavior:

tap A updates state to [A]
tap B reads [A]
tap B updates state to [A, B]
writes persist in order
Rollback must not undo a later successful mutation.

A mutation for one patient must not publish or roll back another patient after switching.

19. Performance Rules
The older smooth interaction pattern was:

save one row
→ update one screen or shared state value
The slow pattern was:

save one row
→ reload nearly every patient repository
→ hydrate live vitals
→ rerender
The current application snapshot is larger than the older rahal-dev snapshot because the application now includes rehabilitation, UC3, UC4, timeline, care context, and knowledge data.

Therefore:

keep the richer snapshot;

do not rebuild it after every small write;

convert only observed slow interactions;

do not rewrite every handler automatically.

When comparing with origin/rahal-dev, reuse safe behavior conceptually.

Do not restore complete files wholesale.

20. Background Work
Condition and evidence bundling may continue after FHIR import.

Background work may write its own records.

When it completes:

it may reconcile the currently active patient;

a stale completion for another patient must be ignored;

it must never change the active patient.

MedlinePlus DNS or network errors are separate evidence/network findings.

They must not change patient selection.

Partial evidence completeness semantics belong to Ethan.

21. Ownership Boundaries
Sebastian / application team
Owns:

FHIR importer;

reference validation;

terminology plumbing;

repositories;

persistence;

state management;

patient isolation;

missing-data UI;

EHR/Demo separation;

provenance display;

generic application integration.

Jay
Owns:

UC2;

UC3;

UC4;

thresholds;

model imputation;

clinical feature interpretation;

clinical equivalence decisions used by models.

Do not change clinical model behavior without Jay’s decision.

Ethan
Owns:

SLM;

Concierge;

evidence retrieval;

evidence orchestration;

related provenance;

evidence fallback and completeness behavior.

Rahal
Owns:

wearable pipeline;

scheduling;

Athena sandbox behavior;

remote/local appointment semantics.

Do not modify scheduling, Athena, or wearable behavior during FHIR normalization work.

22. Production Fallback Policy
No production feature may silently substitute:

mock data;

local fixture output;

synthetic output;

cached data presented as current;

default values presented as authoritative;

Demo results presented as EHR or external-system success.

Verified success
authoritative operation succeeds;

response is validated;

required persistence succeeds;

success is shown accurately.

Partial success
state exactly what succeeded;

state exactly what failed;

do not collapse partial success into full success.

Failure
do not fabricate a result;

show an honest error;

preserve recoverable input;

support retry where appropriate.

Dependency unavailable
show unavailable;

do not manufacture output;

do not claim that the external system succeeded.

Explicit Demo or developer behavior may remain only when it is:

intentionally activated;

clearly labeled;

provenance-aware;

impossible to confuse with authoritative data.

23. Current Verified Genericity Status
The current baseline has no active FHIR import/runtime branch that checks:

patient names;

Patient IDs;

profile filenames;

manifest IDs.

Current generic terminology behavior includes:

LOINC vital observations matched by exact system and code;

local rehabilitation/longitudinal observations matched by exact local system and code;

local Basic classifications matched by exact system and code;

ICD-10 and SNOMED conditions matched by exact system and code;

text-only conditions preserved without fabricated coding.

Current intentionally raw-only areas include:

DocumentReference;

standalone ServiceRequest;

RelatedPerson;

standalone CareTeam;

unsupported Goal detail;

other unsupported valid resources.

The verified conclusion is:

PHASE_2B_GENERIC_RUNTIME_BASELINE_COMPLETE
This does not mean every FHIR resource is normalized.

It means the current supported runtime path is generic and unsupported detail is preserved honestly.

Post-integration runtime and UI state
The canonical UC3 and UC4 production runtime paths remain:

src/services/uc3/uc3EvaluationService.ts
src/services/uc4/uc4EvaluationService.ts
The unused alternate UC3 and UC4 runtime services, the incompatible alternate UC4 repositories, and the alternate UC4 snapshot adapter have been removed. This cleanup did not redesign UC3 or UC4 clinical semantics.

Data and orchestration corrections now present on development:

shared data exports use the canonical filename casing;

the active ADCP snapshot type supports the real seed:restore source;

canonical orchestration event contracts match active UC3 and UC4 publishers;

ADCP condition indexing omits missing, null, empty, and literal null or undefined condition metadata honestly.

Care tab presentation now:

organizes daily caregiver tasks more clearly;

uses compact care-plan, Therapy, Goals & activities, and medication-watch summaries;

places priorities and Therapy before secondary plan information;

uses caregiver-facing proposal wording;

preserves the same UC3, UC4, ADCP, persistence, and patient-scoped behavior.

Home presentation now groups care-related cards under Today's care with consistent formatting and left-aligned existing icons or images.

Approved Sebastian UI/onboarding updates now present locally on sebastian:

Care Plan hero alignment now uses balanced horizontal gutters while preserving the lower timeline layout. The Care spine anchor, status dots, and connector ticks remain tied to one shared spine position aligned with the hero socket/card-frame anchor.

Tab chrome and More access now use the shared header structure consistently, and the complete More screen remains reachable from the Home header while hidden from the visible bottom tab bar.

Patient onboarding can import the selected canonical EHR Bundle directly from the Patient section without reopening the profile selector. Imported full name, age, conditions, current medications, SpO2 cutoff, and baseline heart rate remain sourced from normalized EHR data when present; preferred name and unsupported fields remain manual. Completing onboarding for an imported patient reselects and refreshes that imported Patient.id without calling the Demo seeder, replacing raw FHIR, deleting imported clinical rows, deleting care plans, or changing bundle status.

The More-tab Import EHR selector uses the shared bundled-EHR import hook. Ordinary EHR import remains EHR-only. The explicit Demo action applies the selected Demo onboarding preset to the imported patient and forwards the manual Demo SpO2 cutoff and baseline heart-rate values only when present, preserving existing EHR values when the Demo preset is blank.

Synthetic Demo onboarding values are now present only for explicit Demo use: James 94% and 70-90 BPM; Sofia 95% and 75-100 BPM; Mike 92% and 60-100 BPM. Elena continues to receive 87% and 68-82 BPM only from EHR import.

Permanent selector coverage lives outside the Expo Router route directory at `src/__tests__/select-fhir-profile.test.tsx`; no test or spec file should live under `src/app`.

24. Known Deferred Decisions
Do not automatically implement these without a new audit or owner decision:

MedicationRequest status redesign;

diagnosis presentation heuristics;

provider/caregiver overlap between FHIR and onboarding;

DocumentReference normalization;

ServiceRequest normalization;

RelatedPerson caregiver mapping;

CareTeam repository design;

exact evidence completeness semantics;

MedlinePlus network behavior;

scheduling/Athena success semantics;

model fallback and imputation decisions;

remaining database-backed UI responsiveness issues not observed manually;

medication watch areas are currently produced by a hardcoded medication-name mapping rather than Ethan's RAG/evidence layer;

only mapped watch-area codes consumed by Jay's UC4 rules affect UC4 decisions;

ADCP field-level provenance remains incomplete;

Goals & activities still mixes normalized clinical context and ADCP-related presentation;

migration-history cleanup remains separate work;

future UC4 structured-response persistence remains separate work;

logging privacy remains a Rahal/security release concern.

25. Testing and Validation Policy
Do not run broad test suites after every prompt.

Read-only audit
no tests required;

use source inspection and current runtime evidence.

Small implementation
Run:

TypeScript check;

git diff --check;

one focused existing test or temporary probe;

targeted manual runtime verification where needed.

Shared/core logic
Add focused checks for:

direct callers;

rollback;

patient switching;

stale async completion;

persistence;

no unintended full refresh.

Before local commit
Run only the relevant stable checks plus type check.

Before push or integration milestone
Run a broader suite when appropriate.

Do not delete permanent tests merely because they are stale.

Report stale test expectations separately.

26. Required AI Behavior
Before implementation, an AI assistant must:

Read this file fully.

Verify repository state.

Explain the observed problem in plain language.

Trace the real runtime flow.

Distinguish source-data problems from application problems.

Distinguish patient-specific content from patient-specific code.

Propose the smallest complete solution.

List exact files and estimated scope.

Pause when complexity thresholds are crossed.

Wait for approval.

After implementation, the AI must report:

initial Git state;

exact behavior changed;

exact files changed;

why every file was necessary;

validation commands and results;

temporary files created and removed;

exact git diff --stat;

exact final git status;

recommended commit subject;

confirmation that nothing was staged, committed, tagged, or pushed unless explicitly authorized.

Do not claim manual runtime behavior was verified when only source inspection was performed.

Do not call a theoretical concern a production defect without evidence.

27. Plain-Language Change Template
For every proposed change, answer:

Problem
What does the user currently see?

Expected behavior
What should happen instead?

Root cause
Where does the connection break?

Smallest solution
What exact behavior will change?

Files
Which files are necessary and why?

Complexity
Does it exceed:

three files;

roughly 50 lines;

one feature boundary;

a migration;

a new abstraction?

Validation
What is the smallest check proving it works?

28. Golden Invariants
Never violate these:

Every patient goes through the same FHIR pipeline.

Patient identity never selects clinical normalization behavior.

Exact system + code is the default terminology rule.

Unsupported valid FHIR remains raw-only.

Raw FHIR is preserved exactly and transactionally.

Missing data is never fabricated.

EHR-only import never applies Demo onboarding facts.

Only explicit selection changes the active patient.

Refresh never selects another patient.

A snapshot is published only for the active patient.

Small patient-specific writes update runtime state first and persist only the affected row.

Full snapshots are reserved for broad patient-context changes.

Persistence failures are reported and optimistic state is rolled back safely.

No production mock or synthetic fallback is presented as authoritative.

No cross-owner clinical decision is implemented without owner approval.

No Git mutation occurs without exact approval.

29. Current Notable Local Commits
Known recent local commits include:

fc7f0fc  Integrated EHR import into patient onboarding
9fdc432  Aligned Care hero card and timeline spine
f64a219  Fix secure messaging export casing
3df815a  Normalize tab chrome and More access
797502b  Show pending review items on dashboard

a70174a6  fix(fhir): populate patient age from birth date
dc105f03  fix(fhir): correct Elena and James birth dates
8c65223e  fix(fhir): qualify vital observations by LOINC system
5fc8ff3f  fix(fhir): qualify local observations by coding system
8cbb01cc  fix(fhir): qualify Basic resources by coding system
59fbfa60  fix(state): prevent stale refreshes from switching patients
72d35e3b  perf(state): update completed exercises without full refresh
4417beae  perf(state): update patient settings without full refresh
3459ef59  fix(fhir): qualify condition codings by system
These commits and later release commits have been published to origin/development under mhealth-generic-fhir-integration-v6-20260719.

The following rebased commits are now present on origin/development after the 2026-07-22 fast-forward integration:

64f5945  fix(data): align exports and ADCP restore source
59516d4  fix(orchestration): align active UC event contracts
0ac5541  Removed unused UC3 and UC4 code paths
cf4a598  Improved the Care tab daily workflow
638fcd5  Compacted the care plan, goals, and therapy summaries
0bea8bc  Organized care cards under Today's care
These commit SHAs are the rebased versions now present on development.

Always verify actual history before relying on this list.

30. Final Architecture Summary
FHIR source
→ generic validation
→ exact raw preservation
→ exact terminology-based normalization
→ patient-scoped SQLite repositories
→ active-patient PatientRecordContext
→ responsive UI and services
→ state-first small writes
→ SQLite persistence
→ safe rollback
→ full reload only for real context changes
The system should behave the same regardless of which patient is selected.

Patients may contain different information.

The application logic must remain generic.

31. Current Release State
This documentation state was last updated on 2026-07-23 after the approved local Sebastian UI and onboarding commits, before the authorized push to origin/sebastian.

Local branch: sebastian
Local implementation HEAD before this documentation commit: fc7f0fc13db6e6fb82676c2fd0b221e0b7e6ab66
Remote development SHA: e4be3d9018e6f0bc9b41375fa4b490a1d500e107
Remote sebastian SHA before approved push: 0bea8bc15e2deefd36c8222005ebbd12c6d02167
Remote sebastian after approved push: expected to match the `Updated current integration state` documentation commit; verify the exact SHA with `git rev-parse origin/sebastian` after push.
Latest historical tag: mhealth-generic-fhir-integration-v6-20260719 -> 87afab1ce1df612f9f0e724b5eee9bc257c153ac
New release tag created for 2026-07-23 local update: no
Local versus origin/development before documentation commit: 0 behind, 5 ahead
Local versus origin/sebastian before approved push: 0 behind, 12 ahead
Expected working tree before documentation edit: clean
Expected working tree after documentation commit and push: clean
Current verification date: 2026-07-23
Next priorities:

Run a fresh read-only audit before any development integration, rebase, merge, origin/development push, or release tag.

Review wearable integration and patient isolation.

Validate remaining UC2-UC4 behavior, testing, thresholds, and imputation questions.

Validate SLM, Concierge, and evidence behavior after rebasing from development.

Keep migration-history cleanup and future UC4 structured-response persistence as separate work.

Run broader integration testing before the next tagged push.

32. Codex-Guided Integration and Change Protocol
This protocol governs work after new commits land on origin/development, including Ethan-owned SLM, Concierge, evidence, orchestration, or provenance changes.

Roles and decision boundary
ChatGPT acts as the senior architecture and UI/UX reviewer.

Codex acts as the repository audit and implementation agent inside C:\src\mhealth.

The user remains the decision-maker for every Git mutation, conflict resolution, implementation slice, commit, push, and tag.

ChatGPT first writes a phase-specific Codex prompt.

Codex returns evidence, exact commands or files, risks, discrepancies, and unanswered questions.

ChatGPT reviews the response against this contract and the user's latest input.

Work proceeds only after the user approves the exact next action.

Do not combine audit, rebase, implementation, validation, commit, push, or tagging into one prompt or action.

Ponytail minimum-change ladder
After tracing the real runtime flow, stop at the first option that safely solves the task:

Do not build the change when it is unnecessary.

Reuse an existing correct helper, repository, hook, component, screen pattern, or service path.

Use the standard library when it already provides the behavior.

Use a native platform capability when it already provides the behavior.

Use an already-installed dependency when it is the smallest correct option.

Use a direct, explicit change when one line or one local edit is sufficient.

Only then write the minimum new code that completely solves the problem.

The shortest correct diff wins only after the existing behavior and runtime flow are understood. Never reduce validation, patient isolation, rollback safety, provenance, error handling, security, accessibility, or required hardware calibration merely to reduce code.

Architecture and UI/UX constraints
Preserve actual runtime and clinical behavior unless the user explicitly approves a behavior change.

Fix root causes at the correct shared boundary rather than patching one visible symptom.

Prefer modifying an existing feature path over adding a parallel path.

Do not create speculative refactors, wrappers, factories, interfaces, abstractions, configuration, dependencies, state mechanisms, or files.

Do not rename, relocate, or restyle unrelated code.

Do not reinterpret clinical semantics or cross an ownership boundary without the responsible owner's decision.

Preserve established UI hierarchy, interaction semantics, accessibility, patient scoping, persistence, and failure behavior.

A UI/UX improvement must reuse the existing design language and must not silently change data meaning, workflow order, or success semantics.

When evidence is incomplete or conflicting, stop and request a decision instead of inventing an answer.

Required rebase workflow
Ethan's new work on origin/development must be integrated before additional feature work begins.

Phase A — read-only preflight
Codex must:

Read this entire file.

Work only in C:\src\mhealth.

Verify the current branch, local HEAD, remote refs, divergence, worktree status, staged state, untracked files, and any in-progress Git operation.

Fetch remote metadata without rebasing, merging, resetting, restoring, staging, committing, pushing, or tagging.

Identify the commits newly present on origin/development and summarize their changed files and ownership areas.

Compare sebastian with origin/development and report the exact commits that would be replayed.

Predict likely conflict areas from overlapping changed files and runtime boundaries.

Report discrepancies and stop. Do not perform the rebase during preflight.

Phase B — approved rebase
Only after explicit approval for the exact command, Codex may rebase the existing local sebastian branch onto the verified origin/development tip.

Do not create or switch branches.

Do not use another clone or worktree.

Do not merge instead of rebase.

Do not use --onto, interactive rebase, autosquash, reset, force, or automatic conflict strategies unless separately approved.

If a conflict occurs, stop immediately after reporting the exact files and conflict stages.

Explain each side's intended behavior and propose the smallest behavior-preserving resolution.

Do not edit conflict files or continue the rebase until the resolution is approved.

Phase C — post-rebase validation
After a clean approved rebase, Codex must report:

old and new base SHAs;

rewritten local commit mapping, when applicable;

exact commits added from origin/development;

exact files affected by conflict resolution, or confirmation that there were no conflicts;

focused type checks, stable tests, git diff --check, and any necessary targeted runtime verification;

exact final branch, HEAD, divergence, worktree, staged state, and untracked state;

confirmation that no commit, push, tag, branch change, reset, or unrelated edit occurred beyond the approved rebase operation.

Push, tag, and any follow-on implementation remain separate decisions.

Codex response standard
Every Codex response must separate verified facts from inferences and use this structure:

Repository state

New development commits

Observed behavior and runtime boundaries

Rebase risk and likely conflicts

Smallest safe next action

Exact commands proposed

Files that may require review

Validation plan

Questions or discrepancies

Actions performed

For read-only phases, Actions performed must explicitly confirm that no files or Git history were changed.

Initial Codex prompt: development rebase preflight
You are performing a read-only integration preflight for the mHealth repository.

Read CURRENT_STATE.md fully before doing anything. Treat it as the governing architecture, ownership, workflow, and Git contract.

Context:
- Work only in C:\src\mhealth.
- Remain on the existing sebastian branch.
- Ethan has reportedly pushed new changes to origin/development.
- We expect to rebase sebastian onto the latest verified origin/development, but the rebase is NOT authorized in this phase.
- Preserve all actual application, clinical, persistence, state, accessibility, and UI behavior.
- Follow the Ponytail minimum-change approach: understand the real flow first; reuse existing code and platform capabilities; avoid new abstractions, dependencies, parallel paths, refactors, and unnecessary complexity.

Perform only a read-only preflight:
1. Show the current directory and prove it is C:\src\mhealth.
2. Verify the current branch, HEAD, worktree, staged files, untracked files, and whether any merge/rebase/cherry-pick/revert/bisect is in progress.
3. Fetch origin so remote refs are current. Do not pull, merge, rebase, reset, restore, stage, commit, push, tag, create/switch branches, or edit files.
4. Report the exact SHAs for HEAD, origin/sebastian, and origin/development and the ahead/behind counts among them.
5. List the commits newly present on origin/development since the documented baseline 0bea8bc15e2deefd36c8222005ebbd12c6d02167. Identify which appear to be Ethan's changes from verified commit metadata; do not guess authorship from file names.
6. Summarize the changed files and functional areas in those commits, especially SLM, Concierge, evidence retrieval/orchestration, provenance, patient isolation, shared state, UI, and any overlapping files touched by local sebastian commits.
7. Determine the exact local commits that a normal `git rebase origin/development` would replay.
8. Identify likely conflict files and explain the behavior on both sides. Do not propose broad refactors; propose only behavior-preserving conflict principles.
9. Check whether the documented CURRENT_STATE snapshot is now stale and list every field that must be updated after a successful rebase.
10. Stop and return the report. Do not perform the rebase or modify CURRENT_STATE.md.

Use this response format:
Repository state
New development commits
Changed files and ownership boundaries
Local commits that would be replayed
Likely conflicts and behavior risks
Smallest safe next action
Exact rebase command proposed, but not executed
Post-rebase validation plan
Questions or discrepancies
Actions performed

In Actions performed, explicitly confirm that no files, index state, commits, branches, tags, or remote refs were changed except the remote-tracking updates produced by `git fetch origin`.


Library
/
CURRENT_STATE.md


mHealth System Architecture and Engineering Contract
Purpose: This is the single read-first operating contract for AI-assisted work on the mHealth application.
Give this file to Codex, ChatGPT, or another engineer before asking for audits, design changes, or implementation.

Authority: Treat this document as the governing architecture and workflow contract.
When code and this document appear to disagree, stop, report the discrepancy, and ask for a decision. Do not guess.

2026-07-23 local state notice: sebastian contains approved local UI and onboarding commits on top of origin/development e4be3d9018e6f0bc9b41375fa4b490a1d500e107. Development integration, merge/rebase work, and release tagging remain separate later decisions. This documentation update is approved for a local commit and push only to origin/sebastian; it does not authorize pushing to origin/development, rebasing, merging, tagging, force-pushing, or changing the preservation stash.

1. Repository Snapshot
This snapshot was last verified on 2026-07-23.

Repository: C:\src\mhealth
Required branch: sebastian
Local branch: sebastian
Local implementation HEAD before this documentation commit: fc7f0fc13db6e6fb82676c2fd0b221e0b7e6ab66
Remote development SHA: e4be3d9018e6f0bc9b41375fa4b490a1d500e107
Remote sebastian SHA before approved push: 0bea8bc15e2deefd36c8222005ebbd12c6d02167
Local versus origin/development before documentation commit: 0 behind, 5 ahead
Local versus origin/sebastian before approved push: 0 behind, 12 ahead
Expected working tree before documentation edit: clean
Latest pushed tag: mhealth-generic-fhir-integration-v6-20260719 -> 87afab1ce1df612f9f0e724b5eee9bc257c153ac
Current verification date: 2026-07-23
Development integration: pending; local sebastian contains approved commits on top of origin/development e4be3d9018e6f0bc9b41375fa4b490a1d500e107
New release tag for this local update: none
After the approved documentation commit, verify the exact HEAD with `git rev-parse HEAD`. After the approved push to origin/sebastian, local sebastian and origin/sebastian should match that documentation commit.
Always verify the actual branch, HEAD, divergence, working tree, and staged state before doing anything.

If the repository state differs, stop and report the exact difference.

2. Non-Negotiable Git Rules
Do not perform any of these actions without explicit approval for the exact action:

create or switch branches;

create, delete, repair, or prune worktrees;

use another clone;

stage files;

commit;

amend;

tag;

push or force-push;

merge;

rebase;

reset;

restore files;

cherry-pick.

All work must remain in:

C:\src\mhealth
Do not switch away from:

sebastian
When a local commit is proposed:

Report the exact files.

Recommend the exact commit subject.

Wait for approval.

Stage only the approved files.

Verify the staged list.

Create only the approved local commit.

Do not push or tag.

Push and tag approval are separate decisions.

Temporary tests or probes may be used for local validation, but they must be removed before review unless permanent test-file approval is explicitly granted.

3. Engineering Method
Work in short phases with explicit decision boundaries:

read-only audit
→ report findings
→ explain the problem in plain language
→ propose the smallest complete solution
→ wait for approval
→ implement only the approved slice
→ validate locally
→ report exact diff and Git state
→ wait for commit approval
→ create local commit only
→ wait separately for push or tag approval
Do not combine audit, implementation, commit, and push into one action.

Do not make unrelated cleanup changes.

Do not silently expand scope.

When a proposed “small” change starts becoming large, pause before continuing.

Complexity pause thresholds
Pause and explain the intended behavior before implementation when a change appears likely to require any of the following:

more than three production files;

roughly more than 50 changed lines for a narrow fix;

a migration;

a new abstraction;

a new dependency;

a new state-management mechanism;

changes across more than one feature boundary.

These are pause thresholds, not rigid line limits. Clear and correct code is more important than code golf.

Minimum-safe-change principles
Before writing code:

Understand the complete runtime flow.

Reuse an existing correct helper, repository, hook, or pattern.

Prefer the correct shared boundary over a visible-screen patch.

Do not add an abstraction that was not needed.

Prefer boring, explicit code over clever compression.

Preserve validation, patient isolation, provenance, error handling, and accessibility.

Fix the root cause, not only the symptom.

Do not reduce code size by making behavior harder to follow.

4. Product Objective
The target is one generic application pipeline that can import and consume any conforming single-patient FHIR R4 collection Bundle.

Conforming FHIR R4 collection Bundle
→ structural and reference validation
→ exact raw preservation
→ terminology-driven normalization
→ normalized SQLite repositories
→ patient-isolated application state
→ UI and services consume normalized records
→ raw FHIR used only for provenance or unsupported detail
→ missing and unsupported data represented honestly
→ no automatic mock or demo fallback
“Generic” means:

no patient-name checks;

no patient-ID checks;

no profile-filename checks;

no manifest-ID-based clinical behavior;

no fixture-name logic;

no resource-order assumptions;

no fabricated EHR information;

no automatic Demo data;

no silent production fallback to mock data;

no behavior that depends on one bundled patient.

Different patients may legitimately contain different resources and fields.

The goal is not to force every patient to have identical data.

The goal is for the same pipeline to handle:

available data;

missing data;

partial data;

unsupported data;

invalid optional fields;

unresolved detail;

without inventing values.

5. Canonical Runtime Profiles
Canonical runtime Bundles are under:

src/data/fhir/patient-profiles/
Profiles:

elena-garcia.json
james-okafor.json
sofia-reyes.json
mike-thompson.json
Patient IDs:

Elena Garcia   68250
James Okafor   68261
Sofia Reyes    68262
Mike Thompson  68263
Current canonical birth dates:

Elena Garcia   1954-06-01
James Okafor   1959-04-12
Sofia Reyes    2003-09-18
Mike Thompson  1994-12-11
Compatibility manifest IDs that must not be casually renamed:

Elena manifest ID: elena-gracia
Mike manifest ID:  mike-ehr-v62
The legacy Mike fixture is not the canonical runtime source.

Canonical Mike runtime source:

src/data/fhir/patient-profiles/mike-thompson.json
Do not modify canonical JSON merely to simplify application logic.

Modify source JSON only when the source value is actually wrong or inconsistent and the correction remains FHIR-conformant.

6. FHIR Bundle Contract
The runtime importer requires:

resourceType = "Bundle";

type = "collection";

exactly one Patient;

nonempty Patient.id;

resourceType on every resource;

unique entry.fullUrl;

no duplicate resourceType/id identities;

exact local-reference resolution;

owner-scoped contained-reference resolution.

Invalid Bundles must fail before database writes begin.

Reference behavior
Exact entry.fullUrl references may resolve even when the target resource has no resource.id.

Relative ResourceType/id references resolve only when the target has both:

resourceType;

id.

Do not synthesize resource IDs.

Contained references such as #contained-id resolve only inside the resource that owns that contained entry.

Do not make contained IDs globally resolvable.

Patient identity
The imported clinical patient identity comes from the validated Bundle’s single:

Patient.id
Do not use:

manifest ID;

filename;

UI selection ID;

fixture identity;

caller fallback;

as the imported clinical patient ID.

7. Raw FHIR Preservation
Every valid resource is preserved before normalization inside the same transaction.

Raw payload_json must remain the exact original FHIR resource object.

Do not inject application-only properties into raw resources.

Raw identity is:

resource.id, when present;

otherwise entry.fullUrl.

Resource type remains a separate identity dimension.

Unknown or unsupported valid resources remain raw-only instead of failing the Bundle.

Repeated imports update existing raw records rather than creating duplicate copies.

Raw and normalized writes are atomic.

A failure after writes begin must roll back the transaction.

Do not move raw preservation outside the transaction.

8. FHIR-to-Application Data Path
Canonical patient JSON
→ FHIR Bundle
→ validation
→ raw-resource preservation
→ supported resource normalization
→ SQLite repositories
→ PatientRecordContext
→ Home / Care / Profile / More / Settings / services
Runtime-source rule
Raw FHIR is for provenance, exact source inspection, and unsupported detail.

Normalized SQLite repositories are for application-understood data.

PatientRecordContext is the active patient’s fast runtime record.

Screens should not read raw Bundle data when a normalized representation exists.

Redux raw-FHIR state is legacy and should not become a new dependency.

Schedule currently has a separate raw-FHIR dependency owned by Rahal.

9. Resource-by-Resource Handling
Patient
FHIR fields used include:

Patient.id;

Patient.name;

Patient.birthDate;

supported demographics.

Normalized destination:

patients
Application usage:

active-patient identity;

name;

saved age;

patient isolation;

Home, Care, Profile, and More.

Current canonical profiles use full birth dates:

YYYY-MM-DD
The importer calculates and saves age generically from Patient.birthDate.

No patient-specific birth-date logic is permitted.

Observation: standard vital signs
Recognized only through exact LOINC coding:

system = http://loinc.org
The importer searches every coding[] entry and does not assume the first coding is relevant.

Normalized destination:

health_samples
Supported examples include:

heart rate;

blood pressure;

temperature;

oxygen saturation;

respiratory rate;

weight;

height;

BMI.

Blood-pressure component codings are also searched by exact LOINC system.

Wrong-system same-code values remain raw-only.

Observation: local rehabilitation and longitudinal data
James and Sofia local system:

https://access-dp.local/fhir/CodeSystem/custom-observations
Mike local system:

https://mhealth.local/fhir/CodeSystem/functional-observation
Recognized only through exact:

Coding.system + Coding.code
Destinations include:

rehabilitation_measurements
patient_longitudinal_observations
Examples include:

gait speed;

range of motion;

grip strength;

balance;

fatigue;

pain;

mobility;

hydration;

sleep;

urinary symptoms;

vomiting episodes.

Some source codes contain prefixes such as james-, sofia-, or mike-.

Those prefixes are source-code names, not application identity checks.

Any patient carrying the same valid system and code would normalize identically.

Do not infer that local codes are equivalent to standard codes without an approved mapping decision.

Condition
Standard systems currently recognized exactly:

ICD-10:
http://hl7.org/fhir/sid/icd-10

SNOMED CT:
http://snomed.info/sct
The importer searches all codings.

It does not assume the first coding is relevant.

Text-only conditions remain visible without inventing a code or system.

Normalized destination:

patient_conditions
Application usage includes:

condition list;

primary diagnosis;

comorbidities;

diagnosis-role settings.

Do not make clinical-code equivalence decisions without owner approval.

MedicationRequest
Normalized destination:

medications
Current profile content intentionally represents displayed medications as active.

Medication-status redesign is deferred unless an inactive or historical medication is observed in the active list.

Historical medication context may remain in raw medication-review Basic resources rather than becoming an active prescription.

Do not fabricate missing medication status.

CarePlan
Normalized destination:

care_plans
Used for:

Care cards;

rehabilitation planning;

plan activities;

exercise assignments;

referenced care-team display information.

Do not reinterpret CarePlan clinical semantics without an approved decision.

Goal
Standalone Goal resources remain raw unless used through an existing supported path.

Goal target measures using:

https://access-dp.local/fhir/CodeSystem/rehab-plan-metric
may normalize into:

care_plan_rehab_metrics
Supported metric examples include:

range of motion;

exercise repetitions;

adherence;

pain;

fatigue;

walking minutes.

Unsupported Goal detail remains raw.

Basic: patient timeline
Exact classification:

system:
https://mhealth.local/fhir/CodeSystem/curated-context

code:
patient-timeline-event
Normalized destination:

patient_timeline_events
Basic: patient care context
Exact classification:

system:
https://mhealth.local/fhir/CodeSystem/basic-resource-type

code:
patient-care-context-item
Normalized destination:

patient_care_context_items
Basic: medication-review context
Exact system:

https://mhealth.local/fhir/CodeSystem/review-resource
Supported codes include:

medication-review
short-course-medication-history
perioperative-medication-context
iv-fluid-context
rescue-reversal-medication-context
These resources remain in raw FHIR storage and may be read as medication-review candidates.

They are not automatically treated as active prescriptions.

Do not classify Basic resources from code.text.

DocumentReference
Preserved raw.

Currently intentionally raw-only.

Do not claim document normalization when no normalized path exists.

ServiceRequest
Preserved raw.

Currently intentionally raw-only unless referenced through an already-supported CarePlan activity path.

RelatedPerson
Preserved raw.

FHIR import does not automatically turn RelatedPerson into the application caregiver.

Caregiver information may come from explicit onboarding or Demo data.

Practitioner
Standalone resources remain raw.

Practitioner references may be resolved generically for CarePlan display information.

CareTeam
Preserved raw.

No general normalized CareTeam repository currently exists.

Procedure, Encounter, Organization, Provenance
Preserved raw unless a specific supported importer path consumes part of the resource.

Do not fabricate normalized equivalents.

10. Terminology Rules
Matching priority:

exact Coding.system + Coding.code;

explicitly approved alias or ConceptMap;

explicit local-code registry;

unsupported raw-only.

Do not:

match clinical destinations from patient identity;

assume coding order;

match a familiar code under the wrong system;

invent code equivalence;

use display text to make an unapproved clinical decision;

normalize unsupported content merely because it looks similar.

Display text may be used as a label when the underlying clinical selection is already established safely.

11. Missing and Unsupported Data
Optional missing FHIR data must remain unavailable or omitted.

Do not replace missing information with:

0;

false;

the current time;

"normal";

"active";

"confirmed";

a default provider;

a default caregiver;

a Demo threshold;

a placeholder age;

synthetic readiness;

a patient-specific placeholder.

Missing, unsupported, stale, partial, and invalid are different states.

When a normalized destination cannot safely represent the source:

Preserve the original FHIR resource.

Keep it raw-only.

Report why normalization was skipped.

Continue with other valid resources when safe.

12. Observation Timestamps
Do not use the import clock as a missing clinical timestamp.

Current behavior:

effectiveDateTime is supported;

effectivePeriod.start is used when present;

effectivePeriod.end is used when start is absent;

issued is not silently treated as measurement time;

no usable effective time means raw-only;

no normalized sample is created;

missing effective time is reported.

Do not restore:

effectiveDateTime ?? new Date().toISOString()
13. EHR and Demo Separation
The UI has two intentionally different actions.

Import EHR only
This action:

imports the selected FHIR Bundle;

selects the imported patient;

preserves and normalizes supported EHR resources;

does not apply Demo onboarding presets;

does not invent caregiver, provider, safety, routine, threshold, or onboarding facts.

After EHR-only import, empty onboarding fields are intentional.

Demo data
Demo data requires explicit user action.

It may populate application-owned values such as:

caregiver information;

provider information;

routines;

safety information;

thresholds;

onboarding configuration.

Demo values must not be presented as EHR-derived.

For now, where EHR and onboarding can update the same application value, the latest deliberate update wins.

Do not automatically apply Demo data during FHIR import.

14. State Architecture
The application has four relevant state layers.

Local component state
Use for:

temporary UI interaction;

modal state;

typed input;

screen-only loading state;

values not shared across screens.

PatientRecordContext
Use for:

normalized active-patient data shared across screens;

patient-specific persisted runtime values;

conditions;

medications;

care plans;

daily care;

rehabilitation;

patient-specific settings;

derived active-patient views.

It answers:

What is the current selected patient’s connected application record?

Redux
Use for:

broad runtime state;

streaming or event-driven state;

live vitals;

legacy raw FHIR Bundle state;

global slices not naturally part of one patient snapshot.

Do not move all patient data into Redux merely to solve a local state problem.

SQLite
Use for durable persistence across app restarts.

SQLite is the saved copy.

In-memory state is the fast working copy.

15. Patient Selection and Refresh Invariant
Patient selection and patient refresh are separate operations.

Selection
setPatientId(patientId)
→ persist active_patient_id
→ load the selected patient snapshot
→ publish that patient
Only explicit selection may change the active patient.

Refresh
refreshPatientRecord(patientId?)
→ refresh only the currently active patient
→ ignore a stale request for another patient
→ never change active_patient_id
A stale background callback for Mike must not overwrite James after James becomes active.

Do not weaken this invariant.

16. Patient Snapshot
getPatientRecordSnapshot(patientId) assembles a broad active-patient record.

It may include:

patient;

caregiver;

conditions;

medications;

medication-review candidates;

symptoms;

wearable data;

thresholds;

care plans;

rehabilitation metrics;

exercise assignments;

today’s daily-care entry;

daily-care history;

UC3 and UC4 data;

care context;

timeline;

goals;

knowledge statistics;

enrichment statistics;

bundle status.

A complete snapshot reload is appropriate for:

startup;

patient switching;

FHIR import;

external/background writes;

explicit full refresh;

necessary post-bundler reconciliation.

It should not be the default response to one checkbox or small row update.

17. State-First SQLite Write Contract
For ordinary patient-specific interactions, use:

user action
→ update PatientRecord state immediately
→ UI responds immediately
→ persist only the affected SQLite row
→ success: keep the state
→ failure: roll back the affected state
→ no full PatientRecordSnapshot reload
The current shared helper is:

mutatePatientRecord(updateLatestSnapshot, persist)
Its responsibilities:

calculate from the latest active-patient snapshot;

publish the update immediately;

execute the existing repository write;

roll back safely when persistence fails;

prevent an older failed write from undoing a newer success;

prevent old in-flight work from updating another patient after a switch;

avoid full snapshot and live-vitals hydration after a successful small write.

Current converted interactions
State-first behavior is implemented for:

completed exercises in Care;

medication confirmation selections;

diagnosis-role and primary-diagnosis selection;

UC3 exercise assignments.

Do new features have to use it?
No.

Use mutatePatientRecord(...) only when:

the value belongs to the active patient;

it is shared across screens or services;

it must persist to SQLite;

the UI should update immediately;

rollback is needed on failure.

Use local component state for screen-only temporary data.

Use a full snapshot refresh for broad context changes.

Use Redux for global or streaming runtime state.

18. Rapid-Write Safety
Replacement arrays must calculate from the latest runtime state.

Unsafe behavior:

tap A reads []
tap B reads []
write A saves [A]
write B saves [B]
A is lost
Required behavior:

tap A updates state to [A]
tap B reads [A]
tap B updates state to [A, B]
writes persist in order
Rollback must not undo a later successful mutation.

A mutation for one patient must not publish or roll back another patient after switching.

19. Performance Rules
The older smooth interaction pattern was:

save one row
→ update one screen or shared state value
The slow pattern was:

save one row
→ reload nearly every patient repository
→ hydrate live vitals
→ rerender
The current application snapshot is larger than the older rahal-dev snapshot because the application now includes rehabilitation, UC3, UC4, timeline, care context, and knowledge data.

Therefore:

keep the richer snapshot;

do not rebuild it after every small write;

convert only observed slow interactions;

do not rewrite every handler automatically.

When comparing with origin/rahal-dev, reuse safe behavior conceptually.

Do not restore complete files wholesale.

20. Background Work
Condition and evidence bundling may continue after FHIR import.

Background work may write its own records.

When it completes:

it may reconcile the currently active patient;

a stale completion for another patient must be ignored;

it must never change the active patient.

MedlinePlus DNS or network errors are separate evidence/network findings.

They must not change patient selection.

Partial evidence completeness semantics belong to Ethan.

21. Ownership Boundaries
Sebastian / application team
Owns:

FHIR importer;

reference validation;

terminology plumbing;

repositories;

persistence;

state management;

patient isolation;

missing-data UI;

EHR/Demo separation;

provenance display;

generic application integration.

Jay
Owns:

UC2;

UC3;

UC4;

thresholds;

model imputation;

clinical feature interpretation;

clinical equivalence decisions used by models.

Do not change clinical model behavior without Jay’s decision.

Ethan
Owns:

SLM;

Concierge;

evidence retrieval;

evidence orchestration;

related provenance;

evidence fallback and completeness behavior.

Rahal
Owns:

wearable pipeline;

scheduling;

Athena sandbox behavior;

remote/local appointment semantics.

Do not modify scheduling, Athena, or wearable behavior during FHIR normalization work.

22. Production Fallback Policy
No production feature may silently substitute:

mock data;

local fixture output;

synthetic output;

cached data presented as current;

default values presented as authoritative;

Demo results presented as EHR or external-system success.

Verified success
authoritative operation succeeds;

response is validated;

required persistence succeeds;

success is shown accurately.

Partial success
state exactly what succeeded;

state exactly what failed;

do not collapse partial success into full success.

Failure
do not fabricate a result;

show an honest error;

preserve recoverable input;

support retry where appropriate.

Dependency unavailable
show unavailable;

do not manufacture output;

do not claim that the external system succeeded.

Explicit Demo or developer behavior may remain only when it is:

intentionally activated;

clearly labeled;

provenance-aware;

impossible to confuse with authoritative data.

23. Current Verified Genericity Status
The current baseline has no active FHIR import/runtime branch that checks:

patient names;

Patient IDs;

profile filenames;

manifest IDs.

Current generic terminology behavior includes:

LOINC vital observations matched by exact system and code;

local rehabilitation/longitudinal observations matched by exact local system and code;

local Basic classifications matched by exact system and code;

ICD-10 and SNOMED conditions matched by exact system and code;

text-only conditions preserved without fabricated coding.

Current intentionally raw-only areas include:

DocumentReference;

standalone ServiceRequest;

RelatedPerson;

standalone CareTeam;

unsupported Goal detail;

other unsupported valid resources.

The verified conclusion is:

PHASE_2B_GENERIC_RUNTIME_BASELINE_COMPLETE
This does not mean every FHIR resource is normalized.

It means the current supported runtime path is generic and unsupported detail is preserved honestly.

Post-integration runtime and UI state
The canonical UC3 and UC4 production runtime paths remain:

src/services/uc3/uc3EvaluationService.ts
src/services/uc4/uc4EvaluationService.ts
The unused alternate UC3 and UC4 runtime services, the incompatible alternate UC4 repositories, and the alternate UC4 snapshot adapter have been removed. This cleanup did not redesign UC3 or UC4 clinical semantics.

Data and orchestration corrections now present on development:

shared data exports use the canonical filename casing;

the active ADCP snapshot type supports the real seed:restore source;

canonical orchestration event contracts match active UC3 and UC4 publishers;

ADCP condition indexing omits missing, null, empty, and literal null or undefined condition metadata honestly.

Care tab presentation now:

organizes daily caregiver tasks more clearly;

uses compact care-plan, Therapy, Goals & activities, and medication-watch summaries;

places priorities and Therapy before secondary plan information;

uses caregiver-facing proposal wording;

preserves the same UC3, UC4, ADCP, persistence, and patient-scoped behavior.

Home presentation now groups care-related cards under Today's care with consistent formatting and left-aligned existing icons or images.

Approved Sebastian UI/onboarding updates now present locally on sebastian:

Care Plan hero alignment now uses balanced horizontal gutters while preserving the lower timeline layout. The Care spine anchor, status dots, and connector ticks remain tied to one shared spine position aligned with the hero socket/card-frame anchor.

Tab chrome and More access now use the shared header structure consistently, and the complete More screen remains reachable from the Home header while hidden from the visible bottom tab bar.

Patient onboarding can import the selected canonical EHR Bundle directly from the Patient section without reopening the profile selector. Imported full name, age, conditions, current medications, SpO2 cutoff, and baseline heart rate remain sourced from normalized EHR data when present; preferred name and unsupported fields remain manual. Completing onboarding for an imported patient reselects and refreshes that imported Patient.id without calling the Demo seeder, replacing raw FHIR, deleting imported clinical rows, deleting care plans, or changing bundle status.

The More-tab Import EHR selector uses the shared bundled-EHR import hook. Ordinary EHR import remains EHR-only. The explicit Demo action applies the selected Demo onboarding preset to the imported patient and forwards the manual Demo SpO2 cutoff and baseline heart-rate values only when present, preserving existing EHR values when the Demo preset is blank.

Synthetic Demo onboarding values are now present only for explicit Demo use: James 94% and 70-90 BPM; Sofia 95% and 75-100 BPM; Mike 92% and 60-100 BPM. Elena continues to receive 87% and 68-82 BPM only from EHR import.

Permanent selector coverage lives outside the Expo Router route directory at `src/__tests__/select-fhir-profile.test.tsx`; no test or spec file should live under `src/app`.

24. Known Deferred Decisions
Do not automatically implement these without a new audit or owner decision:

MedicationRequest status redesign;

diagnosis presentation heuristics;

provider/caregiver overlap between FHIR and onboarding;

DocumentReference normalization;

ServiceRequest normalization;

RelatedPerson caregiver mapping;

CareTeam repository design;

exact evidence completeness semantics;

MedlinePlus network behavior;

scheduling/Athena success semantics;

model fallback and imputation decisions;

remaining database-backed UI responsiveness issues not observed manually;

medication watch areas are currently produced by a hardcoded medication-name mapping rather than Ethan's RAG/evidence layer;

only mapped watch-area codes consumed by Jay's UC4 rules affect UC4 decisions;

ADCP field-level provenance remains incomplete;

Goals & activities still mixes normalized clinical context and ADCP-related presentation;

migration-history cleanup remains separate work;

future UC4 structured-response persistence remains separate work;

logging privacy remains a Rahal/security release concern.

25. Testing and Validation Policy
Do not run broad test suites after every prompt.

Read-only audit
no tests required;

use source inspection and current runtime evidence.

Small implementation
Run:

TypeScript check;

git diff --check;

one focused existing test or temporary probe;

targeted manual runtime verification where needed.

Shared/core logic
Add focused checks for:

direct callers;

rollback;

patient switching;

stale async completion;

persistence;

no unintended full refresh.

Before local commit
Run only the relevant stable checks plus type check.

Before push or integration milestone
Run a broader suite when appropriate.

Do not delete permanent tests merely because they are stale.

Report stale test expectations separately.

26. Required AI Behavior
Before implementation, an AI assistant must:

Read this file fully.

Verify repository state.

Explain the observed problem in plain language.

Trace the real runtime flow.

Distinguish source-data problems from application problems.

Distinguish patient-specific content from patient-specific code.

Propose the smallest complete solution.

List exact files and estimated scope.

Pause when complexity thresholds are crossed.

Wait for approval.

After implementation, the AI must report:

initial Git state;

exact behavior changed;

exact files changed;

why every file was necessary;

validation commands and results;

temporary files created and removed;

exact git diff --stat;

exact final git status;

recommended commit subject;

confirmation that nothing was staged, committed, tagged, or pushed unless explicitly authorized.

Do not claim manual runtime behavior was verified when only source inspection was performed.

Do not call a theoretical concern a production defect without evidence.

27. Plain-Language Change Template
For every proposed change, answer:

Problem
What does the user currently see?

Expected behavior
What should happen instead?

Root cause
Where does the connection break?

Smallest solution
What exact behavior will change?

Files
Which files are necessary and why?

Complexity
Does it exceed:

three files;

roughly 50 lines;

one feature boundary;

a migration;

a new abstraction?

Validation
What is the smallest check proving it works?

28. Golden Invariants
Never violate these:

Every patient goes through the same FHIR pipeline.

Patient identity never selects clinical normalization behavior.

Exact system + code is the default terminology rule.

Unsupported valid FHIR remains raw-only.

Raw FHIR is preserved exactly and transactionally.

Missing data is never fabricated.

EHR-only import never applies Demo onboarding facts.

Only explicit selection changes the active patient.

Refresh never selects another patient.

A snapshot is published only for the active patient.

Small patient-specific writes update runtime state first and persist only the affected row.

Full snapshots are reserved for broad patient-context changes.

Persistence failures are reported and optimistic state is rolled back safely.

No production mock or synthetic fallback is presented as authoritative.

No cross-owner clinical decision is implemented without owner approval.

No Git mutation occurs without exact approval.

29. Current Notable Local Commits
Known recent local commits include:

fc7f0fc  Integrated EHR import into patient onboarding
9fdc432  Aligned Care hero card and timeline spine
f64a219  Fix secure messaging export casing
3df815a  Normalize tab chrome and More access
797502b  Show pending review items on dashboard

a70174a6  fix(fhir): populate patient age from birth date
dc105f03  fix(fhir): correct Elena and James birth dates
8c65223e  fix(fhir): qualify vital observations by LOINC system
5fc8ff3f  fix(fhir): qualify local observations by coding system
8cbb01cc  fix(fhir): qualify Basic resources by coding system
59fbfa60  fix(state): prevent stale refreshes from switching patients
72d35e3b  perf(state): update completed exercises without full refresh
4417beae  perf(state): update patient settings without full refresh
3459ef59  fix(fhir): qualify condition codings by system
These commits and later release commits have been published to origin/development under mhealth-generic-fhir-integration-v6-20260719.

The following rebased commits are now present on origin/development after the 2026-07-22 fast-forward integration:

64f5945  fix(data): align exports and ADCP restore source
59516d4  fix(orchestration): align active UC event contracts
0ac5541  Removed unused UC3 and UC4 code paths
cf4a598  Improved the Care tab daily workflow
638fcd5  Compacted the care plan, goals, and therapy summaries
0bea8bc  Organized care cards under Today's care
These commit SHAs are the rebased versions now present on development.

Always verify actual history before relying on this list.

30. Final Architecture Summary
FHIR source
→ generic validation
→ exact raw preservation
→ exact terminology-based normalization
→ patient-scoped SQLite repositories
→ active-patient PatientRecordContext
→ responsive UI and services
→ state-first small writes
→ SQLite persistence
→ safe rollback
→ full reload only for real context changes
The system should behave the same regardless of which patient is selected.

Patients may contain different information.

The application logic must remain generic.

31. Current Release State
This documentation state was last updated on 2026-07-23 after the approved local Sebastian UI and onboarding commits, before the authorized push to origin/sebastian.

Local branch: sebastian
Local implementation HEAD before this documentation commit: fc7f0fc13db6e6fb82676c2fd0b221e0b7e6ab66
Remote development SHA: e4be3d9018e6f0bc9b41375fa4b490a1d500e107
Remote sebastian SHA before approved push: 0bea8bc15e2deefd36c8222005ebbd12c6d02167
Remote sebastian after approved push: expected to match the `Updated current integration state` documentation commit; verify the exact SHA with `git rev-parse origin/sebastian` after push.
Latest historical tag: mhealth-generic-fhir-integration-v6-20260719 -> 87afab1ce1df612f9f0e724b5eee9bc257c153ac
New release tag created for 2026-07-23 local update: no
Local versus origin/development before documentation commit: 0 behind, 5 ahead
Local versus origin/sebastian before approved push: 0 behind, 12 ahead
Expected working tree before documentation edit: clean
Expected working tree after documentation commit and push: clean
Current verification date: 2026-07-23
Next priorities:

Run a fresh read-only audit before any development integration, rebase, merge, origin/development push, or release tag.

Review wearable integration and patient isolation.

Validate remaining UC2-UC4 behavior, testing, thresholds, and imputation questions.

Validate SLM, Concierge, and evidence behavior after rebasing from development.

Keep migration-history cleanup and future UC4 structured-response persistence as separate work.

Run broader integration testing before the next tagged push.

32. Codex-Guided Integration and Change Protocol
This protocol governs work after new commits land on origin/development, including Ethan-owned SLM, Concierge, evidence, orchestration, or provenance changes.

Roles and decision boundary
ChatGPT acts as the senior architecture and UI/UX reviewer.

Codex acts as the repository audit and implementation agent inside C:\src\mhealth.

The user remains the decision-maker for every Git mutation, conflict resolution, implementation slice, commit, push, and tag.

ChatGPT first writes a phase-specific Codex prompt.

Codex returns evidence, exact commands or files, risks, discrepancies, and unanswered questions.

ChatGPT reviews the response against this contract and the user's latest input.

Work proceeds only after the user approves the exact next action.

Do not combine audit, rebase, implementation, validation, commit, push, or tagging into one prompt or action.

Ponytail minimum-change ladder
After tracing the real runtime flow, stop at the first option that safely solves the task:

Do not build the change when it is unnecessary.

Reuse an existing correct helper, repository, hook, component, screen pattern, or service path.

Use the standard library when it already provides the behavior.

Use a native platform capability when it already provides the behavior.

Use an already-installed dependency when it is the smallest correct option.

Use a direct, explicit change when one line or one local edit is sufficient.

Only then write the minimum new code that completely solves the problem.

The shortest correct diff wins only after the existing behavior and runtime flow are understood. Never reduce validation, patient isolation, rollback safety, provenance, error handling, security, accessibility, or required hardware calibration merely to reduce code.

Architecture and UI/UX constraints
Preserve actual runtime and clinical behavior unless the user explicitly approves a behavior change.

Fix root causes at the correct shared boundary rather than patching one visible symptom.

Prefer modifying an existing feature path over adding a parallel path.

Do not create speculative refactors, wrappers, factories, interfaces, abstractions, configuration, dependencies, state mechanisms, or files.

Do not rename, relocate, or restyle unrelated code.

Do not reinterpret clinical semantics or cross an ownership boundary without the responsible owner's decision.

Preserve established UI hierarchy, interaction semantics, accessibility, patient scoping, persistence, and failure behavior.

A UI/UX improvement must reuse the existing design language and must not silently change data meaning, workflow order, or success semantics.

When evidence is incomplete or conflicting, stop and request a decision instead of inventing an answer.

Required rebase workflow
Ethan's new work on origin/development must be integrated before additional feature work begins.

Phase A — read-only preflight
Codex must:

Read this entire file.

Work only in C:\src\mhealth.

Verify the current branch, local HEAD, remote refs, divergence, worktree status, staged state, untracked files, and any in-progress Git operation.

Fetch remote metadata without rebasing, merging, resetting, restoring, staging, committing, pushing, or tagging.

Identify the commits newly present on origin/development and summarize their changed files and ownership areas.

Compare sebastian with origin/development and report the exact commits that would be replayed.

Predict likely conflict areas from overlapping changed files and runtime boundaries.

Report discrepancies and stop. Do not perform the rebase during preflight.

Phase B — approved rebase
Only after explicit approval for the exact command, Codex may rebase the existing local sebastian branch onto the verified origin/development tip.

Do not create or switch branches.

Do not use another clone or worktree.

Do not merge instead of rebase.

Do not use --onto, interactive rebase, autosquash, reset, force, or automatic conflict strategies unless separately approved.

If a conflict occurs, stop immediately after reporting the exact files and conflict stages.

Explain each side's intended behavior and propose the smallest behavior-preserving resolution.

Do not edit conflict files or continue the rebase until the resolution is approved.

Phase C — post-rebase validation
After a clean approved rebase, Codex must report:

old and new base SHAs;

rewritten local commit mapping, when applicable;

exact commits added from origin/development;

exact files affected by conflict resolution, or confirmation that there were no conflicts;

focused type checks, stable tests, git diff --check, and any necessary targeted runtime verification;

exact final branch, HEAD, divergence, worktree, staged state, and untracked state;

confirmation that no commit, push, tag, branch change, reset, or unrelated edit occurred beyond the approved rebase operation.

Push, tag, and any follow-on implementation remain separate decisions.

Codex response standard
Every Codex response must separate verified facts from inferences and use this structure:

Repository state

New development commits

Observed behavior and runtime boundaries

Rebase risk and likely conflicts

Smallest safe next action

Exact commands proposed

Files that may require review

Validation plan

Questions or discrepancies

Actions performed

For read-only phases, Actions performed must explicitly confirm that no files or Git history were changed.

Initial Codex prompt: development rebase preflight
You are performing a read-only integration preflight for the mHealth repository.

Read CURRENT_STATE.md fully before doing anything. Treat it as the governing architecture, ownership, workflow, and Git contract.

Context:
- Work only in C:\src\mhealth.
- Remain on the existing sebastian branch.
- Ethan has reportedly pushed new changes to origin/development.
- We expect to rebase sebastian onto the latest verified origin/development, but the rebase is NOT authorized in this phase.
- Preserve all actual application, clinical, persistence, state, accessibility, and UI behavior.
- Follow the Ponytail minimum-change approach: understand the real flow first; reuse existing code and platform capabilities; avoid new abstractions, dependencies, parallel paths, refactors, and unnecessary complexity.

Perform only a read-only preflight:
1. Show the current directory and prove it is C:\src\mhealth.
2. Verify the current branch, HEAD, worktree, staged files, untracked files, and whether any merge/rebase/cherry-pick/revert/bisect is in progress.
3. Fetch origin so remote refs are current. Do not pull, merge, rebase, reset, restore, stage, commit, push, tag, create/switch branches, or edit files.
4. Report the exact SHAs for HEAD, origin/sebastian, and origin/development and the ahead/behind counts among them.
5. List the commits newly present on origin/development since the documented baseline 0bea8bc15e2deefd36c8222005ebbd12c6d02167. Identify which appear to be Ethan's changes from verified commit metadata; do not guess authorship from file names.
6. Summarize the changed files and functional areas in those commits, especially SLM, Concierge, evidence retrieval/orchestration, provenance, patient isolation, shared state, UI, and any overlapping files touched by local sebastian commits.
7. Determine the exact local commits that a normal `git rebase origin/development` would replay.
8. Identify likely conflict files and explain the behavior on both sides. Do not propose broad refactors; propose only behavior-preserving conflict principles.
9. Check whether the documented CURRENT_STATE snapshot is now stale and list every field that must be updated after a successful rebase.
10. Stop and return the report. Do not perform the rebase or modify CURRENT_STATE.md.

Use this response format:
Repository state
New development commits
Changed files and ownership boundaries
Local commits that would be replayed
Likely conflicts and behavior risks
Smallest safe next action
Exact rebase command proposed, but not executed
Post-rebase validation plan
Questions or discrepancies
Actions performed

In Actions performed, explicitly confirm that no files, index state, commits, branches, tags, or remote refs were changed except the remote-tracking updates produced by `git fetch origin`.
