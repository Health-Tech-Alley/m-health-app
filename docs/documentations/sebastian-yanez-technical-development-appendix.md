# Sebastian Yanez — Technical Development Appendix

**Project:** Caregiver AI / ACCESS-DP Prototype
**Focus areas:** caregiver UI, onboarding, EHR/FHIR import, SQLite persistence, PatientRecordSnapshot, active-patient state, HITL workflows, medication display, scheduling UI, wearable/vitals support, CarePlan, rehabilitation, and demo preparation.

This appendix summarizes the development work from my side of the project. It shows how the work progressed from early architecture and UI planning into a caregiver workflow layer connected to patient data, local persistence, active-patient state, alerts, medications, scheduling, wearable/vitals support, CarePlan, rehabilitation, and demo preparation.

---

## 1. Role and development scope

My work focused on the caregiver-facing application layer and the data/state flow behind it. This included:

- caregiver onboarding and patient setup;
- Home, Care, Meds, Schedule, Alerts, Concierge/Assistant, and Settings/More UI;
- active-patient state and patient switching behavior;
- SQLite-backed patient records;
- EHR/FHIR import support;
- PatientRecordSnapshot and normalized patient context;
- caregiver HITL feedback for non-emergency alerts;
- medication display and notification/preference support;
- scheduling/provider UI support;
- wearable/vitals monitoring UI support;
- CarePlan, safety notes, rehabilitation check-ins, and patient context display;
- final demo polish and release preparation.

A consistent theme was building with **Usability and Integration** in mind. The caregiver experience needed to bring together patient records, caregiver-entered context, medications, scheduling, alerts, vitals, and Concierge support without making the caregiver navigate disconnected technical pieces.

My role was not to own every model, integration, or clinical rule. My responsibility was to make sure the caregiver UI and app data flow could receive those outputs, display them clearly, preserve patient context, and support caregiver action.

---

## 2. Early planning, architecture, and design direction

Before implementation started, the team worked through project scope, Steel Thread ideas, first architecture diagrams, and role responsibilities. This early work helped define how the app should separate the caregiver UI, app services, local data, model outputs, scheduling, medications, care management, and Concierge/SLM support.

My early architecture work focused on translating the broad product idea into the caregiver workflow layer. The first architecture drafts helped identify the pieces my work would need to connect: alert events, patient information, medication data, appointment scheduling, local persistence, state management, and human-in-the-loop caregiver actions.

| Early development area | What was developed or planned | Development impact |
|---|---|---|
| Steel Thread and use-case planning | Reviewed emergency, non-emergency, medication, care coordination, and follow-up workflows. | Helped define which caregiver journeys needed to be supported by the UI and state/data flow. |
| First architecture draft | Mapped caregiver app, app services, care/medication/scheduling modules, local AI support, and patient data. | Established the first structure for how the app could connect UI, services, and data. |
| Layered local-first architecture | Separated caregiver experience, services/security, workflow orchestration, decision support, knowledge retrieval, and local data. | Supported the decision to use local persistence and avoid making every screen manage its own data. |
| Responsibility-specific architecture | Focused on Dashboard, Medications, Appointments, SQLite/state management, event handling, SLM context bridge, audit concepts, and caregiver actions. | Clarified the technical layer I was responsible for building and integrating. |

![Responsibility-specific architecture](assets/sebastian-yanez/03-responsibility-specific-architecture.png)

*Responsibility-specific architecture showing the caregiver UI, local state, scheduling, medications, alerts, and Concierge context responsibilities.*

---

## 3. Development progression

The sections below summarize how my work developed across the project. Each phase includes the main development focus, what changed, why it mattered, and the type of repository evidence that can support it.

---

### 3.1 Early design

**Timeframe:** Early June

| Development checkpoint | Area | Development impact |
|---|---|---|
| Early UI design direction | UI / UX design | Created or used early design direction for onboarding, dashboard, navigation, and caregiver-facing screens. |
| First caregiver workflow layout | Caregiver workflow | Helped organize the first visual structure for how caregiver tasks could be presented in the app. |
| Initial Figma and screen direction | Design reference | Gave the team a visual reference before implementation started and helped guide the first React Native screens. |

**What changed during development:**
The first UI ideas were based on early Figma direction and team design discussions. These designs were not the final app, but they helped start the caregiver workflow and gave us a way to think about onboarding, Home, navigation, patient summary, alerts, medications, scheduling, and care information before the data flow was fully implemented.

**Why it mattered:**
This early design work helped move the project from architecture diagrams into a mobile experience. As implementation continued, the screens changed based on team feedback, EHR/FHIR data needs, state-management decisions, alert behavior, and the use cases.

![Early Figma and wire implementation](assets/sebastian-yanez/04-early-figma-and-wire-implementation.png)

*Early Figma and wire implementation work that shaped the first caregiver-facing screens.*

![Early onboarding Figma](assets/sebastian-yanez/05-early-onboarding-figma.png)

*Early onboarding design direction for the caregiver and patient setup flow.*

---

### 3.2 Caregiver UI, onboarding, and screen structure

**Timeframe:** Mid-June

| Development checkpoint | Area | Development impact |
|---|---|---|
| Caregiver screen integration | Caregiver UI / navigation | Established early Home, Care, onboarding, profile, alert, and vitals presentation polish. |
| Structured onboarding expansion | Onboarding / UI | Expanded the onboarding flow and coordinated the main caregiver tab screens. |
| Patient summary service connection | Patient summary / state | Connected onboarding data to patient summary and service-backed profile display. |
| Service-backed caregiver flows | Settings / alerts / medications | Moved caregiver flows closer to service-backed behavior instead of static UI. |

**What changed during development:**
The app started with broad screen ideas and early design direction. From there, I worked on turning the initial caregiver flow into connected screens. This included onboarding, Home, Care, Meds, Schedule, profile/settings, alert surfaces, and vitals presentation.

**Why it mattered:**
The early UI work helped establish the foundation for the caregiver experience. The goal was not just to create screens, but to begin organizing the app around caregiver tasks: entering or reviewing patient information, checking the current status, viewing care information, managing medications, scheduling, and responding to alerts.

---

### 3.3 Alert integration and urgent alert presentation

**Timeframe:** Mid-to-late June

| Development checkpoint | Area | Development impact |
|---|---|---|
| Alert-system integration into the UI branch | Integration | Integrated teammate alert/UC and SLM-related work into the caregiver UI/state branch while keeping ownership boundaries separate. |
| Critical alert and alert-log integration | Alerts / UI | Integrated critical alert popup and alert-log behavior while preserving the caregiver tab UI. |

**What changed during development:**
As alert logic became available from other parts of the prototype, the UI needed to show alerts in a way that caregivers could understand quickly. The urgent alert path became visually and functionally separate from normal reminders or non-emergency review items.

**Why it mattered:**
This supported **User Error Reduction** because the caregiver should not have to interpret raw telemetry or guess whether an event is urgent. The alert UI needed to show what changed, why it matters, and what action should be taken next.

**Use-case connection:**
This work later supported Elena’s urgent anomaly use case, where the caregiver sees a severity-3 alert, reviews the explanation, and has immediate action options such as calling 911 or reviewing the full alert.

![Elena emergency alert](assets/sebastian-yanez/06-elena-emergency-alert-card.png)

*Elena emergency alert presentation with urgent caregiver actions and contextual vitals.*

---

### 3.4 EHR/FHIR onboarding and the move toward normalized patient state

**Timeframe:** Late June

| Development checkpoint | Area | Development impact |
|---|---|---|
| EHR-driven onboarding and patient classifications | Onboarding / EHR / FHIR | Added EHR-driven onboarding fields and patient classification persistence. |
| Normalized patient-state strengthening | PatientRecordSnapshot / EHR | Strengthened normalized patient state used by the UI after EHR import. |
| FHIR patient cases connected to normalized UI state | FHIR / state / UI | Connected imported patient cases to normalized UI state across Home, Care, Meds, and Profile. |

**What changed during development:**
One of the biggest architecture changes was moving away from multiple patient-data paths. Earlier, some screens were using onboarding state, some were using raw FHIR, and other areas were moving toward SQLite. That created a risk that different screens could show different versions of the same patient.

The implemented direction became:

```text
FHIR or onboarding
→ importer / onboarding service
→ SQLite repositories
→ PatientRecordSnapshot
→ active-patient state
→ caregiver UI and runtime consumers
```
For some caregiver actions, the UI can update state first for responsiveness, then persist the action and refresh the saved patient context.

**Why it mattered:**
This change made the app more consistent and easier to test. It also supported **Transparency** and **Interoperability** because EHR-style information could be imported, organized, saved locally, and shown through the same patient structure instead of each screen interpreting raw source data differently.

**Development decision:**
Raw FHIR should be treated as an import source, not the main source every screen reads from during normal app use.

---

### 3.5 Preferences, medications, and Concierge patient context

**Timeframe:** Late June to early July

| Development checkpoint | Area | Development impact |
|---|---|---|
| Preferences and developer settings reorganization | Preferences / navigation | Separated caregiver preferences from developer-only controls. |
| Medication display support | Medication UI / data | Improved medication display against typed patient data. |
| Patient snapshot used for Concierge context | Concierge / patient context | Routed Concierge context through the patient snapshot instead of loose screen state. |
| Caregiver workflows and reminder preferences | Meds / notifications / workflows | Added caregiver workflow depth and reminder-preference UI. |

**What changed during development:**
Settings and developer tools were separated more clearly so caregiver-facing preferences did not get mixed with demo/test controls. Medication display was also adjusted to follow the active normalized patient instead of relying on loose or stale UI data.

**Why it mattered:**
This supported **Empowerment** and caregiver burden reduction. Medication and reminder settings should help caregivers focus on actions that matter rather than creating unnecessary confirmation fatigue. For Concierge, the patient context needed to come from the same active-patient structure used by the rest of the app.

![Mike complex medication screen](assets/sebastian-yanez/11-mike-complex-meds-screen.png)

*Mike medication screen showing complex medication context organized for caregiver review.*

---

### 3.6 Wearable/vitals support and UC2 input normalization

**Timeframe:** Early July

| Development checkpoint | Area | Development impact |
|---|---|---|
| Persisted recent live vitals | Wearable / vitals | Persisted and displayed recent live vitals connected to active-patient state. |
| UC2 input normalization | Alerts / UC2 | Unified UC2 input normalization used by alert logic. |
| PCP/provider fixture support | Scheduling / provider | Added PCP/provider fixture data for Athena/provider-facing demos. |

**What changed during development:**
The monitoring path started moving from mock-compatible readings toward a more shared app flow. Recent vitals could be persisted, displayed, and connected to active-patient state. The UC2 input path was also normalized so manual and wearable-driven inputs could be handled more consistently.

**Why it mattered:**
This supported the goal of integrating device information with caregiver-facing screens. It also helped prepare the app for non-emergency and urgent alert workflows where vitals need to connect to the correct patient and downstream analysis.

![Sofia HITL analysis screen](assets/sebastian-yanez/07-sofia-hitl-analysis-screen.png)

*Sofia non-emergency HITL analysis screen showing caregiver feedback in the monitoring workflow.*

---

### 3.7 Mike EHR processing, Care Planning Context, and scheduling integration

**Timeframe:** Early to mid-July

| Development checkpoint | Area | Development impact |
|---|---|---|
| Mike EHR curation and timeline plumbing | FHIR / CarePlan / timeline | Added Mike clinical context plumbing for Care and longitudinal/timeline UI. |
| Mike v6.2 context and scheduling integration | EHR / scheduling integration | Integrated Mike v6.2 context while preserving scheduling boundaries. |
| Schedule and monitoring UI refinement | Scheduling / vitals UI | Improved schedule and monitoring presentation. |

**What changed during development:**
The new deidentified EHR case required reviewing many files and deciding what information was actually safe and useful to map into the app. A major lesson was that technically valid mappings can still be clinically wrong. For example, not every coded entry or note fragment should become a diagnosis, medication, procedure, vaccine, or active care item.

**Why it mattered:**
The app needed source-backed patient context, not just a technically parseable bundle. This supported **Transparency** because the caregiver UI should not present uncertain or incorrect information as confirmed clinical fact.

**Development decision:**
Diagnosis roles should not be hardcoded. Primary diagnosis and active comorbidities should be curated before being treated as confirmed.

---

### 3.8 Demo onboarding personas and import feedback

**Timeframe:** Mid-July

| Development checkpoint | Area | Development impact |
|---|---|---|
| Demo onboarding personas and patient-context restoration | Demo onboarding / EHR | Added removable demo personas and restored patient-scoped EHR, diagnosis, medication, and CarePlan context. |
| In-app feedback after FHIR import | EHR import UX | Added visible feedback after FHIR profile import. |

**What changed during development:**
The onboarding flow needed to demonstrate EHR import without making the caregiver manually enter all clinical information. Imported fields were labeled and protected, while caregiver-facing fields remained editable.

**Why it mattered:**
This supported **Interoperability** by showing how EHR-style data can populate the app. It also supported **User Error Reduction** because caregivers are not asked to manually recreate clinical records when supported information can be imported.

---

### 3.9 Rehabilitation, safety notes, UC3, and UC4 caregiver workflows

**Timeframe:** Mid-July

| Development checkpoint | Area | Development impact |
|---|---|---|
| Repository-backed rehab check-ins | SQLite / rehab state | Made rehab check-ins durable and repository-backed. |
| Structured rehabilitation target import | FHIR / UC3 | Imported structured rehab targets into normalized repository state. |
| Patient-scoped identity and safety notes | Patient switching / safety | Routed safety and patient identity through patient-scoped state. |
| UC3 input and adapter foundation | UC3 / rehab | Built UC3 data entry, repository, and adapter foundation. |
| Persisted UC3 evaluation and Care result UI | UC3 / Care UI | Persisted UC3 evaluation results and exposed them in Care UI. |
| Deterministic UC3 and UC4 integration | UC3 / UC4 | Connected deterministic UC3/UC4 outputs into caregiver-facing Home/Care flows. |
| UC3 and UC4 caregiver workflow | Care workflow | Completed caregiver workflow around rehab and micro-priority results. |

**What changed during development:**
The Care screen became more than a static place to show a care plan. It expanded to support daily rehabilitation entries, structured targets, safety notes, patient context, and care-priority outputs.

**Why it mattered:**
This supported **Support human-in-the-loop accountability** because caregivers can enter what actually happened at home, such as therapy completion, repetitions, ROM, walking minutes, pain, fatigue, and symptoms. These values can support future analysis without overwriting EHR facts or caregiver-entered records.

**Development decision:**
Generated results should not overwrite FHIR facts, CarePlan data, or caregiver-entered rehabilitation records. They should be stored and shown as outputs or recommendations.

![James therapy care screen](assets/sebastian-yanez/08-james-therapy-care-screen.png)

*James therapy section showing rehabilitation check-ins and Care workflow context.*

---

### 3.10 Concierge/evidence integration, wearable patient isolation, and generic FHIR import

**Timeframe:** Mid-to-late July

| Development checkpoint | Area | Development impact |
|---|---|---|
| Concierge and evidence integration | Concierge / evidence | Integrated Concierge with clinical evidence, explanation surfaces, and caregiver UI. |
| Wearable patient isolation | Wearable / patient isolation | Preserved patient isolation while integrating wearable vitals. |
| Generic FHIR Bundle validation | Generic FHIR import | Enforced generic Bundle validation instead of patient-specific import behavior. |
| Active-patient refresh protection | Active patient state | Prevented async refreshes from changing the active patient unexpectedly. |
| FHIR condition coding qualification | FHIR terminology | Required correct coding system for condition normalization. |
| Scheduling unavailable-state handling | Scheduling / provider | Added unavailable-state handling around Athena preload. |

**What changed during development:**
As the app became more integrated, patient isolation became more important. Wearable data, Concierge context, scheduling, and patient imports all needed to stay attached to the correct patient.

**Why it mattered:**
If the caregiver switches patients or imports a new record, the app should not keep showing the previous patient’s context. This is important for safety, trust, and transparency.

---

### 3.11 Final UI polish, EHR onboarding restoration, and alert refinement

**Timeframe:** Final submission stage

| Development checkpoint | Area | Development impact |
|---|---|---|
| Care tab daily workflow improvement | Care UI / CarePlan | Reorganized daily caregiver tasks, therapy, and plan proposals. |
| Today’s Care organization | Home UI | Grouped care-related dashboard cards under Today’s Care. |
| Pending review items on Home | Home / HITL | Surfaced pending review items on Home for caregiver action. |
| Tab header and More-access normalization | Navigation / UI polish | Unified tab headers, hid More from bottom nav, and kept More reachable from Home. |
| Care hero and timeline alignment | Care visual polish | Aligned Care hero and timeline geometry for final presentation. |
| EHR import restored into patient onboarding | Onboarding / EHR | Added direct Patient-step EHR import and imported-patient completion flow. |
| Emergency alert metric refinement | Alerts / HITL | Reconciled alert metric presentation with Apple Watch vitals envelope, SpO2 cutoff, baseline HR, and emergency-fast-path wording. |

**What changed during development:**
The final phase focused on making the demo flow cleaner and easier to understand. EHR import was restored directly into onboarding, pending review items were surfaced on Home, navigation was cleaned up, Care visuals were aligned, and emergency alert metrics were refined.

**Why it mattered:**
This helped the app demonstrate a more realistic caregiver flow: import patient information, review what matters now, respond to urgent or non-urgent alerts, manage care priorities, view medications, schedule follow-up, and use Concierge support.

![Home needs review and alerts log](assets/sebastian-yanez/09-home-needs-review-alerts-log.png)

*Final Home presentation with Needs Review and Alerts Log surfaces for caregiver follow-up.*

---

## 4. Repository checkpoints

| Evidence point | Repository reference |
|---|---|
| Main work branch | `sebastian` |
| Care and alert integration checkpoint | `mhealth-concierge-care-alert-integration-v8-20260724` |
| Dashboard/navigation/Care/onboarding EHR checkpoint | `mhealth-care-onboarding-integration-v7-20260722` |
| Personalized Care/Home workflow checkpoint | `mhealth-personalized-care-integration-v7-20260722` |
| Generic FHIR pipeline checkpoint | `mhealth-generic-fhir-integration-v6-20260719` |
| UC3 repository-backed state foundation checkpoint | `mhealth-uc3-state-foundation-20260715` |
| Mike v6.2 integration checkpoint | `sebastian-v6.2.0-20260713` |

These references provide stable checkpoints for the submitted prototype work.

---

## 5. Use-case connection

The four demo use cases helped test whether the same UI, data, and state-management structure could support different caregiver situations without hardcoding behavior to a patient name.

### Elena — urgent anomaly detection and follow-up care

Elena’s use case shaped the urgent alert experience. The caregiver needed to see what changed, why it mattered, and what action could be taken next. My work supported the caregiver-facing part of that flow through the critical alert display, emergency actions, alert review, and alert history.

This use case also helped reinforce that urgent alerts should be visually and behaviorally different from normal reminders or non-emergency concerns. The caregiver should not have to interpret raw vitals during a stressful situation.

### Sofia — non-urgent anomaly detection and caregiver feedback

Sofia’s use case shaped the non-emergency HITL workflow. The app needed to show a concern without treating it like an emergency. The caregiver could review the concern, add observations about what may have happened, ask Concierge for support, acknowledge the concern, or dismiss it.

This supported **human-in-the-loop accountability** because the caregiver’s real-world context could be added before the system continued with the next recommendation or follow-up path.

### James — rehabilitation tracking and long-term progress

James’s use case shaped the Care and rehabilitation sections. The app needed to support therapy-related information, daily completion, rehab targets, progress context, and CarePlan organization.

This use case helped move the Care screen beyond static plan display. It became a place where daily caregiver entries, structured targets, safety notes, and progress-related outputs could be shown in separate sections.

### Mike — complex care and personalized recommendations

Mike’s use case tested how the app handles a more complex care context without overwhelming the caregiver. The work around Mike influenced EHR import, diagnosis curation, medication focus, patient-scoped context, safety notes, Care Planning Context, and Care priority cards.

This use case supported the idea that complex care should not require a complex caregiver experience. The UI needed to organize the most relevant information into clear, personalized, and actionable areas instead of showing every diagnosis, medication, or concern with the same weight.

![Mike complex care screen](assets/sebastian-yanez/10-mike-complex-care-screen.png)

*Mike Care screen showing complex care context organized into caregiver-facing priorities.*

---

## 6. Continued development areas

| Area | Planned addition or improvement |
|---|---|
| EHR and patient context | Continue refining curated patient context so diagnoses, medications, care-plan themes, and clinical timeline items are source-backed and caregiver-reviewable. |
| Wearable and monitoring flow | Continue validating wearable readings with patient mapping, timestamps, duplicates, offline behavior, and patient switching. |
| Concierge context | Continue testing that Concierge receives the correct active-patient context after imports, patient switching, alerts, medications, and care updates. |
| Scheduling | Continue improving appointment behavior, including edit, reload, remote cancellation handling, and local versus remote appointment distinction. |
| Medication workflow | Continue improving medication scheduling and confirmation-required medication presentation so the caregiver sees the most important medication actions first. |
| Care and rehabilitation | Continue improving rehab history, progress summaries, daily check-ins, and how generated care results appear in the Care screen. |
| HITL workflows | Continue refining how caregiver feedback is saved, displayed, and reused across alerts, care priorities, medication review, and Concierge support. |
| UI polish | Continue improving layout consistency, empty states, navigation, wording, and demo-readiness across the main caregiver screens. |
| Evidence and documentation | Keep repository links, screenshots, diagrams, tags, and demo scripts updated so development progress remains easy to review. |

---

## 7. Closing summary

My work progressed from early architecture and UI design into a caregiver workflow layer connected to patient data, local persistence, active-patient state, HITL feedback, scheduling, medications, wearables/monitoring support, CarePlan, rehabilitation, and demo preparation.

The biggest development change was moving toward a consistent patient-data path instead of allowing screens to interpret different sources independently. That made it easier to support multiple use cases, preserve patient isolation, reduce UI confusion, and prepare patient context for downstream ML and SLM consumers.

This appendix points reviewers to stable repository history, tags, screenshots, diagrams, and code areas that support the development work completed on my side of the prototype.
