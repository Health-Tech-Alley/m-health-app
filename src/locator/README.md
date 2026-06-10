# `src/locator/` — L7 Geofence + Service Locator

> **Status:** scaffold (empty) — **DEFERRED / SCOPE(out)** for the current milestone.

The geofenced **service locator** (pharmacies, clinics, NEMT/transport, respite, food banks for Frederick
County, MD) is **not** one of the three primary steel threads. It is a deferred concern, kept here as a
placeholder so the architecture is complete. Revisit only after **ST-01 Ambient Anomaly Detection**,
**ST-02 Recovery Trajectory**, and **ST-03 Acute Escalation** are demoable.

**What will eventually live here:** the CoreLocation (iOS) / FusedLocationProvider (Android) bridges,
Frederick County CBO resource records, and the proximity scoring the Context Aggregator fuses into SLM context.

**Primary owners:** Rahal + Ethan.
