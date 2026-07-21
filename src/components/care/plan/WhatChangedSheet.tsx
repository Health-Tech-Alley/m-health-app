/**
 * "What changed" modal (Care tab rework).
 *
 * The decision digest used to be its own always-visible section; it now
 * lives behind the "What changed" button on the care plan header card.
 * Content is unchanged — recent plan decisions with dates — plus a pointer
 * to the full audit log in Settings.
 */

import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { CarePlanHistoryItem } from '@/services/carePlan/carePlanViewModel';

export interface WhatChangedSheetProps {
  visible: boolean;
  items: CarePlanHistoryItem[];
  onClose: () => void;
}

export function WhatChangedSheet({ visible, items, onClose }: WhatChangedSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>What changed</Text>
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>
            Recent plan decisions (proposals, confirmations, updates). The full audit log is in
            Settings.
          </Text>
          <ScrollView style={styles.body} showsVerticalScrollIndicator>
            {items.length === 0 ? (
              <Text style={styles.empty}>No plan decisions recorded yet.</Text>
            ) : (
              items.map((item) => (
                <View key={item.id} style={styles.row}>
                  <Text style={styles.bullet}>{'\u2022'}</Text>
                  <View style={styles.textBlock}>
                    <Text style={styles.summary}>{item.summary}</Text>
                    <Text style={styles.at}>{item.at.slice(0, 10)}</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: AppTheme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
    maxHeight: '70%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: AppTheme.colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: AppTheme.colors.softSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: AppTheme.colors.textSoft,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginBottom: 10,
  },
  body: {
    flexGrow: 0,
  },
  empty: {
    color: AppTheme.colors.textSoft,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: AppTheme.colors.border,
  },
  bullet: {
    color: AppTheme.colors.brand,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  textBlock: {
    flex: 1,
  },
  summary: {
    color: AppTheme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  at: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
