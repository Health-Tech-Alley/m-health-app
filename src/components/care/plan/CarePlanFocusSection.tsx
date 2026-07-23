/**
 * Care plan "This week's focus" section (planning/41 §5).
 *
 * Primary surface for live care-focus cards (with respond actions) so
 * non-therapy patients still get full HITL. Durable plan priorities render
 * as summary rows. Full interactive cards are never nested only under Therapy.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Uc4PriorityCard } from '@/components/care/Uc4PriorityCard';
import { AppTheme } from '@/constants/theme';
import type { LatestUc4PriorityCardSummary } from '@/data/types';
import type { Uc4CardResponseAction } from '@/services/uc4/uc4EvaluationService';
import { sectionStyles } from './carePlanSectionStyles';
import type { CarePlanFocusCard } from '@/services/carePlan/carePlanViewModel';

export interface CarePlanFocusSectionProps {
  /** Durable plan priorities (summary rows). */
  cards: CarePlanFocusCard[];
  /** Live engine care-focus cards (full interactive UI). */
  liveCards?: LatestUc4PriorityCardSummary[];
  onExplain?: (cardId: string) => void;
  onRespond?: (
    card: LatestUc4PriorityCardSummary,
    action: Uc4CardResponseAction,
    payload: {
      observationCodes: string[];
      contextCodes: string[];
      caregiverRequestedProviderReview: boolean;
    },
  ) => void;
}

export function CarePlanFocusSection({
  cards,
  liveCards = [],
  onExplain,
  onRespond,
}: CarePlanFocusSectionProps) {
  // View-model already tags live vs durable; live interactive cards use liveCards.
  const durableRows = cards.filter((c) => c.source === 'plan_priority');
  const total = liveCards.length + durableRows.length;

  return (
    <View style={sectionStyles.card} accessible accessibilityLabel="This week's focus">
      <View style={sectionStyles.headerRow}>
        <Text style={sectionStyles.title}>{"This week\u2019s focus"}</Text>
        <View style={sectionStyles.pill}>
          <Text style={sectionStyles.pillText}>{total}</Text>
        </View>
      </View>
      <Text style={sectionStyles.subtitle}>
        Care focus items from this week, plus any priorities you have added to your plan.
      </Text>

      {total === 0 ? (
        <Text style={sectionStyles.bodyMuted}>
          No active priorities. Concierge will surface one when something needs your review.
        </Text>
      ) : null}

      {liveCards.map((card) => (
        <View key={card.cardId} style={styles.liveCardWrap}>
          <Uc4PriorityCard
            card={card}
            onExplain={(c) => onExplain?.(c.cardId)}
            onRespond={onRespond}
          />
        </View>
      ))}

      {durableRows.map((card) => (
        <FocusCardRow key={card.cardId} card={card} onExplain={onExplain} />
      ))}
    </View>
  );
}

function FocusCardRow({
  card,
  onExplain,
}: {
  card: CarePlanFocusCard;
  onExplain?: (cardId: string) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [sectionStyles.listRow, pressed && styles.pressed]}
      onPress={() => onExplain?.(card.cardId)}
      accessibilityRole="button"
      accessibilityLabel={`Explain ${card.title}`}
    >
      <Text style={styles.bullet}>{'\u2022'}</Text>
      <View style={styles.textBlock}>
        <Text style={sectionStyles.listText}>{card.title}</Text>
        {card.domain ? <Text style={styles.domain}>{card.domain}</Text> : null}
        {card.source === 'plan_priority' ? (
          <Text style={styles.sourceTag}>On care plan</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  liveCardWrap: {
    marginTop: 10,
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
  domain: {
    color: AppTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  sourceTag: {
    color: AppTheme.colors.brand,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
  },
  pressed: {
    opacity: 0.72,
  },
});
