// src/app/logs.tsx
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FileLogger } from "react-native-file-logger";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const [files, setFiles] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const paths = await FileLogger.getLogFilePaths();
      const infos = paths.map((path) => {
        const file = new File(path);
        return {
          path,
          name: path.split("/").pop() ?? path,
          size: file.exists ? file.size ?? 0 : 0,
          modificationTime: file.exists ? file.modificationTime : null,
        };
      });
      infos.sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));
      setFiles(infos);
    } catch (err) {
      console.error("Failed to load log files", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
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
          await FileLogger.deleteLogFiles();
          loadFiles();
        },
      },
    ]);
  };

  function sendLogsByEmail() {
    FileLogger.sendLogFilesByEmail({
      to: "rahalncm@gmail.com",
      subject: "Log files from M-Health App",
      body: "Attached are the log files.",
      compressFiles: true,
    }).catch((err) => {
      console.error("Failed to send log files by email", err);
    });
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Log Files</Text>
          <Text style={styles.subtitle}>
            {files.length} file{files.length === 1 ? "" : "s"}
          </Text>
        </View>
        {files.length > 0 && (
          <Pressable
            onPress={handleDeleteAll}
            hitSlop={8}
            style={({ pressed }) => [
              styles.deleteAllButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.deleteAllText}>Delete all</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
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
              <Text style={styles.emptyTitle}>No log files yet</Text>
              <Text style={styles.emptySubtitle}>
                Log files will appear here once the app writes some.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => handleShare(item.path)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.fileMeta}>
                  {formatBytes(item.size)}
                  {item.modificationTime
                    ? ` · ${new Date(item.modificationTime).toLocaleString()}`
                    : ""}
                </Text>
              </View>
              <Text style={styles.shareLabel}>Share</Text>
            </Pressable>
          )}

        />
        <Pressable
            onPress={sendLogsByEmail}
            hitSlop={5}
            style={({ pressed }) => [
              styles.sendLogsButton,
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