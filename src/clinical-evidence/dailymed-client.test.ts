import { normalizeDailyMedDrugQuery } from './dailymed-client';

describe('normalizeDailyMedDrugQuery', () => {
  it('strips dose, form, and PRN from albuterol labels', () => {
    expect(normalizeDailyMedDrugQuery('Albuterol 90mcg inhaler PRN')).toBe('Albuterol');
  });

  it('strips brand alias and dose from diazepam', () => {
    expect(normalizeDailyMedDrugQuery('diazePAM (VALIUM) 2 MG tablet')).toMatch(/diazePAM/i);
  });

  it('prefers the left side of a slash pair', () => {
    expect(normalizeDailyMedDrugQuery('cholecalciferol / Vitamin D3 tablet')).toBe(
      'cholecalciferol',
    );
  });

  it('handles extended-release oxybutynin', () => {
    expect(
      normalizeDailyMedDrugQuery('Oxybutynin extended release 10 mg oral tablet'),
    ).toBe('Oxybutynin');
  });

  it('handles clonidine patch dosing', () => {
    expect(normalizeDailyMedDrugQuery('cloNIDine 0.1 mg/24 hr patch')).toMatch(/cloNIDine/i);
  });

  it('keeps simple generic names', () => {
    expect(normalizeDailyMedDrugQuery('Baclofen')).toBe('Baclofen');
    expect(normalizeDailyMedDrugQuery('Aspirin 81mg tablet')).toBe('Aspirin');
  });
});
