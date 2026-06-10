# `src/services/` — L2 App Services

> **Status:** scaffold (empty). No business logic yet.

**What lives here:** feature controllers, state management (Zustand/Redux), the **event handler**
(`med_due`, `appt_synced`, `ml_alert_created`, `caregiver_override`), the **deterministic Reminder Logic /
rule engine** (no SLM), the **SLM Context Bridge** (on-demand only), the **Notification Manager** (DND-bypass
fast path for ST-03), the **consent gate** (default-deny egress), the **audit log** (tamper-evident), and the
HITL confirm/override controllers.

**Note on the canonical ordering:** the deterministic rule/threshold engine in this layer runs **before** the
Alert ML model and **before** any SLM call — see `planning/02_steel-thread-methodology.md` §3b.

**Primary owners:** Sebastian + Ethan (consent/audit/HIPAA spine) + Rahal (audit↔appointment integration).
