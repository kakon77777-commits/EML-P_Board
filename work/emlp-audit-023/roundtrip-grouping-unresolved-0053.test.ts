import { describe, expect, it } from 'vitest';
import { roundTripFromEml } from '@eml/transpiler-eml';

/**
 * Red-first V for EMLP-AUDIT-023.
 *
 * Speaker identity is unresolved: the host did not expose a current native
 * task/session identifier. The role claim is EML-P defect inspector.
 *
 * Board report: EMLP-RELAY-0053
 * Board id: 1351fcb7-c5fc-45df-9db4-2ea439671e59
 * Observed with candidate: 5e6fc5f7c6e5c114c71ded58d6497c47975ad9a7
 * Forward emitter blob: 44c2dbebe05601ec82c131c2a0efe4d8243d8910
 * Reverse emitter blob: 6a7c1772c1e2760c5be75c9ab83e2f6996ba3a25
 *
 * Current result: 4 red / 1 green. The reverse EML emitter still implements
 * the pre-003 grouping policy, so it deletes parentheses the corrected forward
 * emitter now needs. Under real CPython the Not case changes False -> True,
 * the float case -1.0 -> 0.0, and the conditional case False -> [2].
 */

const cases = [
  ['comparison on right', 'str(1 != (2 < 1))^0\n'],
  ['membership on both comparison sides', 'str((1 in []) == (2 in []))^0\n'],
  [
    'floating-point right grouping',
    '0 - 1.0 => a\n10000000000000000.0 => b\n0 - 10000000000000000.0 => c\nstr(a + (b + c))^0\n',
  ],
  ['not as membership element', 'str((not 0) in [])^0\n'],
  ['conditional as membership collection', 'str(1 in (0 ? [1] : [2]))^0\n'],
] as const;

describe('EMLP-AUDIT-023 — grouping survives EML -> Python -> EML -> Python', () => {
  it.each(cases)('%s reaches the normative Python fixpoint', (_label, src) => {
    const rt = roundTripFromEml(src);
    expect(rt.ok, `${rt.message}\n${JSON.stringify(rt.steps, null, 2)}`).toBe(true);
  });
});
