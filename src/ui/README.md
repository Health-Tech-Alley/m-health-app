# `src/ui/` — L1 React Native UI (feature layer)

> **Status:** scaffold (empty). No business logic yet — created so the L1–L7 architecture exists in the tree.

**What lives here:** feature screens and components beyond the `expo-router` shell in `src/app/` — the
Dashboard, Care Plan, Medication Management, Appointment/Scheduling, Settings, the **HITL** confirm/override
controls, and the **dashboard-takeover** emergency alert card (ST-03). `src/app/` holds the route files;
this directory holds the reusable feature UI those routes render.

**Steel-thread surfaces this layer owns:**
- **ST-01 Ambient Anomaly Detection** — the check-in card + structured symptom log.
- **ST-02 Recovery Trajectory** — the progress-gap chart + "Acknowledge & Securely Escalate" panel.
- **ST-03 Acute Escalation** — the red dashboard-takeover card (Call 911 / Go to ER / Contact Provider / Explain).

**Primary owner:** Sebastian. See `planning/10_repo-organization.md` for full ownership.

**Track A (Expo Go):** all of this renders in Expo Go against mocked providers — no native modules required.
