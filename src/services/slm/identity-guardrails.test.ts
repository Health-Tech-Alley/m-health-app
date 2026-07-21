import {
  detectIdentityMismatches,
  buildIdentityGuardPromptBlock,
} from './identity-guardrails';

const mike = {
  patientName: 'Mike Thompson',
  patientPreferredName: 'Mike',
  caregiverName: 'Denise Thompson',
};

const james = {
  patientName: 'James Okafor',
  patientPreferredName: 'James',
  caregiverName: 'Diane',
};

describe('detectIdentityMismatches', () => {
  it('returns no mismatch for messages about the loaded patient', () => {
    const result = detectIdentityMismatches(
      'Mike seems more tired around morning medication time. What should I log?',
      mike,
    );
    expect(result.hasMismatch).toBe(false);
    expect(result.systemPromptBlock).toBe('');
  });

  it('returns no mismatch when caregiver uses their own first name lightly', () => {
    const result = detectIdentityMismatches(
      'Denise here — any tips for tonight?',
      mike,
    );
    expect(result.hasMismatch).toBe(false);
  });

  it('flags wrong patient from demo roster (James while Mike loaded)', () => {
    const result = detectIdentityMismatches(
      "James has been doing his exercises every day. His ROM hasn't improved.",
      mike,
    );
    expect(result.hasMismatch).toBe(true);
    expect(result.findings.some((f) => f.kind === 'wrong_patient')).toBe(true);
    expect(result.findings[0].mentioned).toContain('james');
    expect(result.systemPromptBlock).toContain('IDENTITY CHECK');
    expect(result.systemPromptBlock).toContain('Mike');
  });

  it('flags wrong caregiver self-intro (Diane while Denise loaded)', () => {
    const result = detectIdentityMismatches(
      'Diane here — Mike seems more tired after meds.',
      mike,
    );
    expect(result.hasMismatch).toBe(true);
    expect(result.findings.some((f) => f.kind === 'wrong_caregiver_self')).toBe(
      true,
    );
  });

  it('flags "I am Luis" when Denise is loaded', () => {
    const result = detectIdentityMismatches("I'm Luis. How is Elena doing?", mike);
    expect(result.hasMismatch).toBe(true);
    expect(
      result.findings.some(
        (f) =>
          f.kind === 'wrong_caregiver_self' || f.kind === 'wrong_patient',
      ),
    ).toBe(true);
  });

  it('flags caring-for wrong patient', () => {
    const result = detectIdentityMismatches(
      'I am caring for Elena and need help with oxygen readings.',
      mike,
    );
    expect(result.hasMismatch).toBe(true);
    expect(result.findings.some((f) => f.kind === 'wrong_patient')).toBe(true);
  });

  it('does not flag James when James is the loaded patient', () => {
    const result = detectIdentityMismatches(
      "Diane here — James's rehab ROM has plateaued for 9 days.",
      james,
    );
    expect(result.hasMismatch).toBe(false);
  });

  it('handles empty message', () => {
    const result = detectIdentityMismatches('   ', mike);
    expect(result.hasMismatch).toBe(false);
  });
});

describe('buildIdentityGuardPromptBlock', () => {
  it('includes loaded names and must-confirm instructions', () => {
    const block = buildIdentityGuardPromptBlock(
      [
        {
          kind: 'wrong_patient',
          mentioned: ['james'],
          reason: 'Message refers to patient name(s) james but loaded patient is "Mike"',
        },
      ],
      mike,
    );
    expect(block).toContain('Mike');
    expect(block).toContain('Denise');
    expect(block).toContain('YOU MUST');
    expect(block).toContain('switch profiles');
  });
});
