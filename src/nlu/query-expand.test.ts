import { buildScopedRetrievalFilters, expandQuery } from './query-expand';
import type { LinkedEntity } from './types';

function entity(
  type: LinkedEntity['type'],
  label: string,
): LinkedEntity {
  return { type, id: `${type}:${label}`, label, score: 1 };
}

describe('buildScopedRetrievalFilters', () => {
  it('uses linked condition and medication entities only', () => {
    const scoped = buildScopedRetrievalFilters(
      [
        entity('condition', 'Spasticity'),
        entity('medication', 'Baclofen'),
        entity('vital', 'SpO2'),
      ],
      ['Cerebral palsy', 'GERD', 'Seizure disorder'],
    );

    expect(scoped.conditions).toEqual(['Spasticity']);
    expect(scoped.activeMeds).toEqual(['Baclofen']);
  });

  it('falls back to primary condition when no condition entities linked', () => {
    const scoped = buildScopedRetrievalFilters(
      [entity('vital', 'heart rate')],
      ['Cerebral palsy', 'GERD'],
    );

    expect(scoped.conditions).toEqual(['Cerebral palsy']);
    expect(scoped.activeMeds).toEqual([]);
  });

  it('does not dump the full medication list when entities are empty', () => {
    const scoped = buildScopedRetrievalFilters([], ['Cerebral palsy']);
    expect(scoped.conditions).toEqual(['Cerebral palsy']);
    expect(scoped.activeMeds).toEqual([]);
  });
});

describe('expandQuery', () => {
  it('returns prompt when no entities', () => {
    expect(expandQuery('what is spo2', [])).toBe('what is spo2');
  });
});
