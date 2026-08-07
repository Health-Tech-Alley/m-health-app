/**
 * DeprecatedModelsGate — startup gate for the models folder.
 *
 * Blocks the app surface until the models folder holds only complete files of
 * supported models. If deprecated files are found (unsupported / orphaned /
 * partial downloads), a blocking dialog with a single "Delete" action is shown
 * and the app (children) renders only after the folder is clean.
 *
 * The check is intentionally synchronous and cheap: one directory listing plus
 * a name+size comparison per file. A scan failure never blocks the app.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  classifyModelsFolderFiles,
  cleanModelsFolder,
  getModelsDirectory,
} from '@/services/model-storage';

/** Dialog copy builder — pure so the wording is unit-testable. */
export function deprecatedModelsDialogCopy(fileCount: number): {
  title: string;
  message: string;
  button: string;
} {
  const plural = fileCount === 1 ? '' : 's';
  return {
    title: 'Unsupported model files found',
    message:
      `The models folder contains ${fileCount} file${plural} that ${fileCount === 1 ? 'is' : 'are'} ` +
      'not a complete download of a supported model. These may be left over from ' +
      'a removed model or an interrupted download. Delete them now to keep the ' +
      'folder clean.',
    button: 'Delete',
  };
}

/** Scan the models folder for deprecated files. Returns the file names to remove. */
export function scanModelsFolderForDeprecated(): string[] {
  const dir = getModelsDirectory();
  const { remove } = classifyModelsFolderFiles(
    dir.list().map((item) => ({ name: item.name, size: item.size ?? 0 })),
  );
  return remove;
}

export function DeprecatedModelsGate({ children }: { children: ReactNode }) {
  const [deprecated, setDeprecated] = useState<string[] | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  const runCheck = useCallback(() => {
    try {
      setDeprecated(scanModelsFolderForDeprecated());
      setDeleteError(false);
    } catch (err) {
      // FS scan failure — never brick the app over a maintenance check.
      console.warn('[DeprecatedModelsGate] models folder scan failed:', err);
      setDeprecated([]);
    }
  }, []);

  useEffect(() => {
    // Defer the scan out of the effect body (react-hooks/set-state-in-effect).
    const t = setTimeout(() => runCheck(), 0);
    return () => clearTimeout(t);
  }, [runCheck]);

  const handleDelete = useCallback(() => {
    try {
      cleanModelsFolder();
      runCheck();
    } catch (err) {
      console.warn('[DeprecatedModelsGate] cleanup failed:', err);
      setDeleteError(true);
    }
  }, [runCheck]);

  // Scanning — show a blank (white) screen instead of flashing the app or a
  // black frame before the dialog/app decides.
  if (deprecated === null) {
    return <View style={styles.screen} />;
  }

  if (deprecated.length === 0) {
    return <>{children}</>;
  }

  const copy = deprecatedModelsDialogCopy(deprecated.length);

  return (
    <View style={styles.screen}>
      <View style={styles.dialog}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.message}>{copy.message}</Text>

        {deprecated.length > 0 && (
          <ScrollView style={styles.fileList} nestedScrollEnabled>
            {deprecated.map((name) => (
              <Text key={name} style={styles.fileName} numberOfLines={1}>
                {name}
              </Text>
            ))}
          </ScrollView>
        )}

        {deleteError ? (
          <Text style={styles.error}>Could not delete the files. Please try again.</Text>
        ) : null}

        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}>
          <Text style={styles.deleteButtonText}>{copy.button}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 24,
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#E7E9EF',
  },
  title: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  message: {
    color: '#4B5563',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  fileList: {
    maxHeight: 140,
    marginBottom: 12,
  },
  fileName: {
    color: '#6B7280',
    fontSize: 12,
    fontFamily: 'monospace',
    paddingVertical: 2,
  },
  error: {
    color: '#F00616',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  deleteButton: {
    backgroundColor: '#F52A37',
    borderRadius: 10,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonPressed: {
    opacity: 0.8,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
