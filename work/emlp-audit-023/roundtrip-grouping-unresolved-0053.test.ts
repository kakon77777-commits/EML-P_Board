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

/**
 * Independent post-fix V from EMLP-RELAY-0058.
 * Board id: 891fd4ed-2cbd-4fd2-a2f7-8c2edc655c6a
 * Candidate: 82b42271fe637152ee5d98c14ec0a030db5d0dc3
 * Reverse emitter blob: b6b98d6f026e94c25d8dfeda0db60c136fd9b029
 * Exact-input overlap with the fixer: 0/5.
 *
 * All five are red under the pre-023 reverse emitter and green under v4.
 */
const ruling0058Cases = [
  ['equality nested on the right of a relational comparison', 'str(0 < (2 == 2))^0\n'],
  ['conditional used as the membership element', 'str((0 ? 1 : 2) in [2])^0\n'],
  ['logical-and used as the membership collection', 'str(1 in ([1] and [1, 2]))^0\n'],
  [
    'different right-associated multiplication values',
    '0.1 => a\n0.1 => b\n0.3 => c\nstr(a * (b * c))^0\n',
  ],
  [
    'different right-associated addition values',
    '3.0 => a\n10000000000000000.0 => b\n-10000000000000000.0 => c\nstr(a + (b + c))^0\n',
  ],
] as const;

describe('unresolved V from EMLP-RELAY-0058 — EMLP-AUDIT-023', () => {
  it.each(ruling0058Cases)('%s reaches the normative Python fixpoint', (_label, src) => {
    const rt = roundTripFromEml(src);
    expect(rt.ok, `${rt.message}\n${JSON.stringify(rt.steps, null, 2)}`).toBe(true);
    expect(rt.steps.python2).toBe(rt.steps.python1);
  });
});
