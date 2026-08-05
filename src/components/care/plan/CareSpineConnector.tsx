/**
 * Care spine connector (Care tab hero rework).
 *
 * A quiet vertical spine in a dedicated left gutter (outside the cards)
 * drops from the hero and branches into each section with a small node.
 * Node color = that section's attention state. No looping packet animation
 * (it read as noise); entrance is a single smooth fade-in.
 *
 * Pure RN Views — no SVG. SpineSection pins each node to the card **title**
 * band (not section center), so expand/collapse inside a card does not move
 * that node. The connector is absolutely positioned in the scroll content so
 * it scrolls with the cards.
 */

import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { AppTheme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PlanPulseAttention } from '@/services/carePlan/planPulseService';

export type SpineAttention = PlanPulseAttention | 'empty';

export interface SpineNode {
  id: string;
  /** Title-band Y within the scroll content (from SpineSection onLayout). */
  y: number;
  attention: SpineAttention;
  /** Item count in the section — drives branch thickness slightly. */
  weight: number;
}

/**
 * Distance from section top to the visual center of a typical card title
 * (card padding 16 + ~half of 16–18px title line). Kept fixed so node Y
 * ignores body height changes on expand/collapse.
 */
export const SPINE_TITLE_ANCHOR_OFFSET = 28;

/**
 * Dedicated left gutter width. Cards sit to the right of this so the spine
 * never overlaps content. Keep in sync with care.tsx content paddingLeft.
 */
export const SPINE_GUTTER = 28;

// Spine column sits on the hero socket/card-frame anchor.
const SPINE_X = 18;
const BRANCH_END_X = SPINE_GUTTER - 1;
const NODE_SIZE = 9;
const SPINE_WIDTH = 2;

export const SPINE_NODE_COLORS: Record<SpineAttention, string> = {
  calm: AppTheme.colors.brand,
  review: AppTheme.colors.attentionAmber,
  urgent: AppTheme.colors.danger,
  empty: AppTheme.colors.navMuted,
};

function branchThickness(weight: number): number {
  if (weight <= 0) return 1.5;
  if (weight <= 3) return 2;
  if (weight <= 7) return 2.5;
  return 3;
}

// ---------------------------------------------------------------------------
// SpineSection — pins node to title band; no left rail (avoids card overlap)
// ---------------------------------------------------------------------------

export interface SpineSectionProps {
  id: string;
  attention: SpineAttention;
  /** Receives title-band Y in scroll-content coordinates (not section center). */
  onMeasure?: (id: string, titleY: number) => void;
  children: React.ReactNode;
}

export function SpineSection({ id, onMeasure, children }: SpineSectionProps) {
  return (
    <View
      style={styles.sectionWrap}
      onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        // Pin to title, not vertical center — body expand/collapse must not
        // drag the node. Sections above still reflow and update `y` correctly.
        if (height > 0) onMeasure?.(id, y + SPINE_TITLE_ANCHOR_OFFSET);
      }}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// CareSpineConnector
// ---------------------------------------------------------------------------

export interface CareSpineConnectorProps {
  /** Bottom edge Y of the hero card within the scroll content. */
  heroBottomY: number | null;
  nodes: SpineNode[];
  playEntrance?: boolean;
  reduceMotion?: boolean;
}

export function CareSpineConnector({
  heroBottomY,
  nodes,
  playEntrance = false,
  reduceMotion = false,
}: CareSpineConnectorProps) {
  const theme = useTheme();
  const themedStyles = useMemo(() => createThemedStyles(), []);
  const sorted = useMemo(
    () => [...nodes].sort((a, b) => a.y - b.y),
    [nodes],
  );
  const lastY = sorted.length > 0 ? sorted[sorted.length - 1].y : null;
  const ready = heroBottomY != null && lastY != null && lastY > heroBottomY + 8;

  const [opacity] = useState(() => new Animated.Value(playEntrance && !reduceMotion ? 0 : 1));

  useEffect(() => {
    if (!ready) return;
    if (!playEntrance || reduceMotion) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, 420);
    return () => clearTimeout(timer);
  }, [ready, playEntrance, reduceMotion, opacity]);

  if (!ready || heroBottomY == null || lastY == null) return null;

  // Spine drops from the hero socket (just above hero bottom) to the last node.
  const spineTop = heroBottomY - 6;
  const spineHeight = Math.max(0, lastY - spineTop);

  return (
    <Animated.View style={[styles.connector, { opacity }]} pointerEvents="none">
      {/* Vertical spine — reads as continuing out of the hero socket */}
      <View
        style={[
          styles.spine,
          themedStyles.spine,
          {
            top: spineTop,
            height: spineHeight,
          },
        ]}
      />

      {/* Branches + nodes at each section title */}
      {sorted.map((node) => {
        const color = getSpineNodeColor(node.attention, theme);
        const thickness = branchThickness(node.weight);
        return (
          <View key={node.id} pointerEvents="none">
            <View
              style={[
                styles.branch,
                {
                  top: node.y - thickness / 2,
                  height: thickness,
                  backgroundColor: color,
                  opacity: node.attention === 'empty' ? 0.4 : 0.85,
                },
              ]}
            />
            <View
              style={[
                styles.node,
                {
                  top: node.y - NODE_SIZE / 2,
                  backgroundColor: color,
                  borderColor:
                    node.attention === 'empty'
                      ? theme.appBorder
                      : theme.appSurface,
                  opacity: node.attention === 'empty' ? 0.5 : 1,
                },
              ]}
            />
          </View>
        );
      })}
    </Animated.View>
  );
}

function getSpineNodeColor(
  attention: SpineAttention,
  theme: ReturnType<typeof useTheme>,
): string {
  const isDark = theme.appBackground === '#000000';
  if (attention === 'calm') return isDark ? AppTheme.colors.brandPale : AppTheme.colors.brand;
  if (attention === 'review') return AppTheme.colors.attentionAmber;
  if (attention === 'urgent') return AppTheme.colors.danger;
  return theme.appTextMuted;
}

function createThemedStyles() {
  return StyleSheet.create({
    spine: {
      backgroundColor: AppTheme.colors.heroAccentSoft,
    },
  });
}

const styles = StyleSheet.create({
  sectionWrap: {
    // Cards keep full width of the content column (to the right of the gutter).
  },
  connector: {
    // Positioned in the content's left gutter (cards are padded past this).
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: SPINE_GUTTER,
    zIndex: 0,
  },
  spine: {
    position: 'absolute',
    left: SPINE_X - SPINE_WIDTH / 2,
    width: SPINE_WIDTH,
    backgroundColor: AppTheme.colors.heroAccentSoft,
    borderRadius: 1,
  },
  branch: {
    position: 'absolute',
    left: SPINE_X,
    // Short stub into the card edge — does not draw over card content.
    width: Math.max(6, BRANCH_END_X - SPINE_X),
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  node: {
    position: 'absolute',
    left: SPINE_X - NODE_SIZE / 2,
    width: NODE_SIZE,
    height: NODE_SIZE,
    borderRadius: NODE_SIZE / 2,
    borderWidth: 2,
  },
});
