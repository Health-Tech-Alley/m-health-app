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
  const [files, setFiles] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const paths = await FileLogger.getLogFilePaths();
      console.log("Log file paths:", paths);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Log Files</Text>
        {files.length > 0 && (
          <Pressable onPress={handleDeleteAll}>
            <Text style={styles.deleteAll}>Delete all</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={files}
        keyExtractor={(item) => item.path}
        onRefresh={loadFiles}
        refreshing={loading}
        ListEmptyComponent={
          <Text style={styles.empty}>No log files found</Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => handleShare(item.path)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName}>{item.name}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  title: { fontSize: 20, fontWeight: "600" },
  deleteAll: { color: "#d9534f" },
  empty: { textAlign: "center", marginTop: 40, color: "#888" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  fileName: { fontWeight: "500" },
  fileMeta: { color: "#888", fontSize: 12, marginTop: 2 },
  shareLabel: { color: "#007aff" },
});