import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * SQLite migrations.
 *
 * Each entry is a single SQL script run in order. Migrations are idempotent
 * where possible (CREATE TABLE IF NOT EXISTS, etc.).
 */

export type Migration = string | ((db: SQLiteDatabase) => void);

export const MIGRATIONS: Migration[] = [
  // 0: core identity tables
  `
  CREATE TABLE IF NOT EXISTS patients (
    patient_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    age TEXT,
    conditions TEXT,
    baseline_daily_routine TEXT,
    current_medications TEXT,
    spo2_cutoff TEXT,
    baseline_heart_rate TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS caregivers (
    caregiver_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    name TEXT NOT NULL,
    relationship TEXT,
    experience TEXT,
    availability TEXT,
    language_preference TEXT,
    medical_comfort_level TEXT,
    hobbies_or_routines TEXT,
    main_concern TEXT,
    stress_or_support_needs TEXT,
    backup_caregiver TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS providers (
    provider_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    role TEXT,
    created_at TEXT NOT NULL
  );
  `,

  // 1: health samples (continuous data from Apple Health / Health Connect / manual / mock)
  `
  CREATE TABLE IF NOT EXISTS health_samples (
    sample_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    value REAL,
    value_json TEXT,
    unit TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    metadata_json TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_health_samples_lookup
    ON health_samples(patient_id, type, recorded_at DESC);

  CREATE TABLE IF NOT EXISTS health_sync_state (
    type TEXT PRIMARY KEY,
    last_cursor TEXT
  );
  `,

  // 2: care plan, meds, conditions
  `
  CREATE TABLE IF NOT EXISTS care_plans (
    plan_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    effective_date TEXT NOT NULL,
    safety_notes TEXT,
    emergency_contact TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS medications (
    medication_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dosage TEXT,
    frequency TEXT,
    route TEXT,
    indication TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS patient_conditions (
    condition_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icd10 TEXT,
    onset_date TEXT
  );

  CREATE TABLE IF NOT EXISTS care_plan_goals (
    goal_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    description TEXT NOT NULL,
    target_date TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  );
  `,

  // 3: thresholds, alerts, caregiver actions
  `
  CREATE TABLE IF NOT EXISTS thresholds (
    threshold_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    vital_type TEXT NOT NULL,
    value REAL NOT NULL,
    direction TEXT NOT NULL,
    severity INTEGER NOT NULL,
    source TEXT NOT NULL,
    citation_id TEXT,
    created_at TEXT NOT NULL,
    superseded_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_thresholds_active
    ON thresholds(patient_id, vital_type, superseded_at);

  CREATE TABLE IF NOT EXISTS alerts (
    alert_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    severity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    ml_score REAL,
    ml_features_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_patient
    ON alerts(patient_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS caregiver_actions (
    action_id TEXT PRIMARY KEY,
    alert_id TEXT,
    patient_id TEXT NOT NULL,
    caregiver_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_actions_alert
    ON caregiver_actions(alert_id, created_at DESC);
  `,

  // 4: RAG citations, SLM turns, trigger events, graph edges
  `
  CREATE TABLE IF NOT EXISTS rag_citations (
    citation_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    source TEXT NOT NULL,
    text TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS slm_turns (
    turn_id TEXT PRIMARY KEY,
    alert_id TEXT,
    patient_id TEXT NOT NULL,
    model_id TEXT,
    prompt_hash TEXT,
    response_hash TEXT,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slm_citations (
    turn_id TEXT NOT NULL,
    citation_id TEXT NOT NULL,
    PRIMARY KEY (turn_id, citation_id)
  );

  CREATE TABLE IF NOT EXISTS trigger_events (
    event_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    alert_id TEXT,
    action_id TEXT,
    outcome TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS graph_edges (
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id, type)
  );
  `,

  // 5: tamper-evident audit log + consent tokens
  `
  CREATE TABLE IF NOT EXISTS audit_log (
    audit_id TEXT PRIMARY KEY,
    patient_id TEXT,
    actor TEXT NOT NULL,              -- 'orchestrator' | 'caregiver' | 'slm' | 'system'
    action TEXT NOT NULL,             -- human-readable action verb
    resource_type TEXT NOT NULL,      -- 'alert' | 'sample' | 'consent' | 'slm_turn' | ...
    resource_id TEXT,
    payload_json TEXT,                -- structured details
    hash_chain TEXT NOT NULL,         -- sha256(prev_hash || payload)
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_resource
    ON audit_log(resource_type, resource_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_patient
    ON audit_log(patient_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS consent_tokens (
    token_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    scope TEXT NOT NULL,              -- e.g. 'fhir-share', 'pharmacy-communicator'
    granted INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_consent_patient_scope
    ON consent_tokens(patient_id, scope, revoked_at);
  `,

  // 6: FHIR resource cache + export queue
  `
  CREATE TABLE IF NOT EXISTS fhir_resources (
    resource_type TEXT NOT NULL,
    resource_id   TEXT NOT NULL,
    version       INTEGER NOT NULL,
    kind          TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (resource_type, resource_id, version)
  );

  CREATE INDEX IF NOT EXISTS idx_fhir_kind
    ON fhir_resources(kind, created_at DESC);
  `,

  // 7: medication schedules, notifications, notification preferences
  `
  CREATE TABLE IF NOT EXISTS medication_schedules (
    schedule_id   TEXT PRIMARY KEY,
    medication_id TEXT NOT NULL,
    patient_id    TEXT NOT NULL,
    time_of_day   TEXT NOT NULL,
    days_of_week  TEXT,
    dose_label    TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_med_sched_patient
    ON medication_schedules(patient_id, active);

  CREATE TABLE IF NOT EXISTS notifications (
    notification_id TEXT PRIMARY KEY,
    patient_id      TEXT NOT NULL,
    scope           TEXT NOT NULL,
    trigger_ref     TEXT,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    severity        INTEGER,
    bypass_dnd      INTEGER NOT NULL DEFAULT 0,
    delivered_at    TEXT,
    dismissed_at    TEXT,
    action_taken    TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_notif_patient
    ON notifications(patient_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS notification_preferences (
    scope                 TEXT PRIMARY KEY,
    enabled               INTEGER NOT NULL DEFAULT 1,
    lead_time_minutes     INTEGER,
    quiet_hours_start     TEXT,
    quiet_hours_end       TEXT
  );
  `,

  // 8: Secure Messaging and Encryption
  `
  CREATE TABLE IF NOT EXISTS secure_messaging_store (
      message_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      recipient_provider_id TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      ephemeral_public_key TEXT NOT NULL,
      message_type TEXT CHECK(message_type IN ('CLINICAL_ESCALATION', 'STANDARD_CHAT')) NOT NULL,
      sync_status TEXT CHECK(sync_status IN ('QUEUED', 'SENDING', 'SYNCED')) DEFAULT 'QUEUED',
      created_at INTEGER NOT NULL,
      consent_audit_token TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_secure_messaging_sync 
  ON secure_messaging_store (sync_status, created_at);
  `,

  // 9: app settings
  `
  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,

  // 10: add per-turn RAM + token attribution to slm_turns
  `
  ALTER TABLE slm_turns ADD COLUMN tokens_generated INTEGER;
  ALTER TABLE slm_turns ADD COLUMN peak_ram_bytes INTEGER;
  `,

  // 11: knowledge_cache — PubMed/MedlinePlus/RxNorm/DailyMed/OpenFDA chunks
  // (see planning/22_clinical-data-gathering.md §6a)
  `
  CREATE TABLE IF NOT EXISTS knowledge_cache (
    chunk_id      TEXT PRIMARY KEY,          -- docId (e.g. "PMID-12345678", "MLP-J44.1")
    source        TEXT NOT NULL,             -- 'pubmed' | 'medlineplus' | 'rxnorm' | 'dailymed' | 'openfda'
    text          TEXT NOT NULL,             -- chunk text (abstract, summary, label excerpt)
    query_hash    TEXT,                      -- hash of the de-identified query that retrieved this chunk
    conditions    TEXT,                      -- CSV of condition names this chunk relates to
    retrieved_at  TEXT NOT NULL,             -- ISO timestamp
    expires_at    TEXT,                      -- optional TTL (OpenFDA adverse events = +30d)
    use_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT                       -- extra fields (PMID, MeSH terms, RxCUI, etc.)
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_source
    ON knowledge_cache(source, retrieved_at DESC);
  CREATE INDEX IF NOT EXISTS idx_knowledge_conditions
    ON knowledge_cache(conditions);
  `,

  // 12: patient_enrichment_log — observable/auditable record of every
  // clinical-source enrichment (which field, which source, when, query used)
  `
  CREATE TABLE IF NOT EXISTS patient_enrichment_log (
    log_id        TEXT PRIMARY KEY,
    patient_id    TEXT NOT NULL,
    field         TEXT NOT NULL,             -- 'condition' | 'medication' | 'threshold' | 'goal'
    resource_id   TEXT,                      -- condition_id | medication_id | ...
    source        TEXT NOT NULL,             -- 'pubmed' | 'medlineplus' | 'rxnorm' | 'dailymed' | 'openfda'
    action        TEXT NOT NULL,             -- 'bundled' | 'suggested' | 'supplemented_live'
    deidentified_query TEXT,                 -- the query that was actually sent
    result_count  INTEGER,
    latency_ms    INTEGER,
    chunk_ids     TEXT,                      -- CSV of knowledge_cache.chunk_id written
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_enrichment_patient
    ON patient_enrichment_log(patient_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_enrichment_source
    ON patient_enrichment_log(source, created_at DESC);
  `,

  // 13: extend patient_conditions + new clinical-detail tables
  // (structured ICD codes, comorbidities, symptoms, wearable devices, ML events)
  `
  ALTER TABLE patient_conditions ADD COLUMN category TEXT;
  ALTER TABLE patient_conditions ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE patient_conditions ADD COLUMN source TEXT NOT NULL DEFAULT 'onboarding';
  ALTER TABLE patient_conditions ADD COLUMN source_doc_id TEXT;
  ALTER TABLE patient_conditions ADD COLUMN retrieved_at TEXT;
  ALTER TABLE patient_conditions ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;

  CREATE INDEX IF NOT EXISTS idx_conditions_patient_review
    ON patient_conditions(patient_id, needs_review, is_primary);

  CREATE TABLE IF NOT EXISTS symptoms (
    symptom_id    TEXT PRIMARY KEY,
    patient_id    TEXT NOT NULL,
    label         TEXT NOT NULL,
    category      TEXT NOT NULL,             -- 'respiratory' | 'cardiac' | 'neurologic' | 'mobility' | 'general' | 'pain' | 'behavioral' | 'other'
    source        TEXT NOT NULL DEFAULT 'onboarding',
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_symptoms_patient
    ON symptoms(patient_id, category);

  CREATE TABLE IF NOT EXISTS wearable_devices (
    device_id     TEXT PRIMARY KEY,
    patient_id    TEXT NOT NULL,
    device_type   TEXT NOT NULL,             -- 'Apple Watch' | 'Fitbit' | ...
    device_label  TEXT,
    connected     INTEGER NOT NULL DEFAULT 0,
    baseline_status TEXT NOT NULL DEFAULT 'not_started', -- 'not_started' | 'simulated' | 'connected' | 'failed'
    baseline_started_at   TEXT,
    baseline_completed_at TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ml_events (
    event_id      TEXT PRIMARY KEY,
    patient_id    TEXT NOT NULL,
    device_id     TEXT,
    alert_id      TEXT,
    queue_type    TEXT,                      -- 'SLM_HEURISTIC_REFINEMENT' | ...
    event_type    TEXT,                      -- 'TRIGGER_WORKFLOW_ANOMALY_TYPE_04' | ...
    timestamp     TEXT NOT NULL,
    model_version TEXT,
    threshold     REAL,
    personalized_threshold REAL,
    reconstruction_error REAL,
    anomaly_detected INTEGER NOT NULL DEFAULT 0,
    input_hash    TEXT,
    top_features_json TEXT,                  -- [["stress_level",23.19],...]
    rule_engine_json TEXT,                   -- {is_emergency,severity,reasons[]}
    caregiver_json   TEXT,                   -- {action,confirmed,observations[]}
    raw_vitals_json  TEXT,                   -- full 8-feature snapshot
    training_label_proxy_json TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ml_events_patient
    ON ml_events(patient_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_ml_events_alert
    ON ml_events(alert_id);
  `,

  // 14: daily_care_entries — the per-day therapy log (pain before/after,
  // fatigue, sets completed, notes). Editable from the Care screen.
  `
  CREATE TABLE IF NOT EXISTS daily_care_entries (
    entry_id            TEXT PRIMARY KEY,
    patient_id          TEXT NOT NULL,
    care_plan_id        TEXT,
    entry_date          TEXT NOT NULL,
    therapy_day        INTEGER,
    logged_by_user_id   TEXT,
    logged_by_role      TEXT,
    therapy_completed   INTEGER NOT NULL DEFAULT 0,
    sets_completed      INTEGER NOT NULL DEFAULT 0,
    recommended_sets    INTEGER NOT NULL DEFAULT 0,
    pain_before         INTEGER,
    pain_after          INTEGER,
    fatigue             INTEGER,
    assistance_required TEXT,
    caregiver_concern   INTEGER NOT NULL DEFAULT 0,
    functional_task_score REAL,
    guided_movement_score INTEGER,
    notes               TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_care_patient_date
    ON daily_care_entries(patient_id, entry_date);
  `,

  // 15: medication source (care_plan vs custom) + appointments table
  `
  ALTER TABLE medications ADD COLUMN source TEXT NOT NULL DEFAULT 'care_plan';

  CREATE TABLE IF NOT EXISTS appointments (
    appointment_id   TEXT PRIMARY KEY,
    patient_id       TEXT NOT NULL,
    type             TEXT NOT NULL,
    provider         TEXT,
    date             TEXT NOT NULL,
    time             TEXT,
    location         TEXT,
    reason           TEXT,
    reminder         TEXT,
    status           TEXT NOT NULL DEFAULT 'scheduled',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_appointments_patient
    ON appointments(patient_id, date);
  `,

  // 16: UC2 decision-layer columns on alerts + ml_events
  // (see planning/23_uc2_ml_alert_notification_flow_plan.md §6)
  `
  ALTER TABLE alerts ADD COLUMN pipeline_path TEXT;
  ALTER TABLE alerts ADD COLUMN initial_anomaly_type TEXT;
  ALTER TABLE alerts ADD COLUMN post_hitl_anomaly_type TEXT;
  ALTER TABLE alerts ADD COLUMN feature_quality_json TEXT;
  ALTER TABLE alerts ADD COLUMN score_ratio REAL;
  ALTER TABLE alerts ADD COLUMN ae_score REAL;

  ALTER TABLE ml_events ADD COLUMN feature_quality_json TEXT;
  ALTER TABLE ml_events ADD COLUMN initial_anomaly_type TEXT;
  ALTER TABLE ml_events ADD COLUMN post_hitl_anomaly_type TEXT;
  ALTER TABLE ml_events ADD COLUMN score_ratio REAL;
  ALTER TABLE ml_events ADD COLUMN slm_task_json TEXT;
  ALTER TABLE ml_events ADD COLUMN threshold_recommendation_json TEXT;
  `,

  // 17: threshold_recommendations — queued personalization suggestions
  // (planning/23 §7.2). Never auto-applied; the caregiver confirms + audits.
  `
  CREATE TABLE IF NOT EXISTS threshold_recommendations (
    recommendation_id TEXT PRIMARY KEY,
    patient_id        TEXT NOT NULL,
    recommended_threshold REAL NOT NULL,
    adjustment_pct    REAL,
    reason            TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        TEXT NOT NULL,
    resolved_at       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_threshold_recs_patient
    ON threshold_recommendations(patient_id, status, created_at DESC);
  `,

  // 17: caregiver preferred name + functional classification fields
  `
  ALTER TABLE patients ADD COLUMN preferred_name TEXT;
  ALTER TABLE patients ADD COLUMN gmfcs TEXT;
  ALTER TABLE patients ADD COLUMN fms TEXT;
  ALTER TABLE patients ADD COLUMN macs TEXT;
  ALTER TABLE patients ADD COLUMN cfcs TEXT;
  ALTER TABLE patients ADD COLUMN edacs TEXT;
  `,

  // 18: normalized FHIR CarePlan fields + activities
  `
  ALTER TABLE care_plans ADD COLUMN status TEXT;
  ALTER TABLE care_plans ADD COLUMN intent TEXT;
  ALTER TABLE care_plans ADD COLUMN title TEXT;
  ALTER TABLE care_plans ADD COLUMN description TEXT;
  ALTER TABLE care_plans ADD COLUMN period_start TEXT;
  ALTER TABLE care_plans ADD COLUMN period_end TEXT;
  ALTER TABLE care_plans ADD COLUMN care_team_display_json TEXT;

  CREATE TABLE IF NOT EXISTS care_plan_activities (
    activity_id TEXT PRIMARY KEY,
    plan_id     TEXT NOT NULL,
    status      TEXT,
    description TEXT,
    sequence    INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_care_plan_activities_plan
    ON care_plan_activities(plan_id, sequence);
  `,

  // 19: normalized longitudinal rehabilitation measurements from provider FHIR
  `
  CREATE TABLE IF NOT EXISTS rehabilitation_measurements (
    measurement_id TEXT NOT NULL,
    patient_id      TEXT NOT NULL,
    type            TEXT NOT NULL,
    value           REAL NOT NULL,
    unit            TEXT NOT NULL,
    recorded_at     TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'fhir',
    created_at      TEXT NOT NULL,
    PRIMARY KEY (patient_id, measurement_id)
  );

  CREATE INDEX IF NOT EXISTS idx_rehab_measurements_patient_type_time
    ON rehabilitation_measurements(patient_id, type, recorded_at);
  `,

  // 20: generalized patient-scoped longitudinal observations from FHIR
  `
  CREATE TABLE IF NOT EXISTS patient_longitudinal_observations (
    patient_id        TEXT NOT NULL,
    observation_id   TEXT NOT NULL,
    measurement_type TEXT NOT NULL,
    recorded_at      TEXT NOT NULL,
    encounter_id     TEXT,
    numeric_value    REAL,
    text_value       TEXT,
    unit             TEXT,
    source_system    TEXT,
    source_code      TEXT NOT NULL,
    source_type      TEXT NOT NULL DEFAULT 'fhir',
    PRIMARY KEY (patient_id, observation_id)
  );

  CREATE INDEX IF NOT EXISTS idx_longitudinal_observations_patient_type_time
    ON patient_longitudinal_observations(patient_id, measurement_type, recorded_at);
  `,

  // 21: optional baseline health readings captured during onboarding
  `
  ALTER TABLE patients ADD COLUMN baseline_blood_oxygen TEXT;
  ALTER TABLE patients ADD COLUMN baseline_respiratory_rate TEXT;
  ALTER TABLE patients ADD COLUMN baseline_blood_pressure_systolic TEXT;
  ALTER TABLE patients ADD COLUMN baseline_blood_pressure_diastolic TEXT;
  ALTER TABLE patients ADD COLUMN baseline_glucose_level TEXT;
  ALTER TABLE patients ADD COLUMN baseline_body_temperature TEXT;
  `,

  // 22: demo medication confirmation requirement overrides
  `
  CREATE TABLE IF NOT EXISTS medication_confirmation_requirements (
    patient_id TEXT NOT NULL,
    medication_id TEXT NOT NULL,
    confirmation_requirement TEXT NOT NULL CHECK (
      confirmation_requirement IN ('required', 'not_required', 'not_provided')
    ),
    requirement_source TEXT NOT NULL CHECK (
      requirement_source IN ('demo_override', 'demo_fixture', 'fhir_extension', 'provider_configuration')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (patient_id, medication_id, requirement_source)
  );

  CREATE INDEX IF NOT EXISTS idx_med_confirmation_requirements_patient
    ON medication_confirmation_requirements(patient_id, medication_id);
  `,

  // 23: caregiver medication-confirmation preferences + notification delivery channel flags
  (db: SQLiteDatabase) => {
    db.execSync(`
    CREATE TABLE IF NOT EXISTS medication_confirmation_preferences (
      patient_id TEXT PRIMARY KEY,
      confirmation_mode TEXT NOT NULL DEFAULT 'all' CHECK (
        confirmation_mode IN ('all', 'required_only', 'personalized')
      ),
      selected_medication_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    `);

    const columns = db.getAllSync<{ name: string }>(
      `PRAGMA table_info(notification_preferences);`,
    );
    const hasDeviceEnabled = columns.some((column) => column.name === 'device_enabled');
    if (!hasDeviceEnabled) {
      db.execSync(`
      ALTER TABLE notification_preferences
        ADD COLUMN device_enabled INTEGER NOT NULL DEFAULT 1;
      `);
    }
  },

  // 24: source-traced patient timeline/context events curated from imported FHIR
  `
  CREATE TABLE IF NOT EXISTS patient_timeline_events (
    event_id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    visit_index INTEGER NOT NULL,
    days_from_first_visit INTEGER NOT NULL,
    days_before_latest_visit INTEGER NOT NULL,
    source_file TEXT NOT NULL,
    source_section TEXT NOT NULL,
    confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    transition_planning_relevance TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_patient_timeline_events_patient
    ON patient_timeline_events(patient_id, days_from_first_visit DESC, visit_index DESC);
  `,
];
