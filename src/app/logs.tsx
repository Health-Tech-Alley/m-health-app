// src/app/logs.tsx
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
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
import { useTranslation } from "@/hooks/use-translation";

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t, locale } = useTranslation();
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
      Alert.alert(t("logs.shareUnavailable"));
      return;
    }
    await Sharing.shareAsync(path);
  };

  const handleDeleteAll = () => {
    Alert.alert(t("logs.deleteAllDialog.title"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
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

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/more" as never);
  }, [router]);

  return (
    <View
      style={[
        styles.container,
        themedStyles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={[styles.topBar, themedStyles.header]}>
        <Pressable
          onPress={handleBack}
          hitSlop={12}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t("logs.backA11y")}
        >
          <Text style={[styles.backText, themedStyles.backText]}>{"\u2190"} {t("common.back")}</Text>
        </Pressable>
      </View>

      <View style={[styles.header, themedStyles.header]}>
        <View>
          <Text style={[styles.title, themedStyles.title]}>{t("logs.title")}</Text>
          <Text style={[styles.subtitle, themedStyles.subtitle]}>
            {t(files.length === 1 ? "logs.fileCount.one" : "logs.fileCount.many", {
              count: files.length,
            })}
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
            accessibilityRole="button"
            accessibilityLabel={t("logs.deleteAllA11y")}
          >
            <Text style={[styles.deleteAllText, themedStyles.deleteAllText]}>{t("logs.deleteAll")}</Text>
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
                  {unavailable ? t("logs.empty.unavailableTitle") : t("logs.empty.title")}
                </Text>
                <Text style={[styles.emptySubtitle, themedStyles.emptySubtitle]}>
                  {unavailable
                    ? t("logs.empty.unavailableBody")
                    : t("logs.empty.body")}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, themedStyles.row, pressed && styles.pressed]}
                onPress={() => handleShare(item.path)}
                accessibilityRole="button"
                accessibilityLabel={t("logs.shareFileA11y", { name: item.name })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fileName, themedStyles.fileName]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[styles.fileMeta, themedStyles.fileMeta]}>
                    {formatBytes(item.size)}
                    {item.modificationTime
                      ? ` \u00b7 ${new Date(item.modificationTime).toLocaleString(locale)}`
                      : ""}
                  </Text>
                </View>
                <Text style={[styles.shareLabel, themedStyles.shareLabel]}>{t("logs.share")}</Text>
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
            accessibilityRole="button"
            accessibilityLabel={t("logs.sendByEmailA11y")}
          >
            <Text style={styles.sendLogsButtonText}>{t("logs.sendByEmail")}</Text>
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
    backText: {
      color: isDark ? AppTheme.colors.brand : "#0E6F68",
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
  topBar: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingRight: 12,
  },
  backText: {
    color: "#0E6F68",
    fontSize: 14,
    fontWeight: "900",
  },
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
