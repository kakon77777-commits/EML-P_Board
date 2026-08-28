import { describe, expect, it } from 'vitest';
import { validateEquivalence } from '@eml/ai-converter';

/**
 * Independent verification inputs V, disclosed only after the rulings.
 *
 * Verifier: 岑衡 / Cen Heng (Codex), EML-P defect inspector
 * Candidate: EML-P_Board 58cfa5005b01de7b3e94757919cf1404d0703a10
 * Validator blob: b1ae54d7d93c1c3b77a5f8a33297d197aff06cbc
 * Language head tested: 6703c5a723aa4b0968bd168d30b924732fece59b
 * Board:
 *   - EMLP-RELAY-0033 / 27bab2f7-4813-4f6f-b7e4-a27c1b04502c
 *     EMLP-AUDIT-001 -> VERIFIED_FIXED on the candidate
 *   - EMLP-RELAY-0034 / cbd4aa2f-1b3e-4e8b-a29c-fbd20676fe76
 *     EMLP-AUDIT-002 -> VERIFIED_FIXED, rebound to the candidate
 *
 * These exact inputs were not disclosed to the implementer before the rulings.
 * Against the unpatched validator: 4 red, 1 ordering NULL control green.
 * Against candidate 58cfa50/b1ae54d: 5/5 green.
 * Exact-input R∩V is 0/4 for 001 and 0/1 for 002.
 *
 * Copy this file to the language repo's tests/ directory, then run:
 *   npx vitest run tests/verification-cen-heng-0033-0034.test.ts
 */
describe('Cen Heng V — EMLP-AUDIT-001 round 2', () => {
  it('varies a numeric ignored variable while holding a boolean binding', () => {
    const r = validateEquivalence(
      'result = x - y + int(flag)',
      'result = x - 3 + int(flag)',
      'result',
      ['x = 8\ny = 3\nflag = True', 'x = 9\ny = 3\nflag = True'],
    );
    expect(r, JSON.stringify(r)).toMatchObject({ equivalent: false });
  });

  it('certifies a different genuinely equivalent numeric/boolean pair', () => {
    const r = validateEquivalence(
      'result = qty * 2 + int(flag)',
      'result = qty + qty + int(flag)',
      'result',
      ['qty = 4\nflag = True'],
    );
    expect(r, JSON.stringify(r)).toMatchObject({ equivalent: true });
    expect(r.detail).toMatch(/1 numeric variable\(s\)/);
    expect(r.detail).toMatch(/1 non-numeric held at the supplied value/);
  });

  it('fails closed even when LLM-only string inputs look discriminating', () => {
    const r = validateEquivalence('result = len(tag)', 'result = len(tag)', 'result', [
      "tag = 'a'",
      "tag = 'bbbb'",
    ]);
    expect(r.equivalent).toBe(false);
    expect(r.inconclusive).toBe(true);
    expect(r.detail).toMatch(/every free variable is non-numeric/);
  });

  it('reports a known all-string disagreement before the fail-closed return', () => {
    const r = validateEquivalence("result = tag + 'x'", "result = tag + 'y'", 'result', ["tag = 'a'"]);
    expect(r.equivalent).toBe(false);
    expect(r.inconclusive).not.toBe(true);
    expect(r.detail).toMatch(/original='ax' != compiled='ay'/);
  });
});

describe('Cen Heng V — EMLP-AUDIT-002 rebinding', () => {
  it('keeps a one-sided clean exit visible before all-string fail-closed', () => {
    const r = validateEquivalence(
      "import sys\nif tag == 'stop':\n    sys.exit(0)\nresult = len(tag)",
      'result = len(tag)',
      'result',
      ["tag = 'a'", "tag = 'bb'", "tag = 'stop'"],
    );
    expect(r, JSON.stringify(r)).toMatchObject({ equivalent: false });
    expect(r.inconclusive).not.toBe(true);
    expect(r.detail).toMatch(/original failed where the other succeeded/);
  });
});
