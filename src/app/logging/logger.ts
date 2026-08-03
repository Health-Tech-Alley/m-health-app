import { logger } from "react-native-logs";
import { appendLog } from "./fileTransport";

export const log = logger.createLogger({
  severity: "debug",

  transport: async (props) => {
    await appendLog(
      props.level.text.toUpperCase(),
      formatMessage(props.rawMsg)
    );
  },
});

function formatMessage(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;

        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .join(" ");
  }

  try {
    return typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}
