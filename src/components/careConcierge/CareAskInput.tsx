/**
 * CareAskInput — single-line free-text router into the Care intent catalog
 * (planning/40 P1). Never auto-runs SLM; resolutions open a sheet or chips.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppTheme } from '@/constants/theme';
import type { AdcpProposalIntentId } from '@/data/adcp/types';
import type { PatientRecordSnapshot } from '@/data/types';
import type { NluEmbedder } from '@/nlu/types';
import {
  resolveCareText,
  type CareTextResolution,
} from '@/services/carePlan/coaching';

export type CareAskLaunch = {
  intent: AdcpProposalIntentId;
  args: Record<string, unknown>;
};

export interface CareAskInputProps {
  snapshot: PatientRecordSnapshot | null;
  patientName?: string;
  embedder?: NluEmbedder | null;
  onLaunch: (launch: CareAskLaunch) => void;
  /** Optional: open Concierge with carried text (no auto-send). */
  onConciergeHandoff?: (text: string) => void;
  disabled?: boolean;
}

export function CareAskInput({
  snapshot,
  patientName,
  embedder,
  onLaunch,
  onConciergeHandoff,
  disabled = false,
}: CareAskInputProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState<CareTextResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refuseMessage, setRefuseMessage] = useState<string | null>(null);

  const placeholder = patientName
    ? `Ask about ${patientName}'s plan…`
    : "Ask about the care plan…";

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    setBusy(true);
    setError(null);
    setRefuseMessage(null);
    setResolution(null);
    try {
      const { evaluateSafetyRefuseGate } = await import(
        '@/services/slm/safety-refuse-guardrails'
      );
      const safety = evaluateSafetyRefuseGate(trimmed);
      if (safety.refuse) {
        setRefuseMessage(safety.message);
        return;
      }

      let activeEmbedder = embedder ?? null;
      if (!activeEmbedder) {
        try {
          const { createReadyEmbedder } = await import('@/knowledge/embedder');
          const { DEFAULT_TFLITE_EMBEDDER_LOAD_MS } = await import(
            '@/knowledge/embedder'
          );
          activeEmbedder = await createReadyEmbedder(DEFAULT_TFLITE_EMBEDDER_LOAD_MS, {
            allowDevelopmentFallback: __DEV__,
          });
        } catch {
          activeEmbedder = null;
        }
      }
      const result = await resolveCareText(trimmed, {
        snapshot,
        embedder: activeEmbedder,
      });
      setResolution(result);
      if (result.kind === 'preselect') {
        onLaunch({ intent: result.intent, args: result.args });
        setText('');
      } else if (result.kind === 'concierge_handoff') {
        onConciergeHandoff?.(result.carryText);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not understand that yet.');
    } finally {
      setBusy(false);
    }
  }, [text, busy, disabled, snapshot, embedder, onLaunch, onConciergeHandoff]);

  return (
    <View style={styles.card} accessible accessibilityLabel="Ask about the care plan">
      <Text style={styles.title}>Ask about the plan</Text>
      <Text style={styles.subtitle}>
        Type a short request. Concierge will suggest a plan action — you still confirm.
      </Text>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={AppTheme.colors.textSoft}
          editable={!disabled && !busy}
          style={styles.input}
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
          maxLength={500}
        />
        <Pressable
          onPress={() => void submit()}
          disabled={disabled || busy || !text.trim()}
          style={[
            styles.send,
            (!text.trim() || disabled || busy) && styles.sendDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Submit care question"
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendText}>Ask</Text>
          )}
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {refuseMessage ? (
        <View style={styles.refuse} accessibilityRole="text">
          <Text style={styles.refuseTitle}>Couldn&apos;t apply that</Text>
          <Text style={styles.refuseBody}>{refuseMessage}</Text>
        </View>
      ) : null}

      {resolution?.kind === 'emergency' ? (
        <View style={styles.emergency}>
          <Text style={styles.emergencyTitle}>This may be an emergency</Text>
          <Text style={styles.emergencyBody}>
            If someone is in immediate danger, call 911 or go to the ER. Concierge does not
            replace emergency care.
          </Text>
        </View>
      ) : null}

      {resolution?.kind === 'single_chip' || resolution?.kind === 'multi_chip' ? (
        <View style={styles.chips}>
          <Text style={styles.chipHint}>
            {resolution.kind === 'single_chip' ? 'Did you mean:' : 'Try one of these:'}
          </Text>
          {resolution.chips.map((c) => (
            <Pressable
              key={c.chipId}
              style={styles.chip}
              onPress={() => {
                onLaunch({ intent: c.intent, args: c.args });
                setText('');
                setResolution(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={c.label}
            >
              <Text style={styles.chipText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {resolution?.kind === 'concierge_handoff' ? (
        <Text style={styles.handoff}>
          That looks like a general Concierge question. Open the Concierge tab to continue.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: AppTheme.colors.surface,
    borderRadius: AppTheme.radius.card,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    padding: 14,
    marginBottom: 12,
  },
  title: {
    color: AppTheme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  subtitle: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: AppTheme.colors.text,
    backgroundColor: AppTheme.colors.screen,
    fontSize: 14,
    fontWeight: '600',
  },
  send: {
    backgroundColor: '#0E6F68',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 56,
    alignItems: 'center',
  },
  sendDisabled: {
    opacity: 0.45,
  },
  sendText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  error: {
    color: AppTheme.colors.danger,
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  refuse: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: AppTheme.colors.softSurface,
    borderWidth: 1,
    borderColor: AppTheme.colors.border,
  },
  refuseTitle: {
    color: AppTheme.colors.text,
    fontWeight: '900',
    fontSize: 13,
  },
  refuseBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 4,
  },
  emergency: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: AppTheme.colors.danger,
  },
  emergencyTitle: {
    color: AppTheme.colors.text,
    fontWeight: '900',
    fontSize: 13,
  },
  emergencyBody: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 4,
  },
  chips: {
    marginTop: 10,
    gap: 8,
  },
  chipHint: {
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: '#E6F4F3',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#0E6F68',
  },
  chipText: {
    color: '#0E6F68',
    fontWeight: '800',
    fontSize: 12,
  },
  handoff: {
    marginTop: 8,
    color: AppTheme.colors.textSoft,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
});
