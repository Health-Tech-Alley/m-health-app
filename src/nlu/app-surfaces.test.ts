import { linkEntities } from './entity-linker';
import { buildPatientNluContext } from './patient-nlu-context';
import { APP_SURFACE_LEXICON, findAppSurface } from './app-surfaces';

describe('app surfaces lexicon', () => {
  it('finds priorities list and medication watch areas', () => {
    expect(findAppSurface('what is on the priorities list')?.id).toBe('priorities_list');
    expect(findAppSurface('show medication watch areas')?.id).toBe('medication_watch_areas');
    expect(findAppSurface('open the clinical knowledge base')?.id).toBe('clinical_knowledge');
    expect(findAppSurface('therapy progress this week')?.id).toBe('therapy_progress');
  });

  it('links app surfaces via entity linker', () => {
    const ctx = buildPatientNluContext(null);
    const entities = linkEntities('Where is the priorities list and medication watch areas?', ctx);
    const surfaces = entities.filter((e) => e.type === 'app_surface').map((e) => e.label);
    expect(surfaces).toEqual(
      expect.arrayContaining(['priorities list', 'medication watch areas']),
    );
  });

  it('covers core caregiver-named surfaces', () => {
    const ids = new Set(APP_SURFACE_LEXICON.map((e) => e.id));
    for (const id of [
      'priorities_list',
      'care_focus',
      'medication_watch_areas',
      'clinical_knowledge',
      'care_plan_changes',
      'therapy_progress',
      'monitoring_settings',
      'todays_logging',
      'data_entry_times',
      'health_monitor',
    ]) {
      expect(ids.has(id as never)).toBe(true);
    }
  });
});
