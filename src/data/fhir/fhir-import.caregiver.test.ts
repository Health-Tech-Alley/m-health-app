import {
  mapContactToCaregiver,
  pickPrimaryCaregiverContact,
} from './fhir-import';

describe('caregiver import from Patient.contact', () => {
  const sofiaContact = {
    relationship: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
            code: 'C',
            display: 'Emergency Contact',
          },
        ],
        text: 'Family caregiver',
      },
    ],
    name: {
      family: 'Reyes',
      given: ['Marco'],
      text: 'Marco Reyes',
    },
    telecom: [{ system: 'phone', value: '555-0202' }],
  };

  const jamesContact = {
    relationship: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0131',
            code: 'C',
            display: 'Emergency Contact',
          },
        ],
        text: 'Wife / caregiver',
      },
    ],
    name: {
      family: 'Okafor',
      given: ['Diane'],
      text: 'Diane Okafor',
    },
    telecom: [{ system: 'phone', value: '555-0102' }],
  };

  it('maps Sofia contact to Marco Reyes caregiver', () => {
    const caregiver = mapContactToCaregiver(sofiaContact, 'sofia-reyes', '2026-01-01T00:00:00.000Z');
    expect(caregiver).toEqual({
      caregiverId: 'cg-sofia-reyes',
      patientId: 'sofia-reyes',
      name: 'Marco Reyes',
      relationship: 'Family caregiver',
      availability: 'Phone: 555-0202',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('maps James contact to Diane Okafor caregiver', () => {
    const caregiver = mapContactToCaregiver(jamesContact, 'james-okafor', '2026-01-01T00:00:00.000Z');
    expect(caregiver).toEqual({
      caregiverId: 'cg-james-okafor',
      patientId: 'james-okafor',
      name: 'Diane Okafor',
      relationship: 'Wife / caregiver',
      availability: 'Phone: 555-0102',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('prefers emergency contact coding C over plain contacts', () => {
    const plain = {
      relationship: [{ text: 'Neighbor' }],
      name: { text: 'Alex Neighbor' },
    };
    const picked = pickPrimaryCaregiverContact([plain, sofiaContact]);
    expect(picked?.name?.text).toBe('Marco Reyes');
  });

  it('returns null when contact has no name', () => {
    expect(mapContactToCaregiver({ relationship: [{ text: 'Caregiver' }] }, 'p1')).toBeNull();
  });

  it('builds name from given+family when text missing', () => {
    const caregiver = mapContactToCaregiver(
      { name: { given: ['Luis'], family: 'Garcia' }, relationship: [{ text: 'Son' }] },
      'elena-garcia',
      't0',
    );
    expect(caregiver?.name).toBe('Luis Garcia');
    expect(caregiver?.relationship).toBe('Son');
  });
});
