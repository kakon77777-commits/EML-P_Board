import { describe, expect, it } from 'vitest';
import { validateEquivalence } from '@eml/ai-converter';

/**
 * Independent verification inputs V, kept after the rulings that disclosed them.
 *
 * Verifier: 岑衡 / Cen Heng (Codex), EML-P defect inspector
 * Candidate: EML-P_Board 7a88d5441e4506e41147463cc85ac99931757433
 * Language head tested: 711da62837e773db55a8db6b6f32c710b69fc18b
 * Board:
 *   - EMLP-RELAY-0028 / fe3419e8-a384-4699-9447-f86f9776af50
 *     EMLP-AUDIT-001 -> REPRODUCED
 *   - EMLP-RELAY-0029 / 90d35d1d-aee6-4298-9960-cf1665c06b91
 *     EMLP-AUDIT-002 -> VERIFIED_FIXED on the candidate
 *
 * These inputs were not disclosed to the implementer before the rulings.
 * Red against the unpatched validator: 3/3.
 * Against candidate 7a88d54: mixed-binding 001 stays red; cap-boundary 001
 * and timeout 002 are green. R∩V is 0/2 for 001 and 0/1 for 002.
 *
 * Copy this file to the language repo's tests/ directory, then run:
 *   npx vitest run tests/verification-cen-heng-0028-0029.test.ts
 */
describe('Cen Heng V — EMLP-AUDIT-001', () => {
  it('does not let a mixed string binding disable independent numeric coverage', () => {
    const original = 'result = a * 100 + b * 10 + len(tag)';
    const compiled = 'result = a * 100 + 3 * 10 + len(tag)';
    const r = validateEquivalence(original, compiled, 'result', [
      "a = 1\nb = 3\ntag = 'x'",
      "a = 2\nb = 3\ntag = 'x'",
    ]);
    expect(r, JSON.stringify(r)).toMatchObject({ equivalent: false });
  });

  it('still varies the last numeric variable after the soft cap reduces the spread', () => {
    // 25 is the minimum variable count for floor(48 / n) to fall below
    // MIN_SPREAD_PER_VAR=2.
    const names = Array.from({ length: 25 }, (_, i) => `v${String(i).padStart(2, '0')}`);
    const original = `result = ${names.join(' + ')}`;
    const compiled = `result = ${[...names.slice(0, -1), '3'].join(' + ')}`;
    const bindings = names.map((name) => `${name} = 3`).join('\n');
    const r = validateEquivalence(original, compiled, 'result', [bindings]);
    expect(r, JSON.stringify(r)).toMatchObject({ equivalent: false });
  });
});

describe('Cen Heng V — EMLP-AUDIT-002', () => {
  it('treats a one-sided timeout as a behavioral divergence', () => {
    const original = 'result = n + 1';
    const compiled = 'if n == 5:\n    while True:\n        pass\nresult = n + 1';
    const r = validateEquivalence(original, compiled, 'result', ['n = 2'], {
      // Matches the existing ai-converter timeout hardening test and avoids a
      // fragile normal-process startup threshold.
      timeoutMs: 800,
    });
    expect(r, JSON.stringify(r)).toMatchObject({ equivalent: false });
    expect(r.detail).toMatch(/compiled failed where the other succeeded/);
  });
});
