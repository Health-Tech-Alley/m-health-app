# Caregiver Concierge: ACCESS-DP — Project Overview for AI Agents

## Project Summary

**Caregiver Concierge (ACCESS-DP)** is a mobile health AI application designed to support family caregivers of **severely disabled individuals** (disability **level 3** on a 1–5 scale) with **comorbidities and specialists involved**. The app runs AI inference **locally on-device** using **Expo / React Native** (iOS + Android), prioritizing privacy, offline functionality, and human-in-the-loop control.

The caregiver-facing surface is organized around **three pillars**:

- **Medication Management** — dosage monitoring, pharmacy locator and communicator (consent-gated), drug-interaction awareness
- **Care Management** — personal care plan (initial generation + continuous personalization), anomaly detection with transparency trace
- **Scheduling and Tracking Center** — appointments, FHIR record-share escalation, adherence/vitals/audit timeline, dashboard

Every pillar cuts across the L1–L7 architecture below and shares the same canonical event ordering
(deterministic rule → Alert ML → caregiver HITL → SLM + RAG only after ground-truth → persist + audit).

**Target conditions:** **cerebral palsy, traumatic brain injury (TBI), COPD** — plus the three use-case conditions: **Spina Bifida, post-stroke rehabilitation, COPD + TBI**. *(Diabetes is no longer the primary condition; it may appear only as an incidental comorbidity.)*

**Target grants:** ACL Caregiver AI Challenge and Maryland Rural Health (RMPIF FY27).

---

## Planning Docs (canonical references)

The authoritative planning package lives in [`planning/`](./planning/). The README is the elevator pitch;
this `AGENTS.md` is the contributor guide; the planning package is the engineering source of truth.
**When in doubt, the planning package wins.**

- [`planning/00_README-index.md`](./planning/00_README-index.md) — Master index + how to read the planning package
- [`planning/02_steel-thread-methodology.md`](./planning/02_steel-thread-methodology.md) — Steel-thread slicing, the three use cases, canonical event ordering
- [`planning/03_architecture-and-tech-stack.md`](./planning/03_architecture-and-tech-stack.md) — L1–L7 reference architecture, runtime decisions, CEP + fused retrieval, Continuous Personalization
- [`planning/04_team-roles.md`](./planning/04_team-roles.md) — 3 roleplayers + 1 PM, role↔intern mapping, per-thread demo ceremony
- [`planning/10_repo-organization.md`](./planning/10_repo-organization.md) — Repo layout, per-directory ownership, CODEOWNERS
- [`planning/code-templates/`](./planning/code-templates/) — Skeleton interfaces (`InferenceProvider`, MCP tool, agent orchestrator, consent gate, FHIR sandbox)
- [`planning/notebooks/`](./planning/notebooks/) — Python eval harness (4 notebooks that gate every release)
- [`planning/08_app-architecture-diagram.svg`](./planning/08_app-architecture-diagram.svg) + `09_ethan-workstream.svg` — visual block diagram + Ethan's 77-day workstream

---

## Core Principles (Non-Negotiable)

1. **On-device AI** — No cloud inference for core flows; PHI stays local. ~8B parameter clinical decision support SLM runs on-device.
2. **Cross-platform** — Single React Native codebase for iOS + Android.
3. **Human-in-the-loop** — AI proposes; human confirms/overrides. No auto-execution of clinical actions.
4. **Offline-first** — Core functionality works with zero connectivity.
5. **Synthetic data only** — No PHI in prototype; demo-safe.
6. **Consent-gated egress** — Data leaves device only via explicit, tokenized, time-limited, revocable consent.
7. **HIPAA compliance** — The trust and security standard for all data handling.

---

## Architecture Layers (L1–L7)

| Layer | Name | Purpose |
|-------|------|---------|
| **L1** | React Native UI | Caregiver-facing features: Dashboard, Medication Management, Appointment/Scheduling, Settings, HITL confirm/override |
| **L2** | App Services | Feature controllers, state management (Zustand/Redux), event handler, reminder logic, SLM context bridge, Notification Manager, consent gate, HIPAA controls, audit log |
| **L3** | Event Bus (CEP) | Complex Event Processing — ingests events from UI, sensors, state; correlates compound conditions; fuses geofence + patient context before SLM call |
| **L4** | Intelligent Orchestration | MCP (Model Context Protocol) orchestrator, multi-agent coordination, fused tool-RAG + knowledge-RAG retriever, FHIR adapter |
| **L5** | Decision Engine | Clinical Decision SLM (~8B), Alert ML model (vitals/biometrics), re-ranker, InferenceProvider abstraction |
| **L6** | Knowledge | Hybrid RAG (BM25 + dense + RRF), OpenEvidence clinical evidence base, NLM/FDA APIs (RxNorm, DailyMed, OpenFDA), vector index, GraphRAG (future) |
| **L7** | Local Data + Sensors | SQLite + SQLCipher (single source of truth), repositories, longitudinal record, local cache, wearable bridges (HealthKit/Health Connect), FHIR sandbox, geofence + service locator |

### Key Architectural Decisions

- **Event-driven CEP** — L3 is a Complex Event Processing bus that correlates events from multiple sources before dispatching to the orchestrator. Reduces chain hops and fuses context before the SLM is called.
- **Fused retrieval** — Tool-RAG (selecting the right MCP tool) and Knowledge-RAG (retrieving clinical evidence) share a single embedding retriever. One query returns both tool schemas and clinical chunks in a single hop.
- **FHIR in orchestration** — The FHIR adapter is a tool within the orchestrator, not a passive data-layer reader. The orchestrator reads/writes patient data as a tool call in the same turn as the SLM.
- **Orchestrator-mediated subagent I/O** — Subagents (caregiver, patient-state, coordinator, safety-reviewer) do not read or write directly. The L4 orchestrator owns and mediates all dataflow into and out of subagents: it assembles their inputs from the CEP event, Context Aggregator snapshot, and fused retrieval results; it receives their proposals and decides what to do next. This single chokepoint is what makes the system HIPAA-auditable, enforces the safety-reviewer verdict in one place, and keeps subagent logic pure.
- **InferenceProvider abstraction** — The SLM runtime (llama.rn, MLC, ExecuTorch) is wrapped behind a swappable interface, allowing per-platform optimization without touching orchestration or UI code.
- **Controller/repository pattern** — The UI never reaches past the repo boundary; every read is auditable and every write is encrypted at rest. The SLM is a *guest* in the control loop, called on-demand, not a polling dependency. The app works fully without it (Reminder Logic + Local Cache + deterministic rules cover the offline path).

---

## UI + Local Data Design (caregiver-facing surface)

The caregiver-facing surface is organized into four feature areas (L1) backed by feature controllers and state (L2), with a SQLite-centric local data layer (L7) as the single source of truth.

**L1 — Caregiver-facing features (organized by pillar):**
- **Medication Management** — dosage schedule, adherence tracking, reminders, pharmacy locator + communicator (consent-gated)
- **Care Management** — personal care plan (onboarding + SLM personalization), anomaly feed with transparency trace
- **Scheduling and Tracking Center** — appointments + tracking timeline (adherence, vitals, audit)
- **Dashboard** — summary view, alerts, action cards (cross-pillar)
- **Settings** — preferences, caregiver profile, patient profile, PCP profile
- **HITL Actions** — confirm / override / escalate controls, present on every AI suggestion

**L2 — Core App Services (per-feature):**
- **Feature Controllers** — `DashboardController`, `MedicationController`, `AppointmentController` orchestrate per-screen reads/writes and event subscriptions
- **State Management** — Zustand or Redux holds current app state and pending actions; the only state the UI reads from
- **Event Handler** — subscribes to typed events emitted by L3/L4: `med_due`, `appt_synced`, `ml_alert_created`, `caregiver_override`. The UI's window onto the rest of the system.
- **Reminder Logic** — deterministic rules engine (no SLM) that derives local notification schedules from medication and appointment data
- **SLM Context Bridge** — packs local patient context for a single on-demand request to the SLM. RAG, MCP, and ML alerts are **not** polled here.
- **Adaptive Layer** — clean module boundaries the UI talks to; abstracts (SLM, RAG, MCP, ML alerts, APIs) so screens stay testable
- **Notification Manager** — invoked by the orchestrator over the L3↔L2 JSON-RPC 2.0 boundary; routes through `UNUserNotificationCenter` (iOS) / `AlarmManager + BroadcastReceiver` (Android); supports critical fast-path overrides (DND bypass) and time-based medication interactive push-reminders

**L7 — Local Data (SQLite, source of truth):**
- **SQLite DB** (encrypted with SQLCipher) — single source of truth for profile, meds, appointments, audit timeline, and cache
- **Repositories** — `MedicationRepo`, `AppointmentRepo`, `AlertRepo` — the only sanctioned read/write surface
- **Longitudinal Record** — adherence history and care timeline (data the audit and personalization loops read from)
- **Local Cache** — patient-relevant references (RxNorm, OpenFDA lookups) cached for offline use
- **Audit / Sync** — consent logs, write history, retry queue for offline writes that flush later

### Workflow (the canonical control loop)

1. **Input Event** arrives (`MedDue`, `ApptSynced`, `ml_alert`, `caregiver_input`)
2. **Validate + Route** — control checks, schema validation, routing rules
3. **Update State** — Zustand/Redux store; optimistic UI
4. **Load Context** — read local patient, medication, appointment, alert, timeline data from SQLite
5. **Decision** — schedule reminder, show card, call SLM context bridge **only if** explanation or summary is needed
6. **HILT Result** — confirm / override / resolve the alert
7. **Persist** — SQLite transaction through repositories; update dashboard
8. **Audit + timeline** — write history, update dashboard, emit `caregiver_override` event upstream

### Data-source classification

- **Persistent** — SQLite: profile, meds, appointments, audit, timeline, cache
- **Event-Driven** — `med_due`, `appt_synced`, `ml_alert_created`, `caregiver_override`
- **On-demand** — SLM/RAG/MCP called **only** when explanation or summary is needed; never polled
- **Manager agent** — controller waits for events; dashboard work happens offline first; sync is async and non-blocking

---

## On-Device AI

### Clinical Decision SLM (~8B parameters)

The primary AI component is an ~8B parameter small language model, quantized to Q4_K_M (~4.5–5GB), serving as a clinical decision support tool. It:

- Grounds answers in **OpenEvidence** clinical literature with citations
- Provides medication guidance, care-plan reasoning, and knowledge engineering
- Runs behind the `InferenceProvider` interface for runtime swappability
- Is continually trained on personalized care plans via a trigger-event loop

**Primary runtime:** `llama.cpp` via `llama.rn` (cross-platform, GGUF model format)
**Fallback runtimes:** MLC LLM (Metal/Vulkan), ExecuTorch (future-proofing)

### Alert ML Model

A separate classical/compact ML model for vitals and biometric stream analysis:

- Out-of-range trend detection
- Emergency prediction
- Alert notification generation
- Target performance: **F1 0.7–0.9, ROC/AUC 85%+**

### Embedding Model

A sub-1B parameter embedding model (GTE-small or MiniLM-class) powers both tool-RAG and knowledge-RAG retrieval. Runs via Core ML on iOS and TFLite/NNAPI on Android.

---

## Orchestration (MCP)

The Model Context Protocol (MCP) orchestrator coordinates four specialized agents:

| Agent | Role |
|-------|------|
| **Caregiver Agent** | Interprets caregiver intent, drives dialogue |
| **Patient-State Agent** | Maintains context from persona, logs, and vitals |
| **Coordinator Agent** | Assembles care-plan actions, drafts appointments, locator queries |
| **Safety-Reviewer Agent** | Enforces guardrails (no clinical advice, requires human confirm, checks bias) |

The orchestrator is **event-triggered** (not request/response). When the CEP bus emits a complex event, the orchestrator fans out to agents in parallel. It emits a **transparency trace** (which tool was chosen, why, what the SLM concluded) for human-in-the-loop review.

### Subagent Dataflow Governance

The L4 orchestrator is the **single chokepoint for all dataflow into and out of subagents**. Subagents do not read directly from L6/L7 or write directly to the event bus, the UI, or the notification surfaces. Instead:

- **Inputs to a subagent** are assembled by the orchestrator from the CEP complex event, the Context Aggregator snapshot (geofence + patient state + CBO locator), fused-retrieval tool schemas and clinical chunks, and any patient state the orchestrator explicitly chooses to expose.
- **Outputs from a subagent** (proposals, trace steps, draft actions, alerts, risk scores) are returned to the orchestrator, which then decides whether to: emit a new event on the bus, persist to the care-plan profile, surface a HITL confirm/override to L1, or trigger a downstream action.
- **Egress-bearing outputs** (e.g., a coordinator-agent draft of a record share) must additionally pass the L2 consent gate before the orchestrator dispatches the corresponding MCP tool.

This pattern delivers four properties the rest of the system depends on:

1. **HIPAA auditability** — every read and every write is attributable to the orchestrator, which produces the tamper-evident audit log.
2. **Centralized safety** — the safety-reviewer-agent's verdict is enforced in one place, not scattered across subagents.
3. **Tool-RAG correctness** — a subagent only sees tools and clinical chunks it is authorized for in the current turn.
4. **Testability** — deterministic I/O contracts at the orchestrator boundary make subagents individually mockable.

**Predictive ML alert path:** when the coordinator-agent (or a dedicated alert-agent) produces a risk score, the orchestrator — not the subagent — decides whether to push a native notification via the L2 Notification Manager, surface an in-app Alert Center card behind a HITL confirm, downgrade to a soft nudge if the safety-reviewer flags uncertainty, or suppress entirely. The subagent never touches `UNUserNotificationCenter` (iOS) or `AlarmManager` (Android) directly.

---

## Knowledge & Retrieval

### Hybrid RAG

Retrieval uses the TrialGPT recipe:

1. **BM25** (lexical/sparse) — excels at exact medical terms, drug names, dosages
2. **Dense embeddings** (sub-1B model) — excels at semantic similarity and paraphrases
3. **Reciprocal Rank Fusion (RRF)** — merges ranked lists from both retrievers

### Clinical Evidence Sources

- **OpenEvidence** — primary clinical evidence base (citations always returned)
- **RxNorm** (NLM) — drug standardization
- **DailyMed** (NLM) — drug labels
- **OpenFDA** — adverse events, recalls

### Future: GraphRAG

A care graph (patient ↔ meds ↔ providers ↔ services ↔ events) will enable multi-hop reasoning ("which of mom's meds interact, and which provider to contact?").

---

## Continuous Personalization

### Initial Care Plan Generation

The personalized care plan is the **foundational document** that drives every steel thread. It is generated
through a two-phase process on first run:

1. **Caregiver Onboarding (generic template):** Caregiver completes a structured form (patient demographics,
   conditions, medications, allergies, routines, preferences). A generic care plan template auto-populates
   with medication schedules, vitals monitoring cadence, appointment cadence, emergency thresholds, and
   service preferences. Template validation checks completeness; RxNorm normalizes medications; default
   thresholds are proposed from condition profiles.
2. **SLM-Driven Personalization:** The draft is handed to the SLM, which uses fused tool-RAG + knowledge-RAG
   over OpenEvidence, RxNorm, and FDA labels to iterate on the plan — adjusting thresholds for patient
   age/comorbidities, adding medication-specific rules, setting escalation protocols, and generating
   citation-backed rationale. The safety reviewer ensures no clinical directives. The caregiver reviews,
   confirms, or edits each section in a dedicated Care Plan screen.

### Ongoing Refinement ("Netflix Model")

After initial generation, the app implements constant profile refinement:

1. Caregiver acts in-app (confirms/overrides a suggestion, logs a vital, schedules an appointment, dismisses an alert)
2. Action is classified as a **trigger event** (typed, auditable)
3. Trigger updates the **personalized care-plan profile** (clinical + environmental + SDOH)
4. SLM heuristics are refined against the updated profile (on-device personalization + periodic retraining)
5. Next suggestions reflect the refined profile

All refinement data stays consent-scoped and HIPAA-compliant.

---

## Human-in-the-Loop

Every AI-proposed clinical action requires explicit human confirmation:

- The AI **proposes** an action with rationale and evidence citations
- The caregiver **confirms** or **overrides** the action
- Confirmed actions become trigger events for the personalization loop
- Overridden actions also become learning signals
- Nothing clinical auto-executes

The UI surfaces a **transparency trace** showing the reasoning path: which agent acted, which tool was selected, what evidence was retrieved, and what the SLM concluded.

---

## Data & Interoperability

- **Local storage:** SQLite + SQLCipher (encrypted at rest), local vector index for RAG
- **Secure storage:** iOS Keychain / Android Keystore for secrets and keys
- **EHR interop:** FHIR R4 standard; Dockerized FHIR sandbox for development (MedAgentBench-style)
- **Wearables:** Apple Health (HealthKit) and Google Health (Health Connect) bridges
- **Consent + tokenization:** Explicit consent record + time-limited token for any record share; revocable; the only egress path

---

## Security & Privacy

- **HIPAA compliance** — PHI handling, encryption at rest and in transit, access controls, tamper-evident audit log
- **Private by architecture** — PHI stays on-device; minimize egress; consent gate mediates every egress (default-deny)
- **Transparency** — OpenEvidence citations + orchestration trace + "guidance, not medical advice" framing
- **Audit log** — tamper-evident record of AI proposals vs. human actions

---

## Steel Threads (the three final use cases)

Work is sliced into **steel threads** — thin, end-to-end, demonstrable vertical slices. The three threads
map 1:1 to the team's three use-case documents and are ordered by escalation tier (ambient → trajectory →
acute). *(These replace the earlier diabetes-based ST-01…06 backlog, which is retired.)*

| Thread | Name | Use case | Status |
|--------|------|----------|--------|
| **ST-01** | **Ambient Anomaly Detection** | UC1 — Sofia, 22, Spina Bifida (caregiver Marco) | **FIRST THREAD** (walking skeleton) |
| **ST-02** | **Recovery Trajectory** | UC2 — James, 67, post-stroke (caregiver Diane) | Pending |
| **ST-03** | **Acute Escalation** | UC3 — Elena, 72, COPD + TBI (caregiver Luis) | Pending |

- **ST-01 — Ambient Anomaly Detection:** silent wearable stream → rule/threshold check (no emergency) →
  Alert ML anomaly (`ANOMALY_TYPE_04`) → caregiver physical check-in (HITL) → **SLM+RAG only after the
  caregiver logs observations** → urgent-appointment recommendation. *(ACL: burden reduction, transparency
  — shows how ML factored in, HITL, offline.)*
- **ST-02 — Recovery Trajectory:** 21-day PT metrics → ML regression vs. care-plan milestones
  (`TRAJECTORY_FAILURE_DETECTED`) → progress-gap visualization (SLM bypassed for the chart) → HITL
  consent-gated, encrypted FHIR escalation to the therapist. Absorbs the old care-plan + consent-share
  threads. *(ACL: privacy/dignity/data control, personalization.)*
- **ST-03 — Acute Escalation:** acute telemetry breach → deterministic threshold engine →
  **Severity 3 fast-path alert that short-circuits the ML/SLM queues** → dashboard-takeover card (Call 911 /
  Go to ER / Contact Provider) → SLM "Explain" only on demand, after the alert → **no auto-911; human stays
  in the loop**. *(ACL: safety, human-directed action, transparency.)*

**Rule:** Do not start ST-(n+1) until ST-(n) is running and demoable. The geofenced **service locator** and
full **multi-agent + GraphRAG** are deferred SCOPE(out) items, not primary threads.

### Canonical event ordering (current direction — not locked)

All three threads share one ordering, and the system is tuned for it:

```
patient action/change → deterministic rule + threshold engine → Alert ML (starting context)
   → caregiver HITL (check / acknowledge / escalate) → SLM + RAG (only after ground-truth; emergencies skip)
   → caregiver HITL confirm → persist + audit + (optional) consent-gated egress
```

- **Rule logic leads the ML step;** prefer **deterministic outputs**. ML output is *starting context* for the
  SLM prompt and is surfaced to the caregiver (so they see *how the ML factored in*), never shown as a diagnosis.
- **SLM runs only after caregiver ground-truth** in ST-01/ST-02 (avoids hallucinating unobserved context).
  **ST-03 short-circuits** the SLM path so the urgent alert is immediate; "Explain" runs on demand afterward.
- **Human-directed triggers** (a caregiver/provider question like "the diagnosis code changed — what does that
  mean?" or "what do I do?") enter the same pipeline at the SLM step.

---

## Build & Runtime (Expo + Expo Go two-track)

The app is an **Expo managed** project (SDK 56) using **expo-router** (file-based routing under `src/app/`).
Development runs on two tracks because core native modules don't load in Expo Go:

- **Track A — Expo Go (no Xcode / Android Studio / adb):** UI + the **deterministic rule/threshold engine** +
  event bus/state + **mocked** SLM / Alert ML / RAG / wearable / FHIR providers. Run with `npx expo start`,
  scan the QR with **Expo Go**. This covers most steel-thread UI work and demos the full click-paths.
- **Track B — dev build (`expo-dev-client`):** required for `llama.rn` (on-device SLM), **SQLCipher**,
  **HealthKit / Health Connect**, background geofencing, and Signal-protocol messaging. Build via **EAS**
  (`eas build --profile development`) in the cloud — no local native toolchain needed — then
  `npx expo start --dev-client`. Local `expo run:ios` needs macOS+Xcode; `expo run:android` needs the Android SDK.

**Provider-swap rule:** every native capability ships a `Mock*` (Track A) and a real native impl (Track B)
behind one interface (`InferenceProvider`, repositories, `SensorSource`). App start picks the impl from a
single flag; UI/orchestration never branch on it. Build + demo each thread on Track A first, then swap in
native providers on Track B.

## Tech Stack

- **Build / runtime:** Expo (managed) + expo-router; Expo Go (Track A) / dev build via EAS (Track B)
- **UI Framework:** React Native (iOS + Android)
- **On-device SLM:** llama.cpp via llama.rn (GGUF, Q4_K_M quantization)
- **SLM fallbacks:** MLC LLM, ExecuTorch
- **Embedding model:** GTE-small / MiniLM (<1B), Core ML (iOS) / TFLite (Android)
- **Orchestration:** Model Context Protocol (MCP)
- **Event processing:** Custom TypeScript CEP rules engine
- **Retrieval:** Hybrid RAG (BM25 + dense + RRF)
- **Clinical evidence:** OpenEvidence, RxNorm, DailyMed, OpenFDA
- **Local storage:** SQLite + SQLCipher
- **Vector index:** FAISS / sqlite-vss
- **EHR interop:** FHIR R4 (HAPI sandbox)
- **Wearables:** HealthKit (iOS), Health Connect (Android)
- **Secure storage:** iOS Keychain, Android Keystore
- **Evaluation:** Python notebooks (Jupyter)

---

## Evaluation

Quality is measured via a Python evaluation harness:

- **SLM evaluation** — latency, RAM usage, answer quality on curated med-QA prompt sets
- **RAG evaluation** — retrieval quality metrics (precision, recall, MRR)
- **Safety & bias** — guardrail tests ("no clinical advice"), bias suite, expert-aligned rubric scoring accuracy and communication quality
- **HITL evaluation** — override rate, caregiver trust signals

---

## Team

| Name | Role | Primary layer ownership |
|------|------|------------------------|
| **Ethan Christian** | AI Software Engineering Intern — SLM, RAG, MCP orchestration | **L3 orchestration** (MCP, CEP, agents, fused tool+knowledge RAG) · **L4 inference** (`InferenceProvider` + `llama.rn` adapter + GGUF model loader) · **L5 knowledge** (hybrid RAG, re-ranker, fused retriever) · **L2 consent gate + audit log** (HIPAA spine) · **clinical-evidence/** (OpenEvidence + NLM/FDA clients) · all 4 notebooks. Visual breakdown: [`planning/09_ethan-workstream.svg`](./planning/09_ethan-workstream.svg). |
| Jay Modi | AI Software Engineering Intern — Predictive ML, wearables, push notifications, secure messaging | L6 data (HealthKit/Health Connect bridges, vitals ingest); L3 coordinator agent (risk scores); notebooks 03 + 04. |
| Sebastian Yanez | AI Software Engineering Intern — RN UI, Dashboard, medication/appointment screens, state management | L1 ui, L2 services (Settings, confirm/override glue, state), Detox E2E. |
| Rahal Danthanarayana | Lead Dev / Mentor — patient information, appointment API | L6 data (FHIR adapter, SQLCipher schema, appointment API), L7 locator (geofence + CBO data), CI/CD, native shells. |
| Ted DellaVecchia | PM / Architect | PM / Demo Director (see [`planning/04_team-roles.md`](./planning/04_team-roles.md)). |

> Full per-directory ownership + CODEOWNERS mapping: [`planning/10_repo-organization.md`](./planning/10_repo-organization.md) §3–4.

---

## Key Decisions Pending

- Target device tiers for demo
- Model shortlist to benchmark
- OpenEvidence access (cached vs live) + HIPAA-compliant request path
- FHIR sandbox deployment strategy
- Local vs cloud placement for the ~8B SLM
- CEP engine choice (custom TypeScript vs Esper/Siddhi vs hybrid)
- Re-ranking model (Cohere Rerank cloud vs on-device bge-reranker vs skip)

---

## License

**MIT** — see [`LICENSE`](./LICENSE). This project is open source; you can use, modify, and distribute it under
the MIT terms. (Note: the bundled `LICENSE` file is the stock Expo MIT template; update the copyright line to
match your team/org before any public release.)

---

## For AI Agents Working on This Codebase

- This document (`AGENTS.md`) is the canonical project overview for AI agents working in this repo.
- **Code templates** are scaffolds with TODOs — not production code. Use them to understand interfaces.
- **Notebooks** are evaluation harnesses — fill in once models/data are chosen.
- **Licensing discipline:** Only MIT-licensed repos (MedAgentBench, AgentClinic, 3MDBench, TxAgent) may have code copied. Others are patterns only.
- **No PHI.** All test data must be synthetic.
