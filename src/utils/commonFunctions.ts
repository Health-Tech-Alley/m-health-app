import { store } from '@/store';
import { ingestSamplesBatch, LiveVitalReading } from "@/store/reducers/vitalsSlice";
import { InteractionManager } from "react-native";


export function calculateAge(birthdate: Date): number | null {
    if (Number.isNaN(birthdate.getTime())) return null;
    const today: Date = new Date();
    const diff: number = today.getTime() - birthdate.getTime();
    const ageDate: Date = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
}

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