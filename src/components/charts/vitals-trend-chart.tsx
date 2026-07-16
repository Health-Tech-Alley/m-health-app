/**
 * Lightweight vitals trend chart.
 *
 * `react-native-svg` is not a direct dependency in this repo, so this chart
 * is implemented with pure React Native `View` primitives: a relative box
 * with absolutely-positioned dots and connecting segments approximated by
 * thin rotated rectangles. If the sample set is too small to plot, it falls
 * back to a text-based list of the most recent values.
 *
 * Props:
 * - `samples`: `{ value, recordedAt }[]` ordered oldest → newest.
 * - `threshold`: optional `{ value, direction }` drawn as a horizontal rule.
 * - `unit`: label appended to the value axis.
 * - `color`: line color (defaults to brand teal).
 */

import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';

export type VitalsSample = { value: number; recordedAt: string };

export type VitalsTrendChartProps = {
  samples: VitalsSample[];
  threshold?: { value: number; direction: 'above' | 'below' };
  unit?: string;
  color?: string;
  height?: number;
};

const DEFAULT_COLOR = '#0E6F68';
const CHART_HEIGHT = 120;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function VitalsTrendChart({
  samples,
  threshold,
  unit,
  color = DEFAULT_COLOR,
  height = CHART_HEIGHT,
}: VitalsTrendChartProps) {
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  };

  const model = useMemo(() => {
    if (!width || samples.length === 0) return null;

    const values = samples.map((s) => s.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (threshold) {
      min = Math.min(min, threshold.value);
      max = Math.max(max, threshold.value);
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const padTop = 12;
    const padBottom = 12;
    const plotH = height - padTop - padBottom;
    const range = max - min;

    const points = samples.map((s, i) => {
      const x = samples.length === 1 ? width / 2 : (i / (samples.length - 1)) * width;
      const y = padTop + plotH - ((s.value - min) / range) * plotH;
      return { x, y, value: s.value, recordedAt: s.recordedAt };
    });

    const segments: { x1: number; y1: number; x2: number; y2: number; len: number; angle: number }[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, angle });
    }

    const thresholdY = threshold
      ? padTop + plotH - ((threshold.value - min) / range) * plotH
      : null;

    return { points, segments, thresholdY, min, max };
  }, [samples, threshold, width, height]);

  // Fallback: text list when there's nothing to plot.
  if (samples.length === 0) {
    return (
      <View style={styles.container} onLayout={onLayout}>
        <Text style={styles.empty}>No vitals recorded yet.</Text>
      </View>
    );
  }

  if (samples.length < 2 || !model) {
    return (
      <View style={styles.container} onLayout={onLayout}>
        <View style={styles.textList}>
          {samples
            .slice(-4)
            .map((s) => (
              <Text key={s.recordedAt} style={styles.textItem}>
                {formatTime(s.recordedAt)} — {s.value}
                {unit ?? ''}
              </Text>
            ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]} onLayout={onLayout}>
      {/* Threshold line */}
      {model.thresholdY != null && (
        <View
          style={[
            styles.thresholdLine,
            { top: model.thresholdY, width },
          ]}
        />
      )}

      {/* Connecting segments (rotated thin rectangles) */}
      {model.segments.map((seg, i) => (
        <View
          key={`seg-${i}`}
          style={[
            styles.segment,
            {
              left: seg.x1,
              top: seg.y1,
              width: seg.len,
              transform: [{ rotate: `${seg.angle}deg` }],
              backgroundColor: color,
            },
          ]}
        />
      ))}

      {/* Data points */}
      {model.points.map((p, i) => (
        <View
          key={`pt-${i}`}
          style={[styles.point, { left: p.x - 3, top: p.y - 3, backgroundColor: color }]}
        />
      ))}

      {/* Range labels */}
      <Text style={[styles.rangeLabel, { top: 0 }]}>{model.max}</Text>
      <Text style={[styles.rangeLabel, { bottom: 0 }]}>{model.min}</Text>
      {unit ? <Text style={styles.unitLabel}>{unit}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
    backgroundColor: '#F7FAF9',
    borderRadius: 12,
    padding: 8,
  },
  empty: {
    color: '#526866',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
  textList: {
    gap: 4,
    paddingVertical: 6,
  },
  textItem: {
    color: '#123433',
    fontSize: 13,
  },
  segment: {
    position: 'absolute',
    height: 2,
    transformOrigin: 'left center',
  },
  point: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  thresholdLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: '#B42318',
    opacity: 0.7,
    borderStyle: 'dashed',
  },
  rangeLabel: {
    position: 'absolute',
    right: 4,
    fontSize: 10,
    color: '#526866',
  },
  unitLabel: {
    position: 'absolute',
    left: 8,
    top: 0,
    fontSize: 10,
    color: '#526866',
    fontWeight: '600',
  },
});
