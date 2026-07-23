# `src/services/` — L2 App Services

> **Status:** partial implementation. Onboarding, audit, consent, device memory,
> performance monitoring, SLM helpers, model download/storage, and the Alert ML
> wrapper are implemented; medication / care / patient / scheduling service files
> are UI scaffolds awaiting business logic.

**What lives here:** feature-facing service modules, the **event handler**
(`med_due`, `appt_synced`, `ml_alert_created`, `caregiver_override`), the
**deterministic Reminder Logic / rule engine** (no SLM), the **SLM Context Bridge**
(on-demand only), the **Notification Manager** (DND-bypass fast path for ST-03),
the **consent gate** (default-deny egress), the **audit log** (tamper-evident),
and the HITL confirm/override controllers.

**Implemented modules:**

- `audit/auditService.ts` — convenience builders around `insertAuditEntry`.
- `consent/consentGate.ts` — default-deny egress consent for MCP tools.
- `device-memory.ts` — native memory bridge with deterministic mock fallback.
- `performance/performanceService.ts` — 1 Hz `useRamSnapshot` + SLM/other breakdown.
- `slm/slmService.ts` — system prompt builder, model download helpers, mock response.
- `onboarding/onboardingService.ts` — profile types and in-memory store.
- `ml/alert-ml-service.ts` — rolling-window vitals → TFLite autoencoder wrapper.
- `hf-token-store.ts` — `expo-secure-store` HF access token.
- `model-download.ts` / `model-storage.ts` — Hugging Face downloader + on-device
  GGUF directory helpers.

**Note on the canonical ordering:** the deterministic rule/threshold engine in
this layer runs **before** the Alert ML model and **before** any SLM call.

**Primary owners:** Sebastian + Ethan (consent/audit/HIPAA spine) + Rahal
(audit↔appointment integration).
