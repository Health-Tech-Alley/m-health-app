# UC3/UC4 Concierge Context V3 Limitations

This checkpoint assembles patient-scoped Concierge context from existing SQLite repositories, PatientRecordSnapshot, persisted UC3/UC4 state, alert history, ML event history, app settings, and current SLM readiness inputs. It does not add durable patient-state fields and it does not claim clinical validation.

## Explicit Limitations

- Native NLU/TFLite assets are still missing from the repository and bundled app assets.
- Production hash or keyword fallback is not approved as a substitute for native NLU.
- Persona lexicons and fixture corpora are excluded from this checkpoint.
- Knowledge graph migration 45, `knowledge_chunk_edges`, graph expansion, and graph edge writers are excluded.
- Authoritative device free-memory behavior remains unresolved when the native memory bridge is unavailable.
- The local demo appointment flow is excluded from this checkpoint.
- This checkpoint is not clinically validated.
- This checkpoint has not completed real-device end-to-end validation.
- When native Concierge capability is unavailable, the app must show an honest unavailable state instead of synthetic Concierge output.

## Decisions Still Required From Ethan

- Decide the production policy for missing native NLU assets: fail unavailable, dev-only fallback, or approved bundled asset path.
- Decide whether the hash embedder and keyword intent fallback may remain only behind an explicit developer setting.
- Decide whether persona/use-case lexicons and synthetic clinical fixture corpora must move to test/dev fixtures before production promotion.
- Decide whether migration 45 and `knowledge_chunk_edges` should be approved in a later graph-expansion phase.
- Decide the authoritative native memory/free-RAM contract and how unavailable memory data should be surfaced.
- Decide how the local demo appointment flow should be gated, replaced, or removed for production review.
- Decide the real-device validation checklist required before this Concierge context checkpoint can be promoted beyond experimental review.
