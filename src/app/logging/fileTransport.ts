// fileTransport.ts

import { dispatchImmediate } from "@/services/notifications/notificationService";
import { Directory, File, Paths } from "expo-file-system";

const logsDir = new Directory(Paths.document, "logs");

async function ensureDir() {
  try {
    if (!logsDir.exists) {
      logsDir.create();
    }
  } catch (e) {
    await dispatchImmediate({
              patientId: '1234',
              scope: 'anomaly',
              title: "Logging Error",
              body: 'Failed to create logs directory',
              severity: 1,
            });
  }
}

function todayFileName() {
  const today = new Date().toISOString().slice(0, 10);
  return `app-${today}.log`;
}

export async function appendLog(
  level: string,
  message: string,
) {
  await ensureDir();

  const file = new File(logsDir, todayFileName());

  const line =
    `${new Date().toISOString()} [${level}] ${message}\n`;

  if (!file.exists) {
    file.create();
  }

  file.write(line, {
    append: true,
  });
}