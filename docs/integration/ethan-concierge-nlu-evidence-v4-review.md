# Ethan Concierge NLU Evidence V4 Review

Date: 2026-07-17

## Scope

This review covers the remaining Concierge, SLM lifecycle, pre-SLM NLU,
clinical evidence retrieval, optional evidence graph, and developer settings
integration. It intentionally does not restructure FHIR/EHR import paths, model
assets, or patient fixture data.

## Production Safety Decisions

- Concierge answers require the native SLM provider to be loaded. When the
  model is idle, loading, or errored, chat surfaces an unavailable state instead
  of synthesizing a mock answer.
- Pre-SLM NLU uses the trained/native TFLite embedder plus intent head when
  available. Missing native NLU modules, tokenizer/model assets, or intent-head
  coefficients make production NLU unavailable.
- The hash/keyword NLU path is development-only, gated by `__DEV__`, developer
  mode, and the persisted `nluDevelopmentFallback` setting.
- The SLM RAM gate reports unknown free memory as `null` when the native memory
  bridge is unavailable. UI copy only shows measured RAM values when the native
  bridge exists.
- In-chat appointment persistence is restricted to developer mode. Normal
  caregiver chat may recommend follow-up guidance, but it does not claim that an
  appointment was scheduled, saved, sent, received, or reviewed.

## Evidence And Provenance

- Normal retrieval indexes persisted `knowledge_cache` rows and live-approved
  supplement output. Bundled evidence fixtures are excluded unless `__DEV__`
  and `evidenceDevelopmentFallback` are both enabled.
- Patient-specific cached chunks are filtered by metadata `patientId`; without
  an active matching patient ID they are excluded from retrieval.
- CDA narrative chunks stored with legacy `synthetic` source metadata are
  surfaced as `patient-record` evidence when their metadata identifies them as
  CDA narrative records.
- Retrieved chunks and prompt citations now carry source/resource identifiers,
  patient ID when applicable, effective/retrieved timestamps when present,
  retrieval method, graph relation, and development-fixture marking.

## Evidence Graph Decision

The evidence graph table and edge writers are retained, but graph expansion
remains disabled by default through `knowledgeGraphExpansion`. When enabled, it
is ranking-only: BM25 seed hits are expanded by one-hop persisted edges, and the
result still falls back to ordinary BM25 when edges are absent. Edge writers
avoid linking patient-specific chunks across different patients; global
evidence can still link to patient-specific evidence.

## Settings

Advanced Developer Settings exposes:

- Dynamic SLM loading, default on.
- Development NLU fallback, default off and `__DEV__` only.
- Development evidence fixtures, default off and `__DEV__` only.
- Evidence graph expansion, default off.

Settings are stored in the existing `app_settings` JSON row, so no database
schema migration is required for the new flags.

## Verification Notes

- Focused Concierge/NLU/evidence/UC3/UC4 Jest set passed before temporary tests
  were removed from the commit.
- TypeScript typecheck passed after production files were updated.
- Expo lint passed with existing warnings and zero errors.
- After restoring tracked tests to committed content, the legacy
  `uc3EvaluationService` and `uc4EvaluationService` tests still expect direct
  service-layer notification dispatch. This integration keeps notification
  delivery orchestration-owned, as requested, so those restored tests need an
  Ethan-owned expectation update.
- Full Jest is blocked by existing non-integration issues: the UC2
  decision-layer harness calls `process.exit(1)` for
  `WEAK_CONFUSED_NOT_BASELINE + SEIZURE_LIKE`, UC2 fixture files are discovered
  as empty test suites, `alert-ml-service.test` requires unavailable native
  NitroModules in the local Jest environment, and onboarding preset tests
  expect older fixture/profile values. No UC2, onboarding, FHIR fixture, or
  alert-autoencoder files are modified by this integration.
