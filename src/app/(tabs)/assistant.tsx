/**
 * Assistant tab — the caregiver SLM prompt interface as a main-nav tab.
 *
 * Renders the shared SLM chat screen (`src/app/slm.tsx`) without the stack
 * "← Back" button so it behaves as a persistent tab rather than a pushed
 * screen.
 */

import SlmScreen from "../slm";

export default function AssistantTab() {
  return <SlmScreen showBackButton={false} />;
}
