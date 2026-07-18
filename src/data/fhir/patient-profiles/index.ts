export type PatientProfileEntry = {
  id: string;
  label: string;
  data: unknown;
};

// Manifest of bundled sample FHIR patient profiles.
// Add one entry here for every .json file placed in src/data/fhir/patient-profiles.
const patientProfiles: PatientProfileEntry[] = [
  { id: "elena-gracia", label: "Elena Garcia", data: require("./elena-garcia.json") },
  { id: "james-okafor", label: "James Okafor", data: require("./james-okafor.json") },
  { id: "sofia-reyes", label: "Sofia Reyes", data: require("./sofia-reyes.json") },
  { id: "mike-ehr-v62", label: "Mike Thompson", data: require("./mike-thompson.json") },

  // add one entry per file in this folder
];

if (__DEV__) {
  validatePatientProfiles(patientProfiles);
}

function validatePatientProfiles(entries: PatientProfileEntry[]): void {
  const seenIds = new Set<string>();

  entries.forEach((entry, index) => {
    const prefix = `[patient-profiles] entry ${index}`;

    if (!entry.id) {
      console.warn(`${prefix} is missing an "id".`);
    } else if (seenIds.has(entry.id)) {
      console.warn(
        `${prefix} ("${entry.id}") has a duplicate id. Each entry needs a unique id.`,
      );
    } else {
      seenIds.add(entry.id);
    }

    if (!entry.label) {
      console.warn(`${prefix} ("${entry.id ?? "unknown"}") is missing a "label".`);
    }

    if (entry.data === undefined || entry.data === null) {
      console.warn(
        `${prefix} ("${entry.id ?? "unknown"}") has no data. Check that the ` +
          `require(...) path points to a valid .json file.`,
      );
    } else if (typeof entry.data !== "object") {
      console.warn(
        `${prefix} ("${entry.id ?? "unknown"}") data is not a JSON object. ` +
          `Got type "${typeof entry.data}" — check the source file.`,
      );
    }
  });

  if (entries.length === 0) {
    console.warn(
      "[patient-profiles] No entries in the manifest. Add profiles to " +
        "src/data/fhir/patient-profiles/index.ts.",
    );
  }
}

export default patientProfiles;
