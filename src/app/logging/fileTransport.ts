// src/logging/fileTransport.ts

import { Directory, File, Paths } from "expo-file-system";

const logsDir = new Directory(Paths.document, "logs");

async function ensureDir() {
  if (!logsDir.exists) {
    logsDir.create();
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