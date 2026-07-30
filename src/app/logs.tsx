// src/app/logs.tsx
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type LogFile = {
  path: string;
  name: string;
  size: number;
  modificationTime: number | null;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LogsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(theme), [theme]);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      setUnavailable(false);
      const logsDir = new Directory(Paths.document, "logs");

      if (!logsDir.exists) {
        setFiles([]);
        return;
      }
      const entries = logsDir.list();
      const infos = entries
        .filter(
          (entry): entry is File =>
            entry instanceof File && entry.name.endsWith(".log")
        )
        .map((file) => ({
          path: file.uri,
          name: file.name,
          size: file.size ?? 0,
          modificationTime: file.modificationTime,
        })); 
      console.log("Log file infos:", infos);
      infos.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
      setFiles(infos);
    } catch (err) {
      console.error("Failed to load log files", err);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer to a microtask so the state updates inside loadFiles do not run
    // synchronously within the effect (react-hooks/set-state-in-effect).
    const handle = setTimeout(() => {
      void loadFiles();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadFiles]);

  const handleShare = async (path: string) => {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert("Sharing not available on this device");
      return;
    }
    await Sharing.shareAsync(path);
  };

  const handleDeleteAll = () => {
    Alert.alert("Delete all log files?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const logsDir = new Directory(Paths.document, "logs");
          if (logsDir.exists) {
            for (const entry of logsDir.list()) {
              if (entry instanceof File) {
                entry.delete();
              }
            }
          }
          loadFiles();
        },
      },
    ]);
  };

  const sendLogsByEmail = async () => {
    // const FileLogger = await loadFileLogger();
    // if (!FileLogger) {
    //   Alert.alert("File logging unavailable in this build");
    //   return;
    // }
    // FileLogger.sendLogFilesByEmail({
    //   to: "rahalncm@gmail.com",
    //   subject: "Log files from M-Health App",
    //   body: "Attached are the log files.",
    //   compressFiles: true,
    // }).catch((err) => {
    //   console.error("Failed to send log files by email", err);
    // });
  };

  return (
    <View
      style={[
        styles.container,
        themedStyles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={[styles.header, themedStyles.header]}>
        <View>
          <Text style={[styles.title, themedStyles.title]}>Log Files</Text>
          <Text style={[styles.subtitle, themedStyles.subtitle]}>
            {files.length} file{files.length === 1 ? "" : "s"}
          </Text>
        </View>
        {files.length > 0 && (
          <Pressable
            onPress={handleDeleteAll}
            hitSlop={8}
            style={({ pressed }) => [
              styles.deleteAllButton,
              themedStyles.deleteAllButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.deleteAllText, themedStyles.deleteAllText]}>Delete all</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={[styles.center, themedStyles.container]}>
          <ActivityIndicator color={theme.appBackground === "#000000" ? theme.appTextMuted : undefined} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={files}
            keyExtractor={(item) => item.path}
            onRefresh={loadFiles}
            refreshing={loading}
            contentContainerStyle={
              files.length === 0 ? styles.emptyContainer : styles.listContent
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={[styles.emptyTitle, themedStyles.emptyTitle]}>
                  {unavailable ? "Logging unavailable" : "No log files yet"}
                </Text>
                <Text style={[styles.emptySubtitle, themedStyles.emptySubtitle]}>
                  {unavailable
                    ? "File logging unavailable in this build (native module not linked)."
                    : "Log files will appear here once the app writes some."}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, themedStyles.row, pressed && styles.pressed]}
                onPress={() => handleShare(item.path)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fileName, themedStyles.fileName]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.fileMeta, themedStyles.fileMeta]}>
                    {formatBytes(item.size)}
                    {item.modificationTime
                      ? ` · ${new Date(item.modificationTime).toLocaleString()}`
                      : ""}
                  </Text>
                </View>
                <Text style={[styles.shareLabel, themedStyles.shareLabel]}>Share</Text>
              </Pressable>
            )}
          />
          <Pressable
            onPress={() => {
              void sendLogsByEmail();
            }}
            hitSlop={5}
            style={({ pressed }) => [
              styles.sendLogsButton,
              themedStyles.sendLogsButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.sendLogsButtonText}>Send logs by email</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function createThemedStyles(theme: ReturnType<typeof useTheme>) {
  const isDark = theme.appBackground === "#000000";

  return StyleSheet.create({
    container: {
      backgroundColor: isDark ? theme.appBackground : "#F7F7F8",
    },
    header: {
      backgroundColor: isDark ? theme.appBackground : "#F7F7F8",
    },
    title: {
      color: isDark ? theme.appText : "#111",
    },
    subtitle: {
      color: isDark ? theme.appTextMuted : "#888",
    },
    deleteAllButton: {
      backgroundColor: isDark ? theme.appControlSurface : "#FDECEC",
      borderColor: isDark ? AppTheme.colors.danger : "transparent",
      borderWidth: isDark ? 1 : 0,
    },
    deleteAllText: {
      color: isDark ? AppTheme.colors.dangerLight : "#D9534F",
    },
    emptyTitle: {
      color: isDark ? theme.appText : "#333",
    },
    emptySubtitle: {
      color: isDark ? theme.appTextSupporting : "#999",
    },
    row: {
      backgroundColor: isDark ? theme.appSurface : "#fff",
      borderColor: isDark ? theme.appBorder : "transparent",
      borderWidth: isDark ? 1 : 0,
    },
    fileName: {
      color: isDark ? theme.appText : "#111",
    },
    fileMeta: {
      color: isDark ? theme.appTextMuted : "#888",
    },
    shareLabel: {
      color: isDark ? AppTheme.colors.heroAccentSoft : "#007AFF",
    },
    sendLogsButton: {
      backgroundColor: isDark ? AppTheme.colors.brand : "#0E6F68",
    },
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F8",
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#111" },
  subtitle: { fontSize: 13, color: "#888", marginTop: 2 },
  deleteAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#FDECEC",
  },
  deleteAllText: { color: "#D9534F", fontWeight: "600", fontSize: 13 },
  pressed: { opacity: 0.6 },
  listContent: { paddingBottom: 24 },
  emptyContainer: { flex: 1 },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  emptySubtitle: {
    fontSize: 13,
    color: "#999",
    textAlign: "center",
    marginTop: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  fileName: { fontWeight: "600", fontSize: 14, color: "#111" },
  fileMeta: { color: "#888", fontSize: 12, marginTop: 3 },
  shareLabel: { color: "#007AFF", fontWeight: "600", fontSize: 13 },
  sendLogsButton: {
    backgroundColor: '#0E6F68',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 16,
    marginHorizontal: 20
  },
  sendLogsButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
