/**
 * SQLite migrations.
 *
 * Each entry is a single SQL script run in order. Migrations are idempotent
 * where possible (CREATE TABLE IF NOT EXISTS, etc.).
 */

export const MIGRATIONS: string[] = [
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
];
