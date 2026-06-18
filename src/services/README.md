# `src/services/` - L2 App Services

> **Status:** partial implementation. Onboarding, audit read/write helpers,
> consent, records export, device memory, performance monitoring, SLM helpers,
> model download/storage, the Alert ML wrapper, and a small care alert wrapper are implemented.
> Medication, patient, and scheduling service files are still mostly UI-facing
> scaffolds awaiting business logic.

**What lives here:** feature-facing service modules between UI and the
data/repository layer. Screens should call services, and services can call
repositories/data functions. This folder also contains the event handler
surface (`med_due`, `appt_synced`, `ml_alert_created`, `caregiver_override`),
deterministic reminder logic, SLM context helpers, notification management,
default-deny consent gates, audit helpers, and HITL confirm/override controls.

**Implemented modules:**

- `audit/auditService.ts` - convenience builders around `insertAuditEntry`
  plus read-only wrappers for audit log entries and hash-chain verification.
- `consent/consentGate.ts` - default-deny egress consent for MCP/tools/export.
- `records/recordsService.ts` - More-screen-friendly consent status, record
  export consent grant/revoke, and C-CDA export result handling.
- `care/careService.ts` - service-layer wrappers for reading active alerts and
  acknowledging/resolving alerts.
- `device-memory.ts` - native memory bridge with deterministic mock fallback.
- `performance/performanceService.ts` - 1 Hz `useRamSnapshot` plus SLM/other
  memory breakdown.
- `slm/slmService.ts` - system prompt builder, model download helpers, mock
  response.
- `onboarding/onboardingService.ts` - profile types, in-memory store, and
  onboarding-to-data seeding entry point.
- `ml/alert-ml-service.ts` - rolling-window vitals to TFLite autoencoder
  wrapper.
- `hf-token-store.ts` - `expo-secure-store` Hugging Face access token.
- `model-download.ts` / `model-storage.ts` - Hugging Face downloader and
  on-device GGUF directory helpers.

**Note on canonical ordering:** deterministic rule/threshold logic runs before
the Alert ML model and before any SLM call.

**Primary owners:** Sebastian plus Ethan for consent/audit/HIPAA spine work and
Rahal for audit/appointment integration.
