import { store } from '@/store';
import { ingestSamplesBatch, LiveVitalReading } from "@/store/reducers/vitalsSlice";
import { InteractionManager } from "react-native";

export function runInBackground(task: () => void | Promise<void>): void {
  InteractionManager.runAfterInteractions(() => {
    void task();
  });
}

export async function dispatchInChunks(
  readings: LiveVitalReading[],
  chunkSize = 50,
): Promise<void> {
  for (let i = 0; i < readings.length; i += chunkSize) {
    store.dispatch(ingestSamplesBatch({ samples: readings.slice(i, i + chunkSize) }));
    await new Promise((resolve) => setTimeout(resolve, 0)); // yield back to JS thread
  }
}
