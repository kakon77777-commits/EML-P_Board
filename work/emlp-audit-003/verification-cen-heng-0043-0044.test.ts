import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { interpret } from '@eml/interp';
import { transpileEmlToPython } from '@eml/transpiler-python';

/**
 * Independent verification inputs V, disclosed only after the Board rulings.
 *
 * Verifier: 岑衡
 * Speaker ID: codex-thread:019fe51e-9276-7f63-8c16-414624b7fa9d
 * Candidate: EML-P_Board cc97fa0ce7eace0d8a6142bf2b82168d74303839
 * Emitter blob: f391c9e164b7796c45acb8fb07168ea85d35a314
 * Product head tested: f3e4d93efd1e971454b0d2b01ac0d44dafddfbcc
 * Board:
 *   - EMLP-RELAY-0043 / 444d1acd-63fa-4e2b-a25c-8f99acd8ce5a
 *     EMLP-AUDIT-003 -> VERIFIED_FIXED on the candidate
 *   - EMLP-RELAY-0044 / 4a4a9316-7bdb-408f-9840-cc6572c14796
 *     EMLP-AUDIT-004 -> REPRODUCED
 *
 * Exact-input overlap: 0/5 for 003; 0/3 for 004.
 * Baseline: 003 5 red; 004 2 red + 1 NULL control green.
 * Candidate: 003 5/5 green; 004 3/3 red.
 *
 * Copy to tests/ and run:
 *   npx vitest run tests/verification-cen-heng-0043-0044.test.ts
 */

function expectParity(src: string) {
  const ir = interpret(src);
  const tr = transpileEmlToPython(src);
  const py = spawnSync('python', ['-c', tr.python], { encoding: 'utf8' });
  expect(ir.error, JSON.stringify(ir.error)).toBeUndefined();
  expect(py.status, py.stderr).toBe(0);
  expect((py.stdout ?? '').replace(/\r\n/g, '\n')).toBe(ir.output);
}

describe('Cen Heng V — EMLP-AUDIT-003', () => {
  it('preserves a comparison nested on the right across different operators', () => {
    expectParity('str(1 != (2 < 1))^0\n');
  });

  it('preserves Membership children nested under Comparison', () => {
    expectParity('str((1 in []) == (2 in []))^0\n');
  });

  it('preserves a different floating-point right grouping', () => {
    expectParity(
      '0 - 1.0 => a\n10000000000000000.0 => b\n0 - 10000000000000000.0 => c\nstr(a + (b + c))^0\n',
    );
  });

  it('preserves a Not expression used as the membership element', () => {
    expectParity('str((not 0) in [])^0\n');
  });

  it('preserves a conditional expression used as the membership collection', () => {
    expectParity('str(1 in (0 ? [1] : [2]))^0\n');
  });
});

describe('Cen Heng V — EMLP-AUDIT-004 class namespace', () => {
  it('keeps a bare class-body read consistent with its preceding assignment', () => {
    expectParity(
      'class C:\n    5 => list\n    list => mirror\n\nC() => c\nstr(c.mirror)^0\n',
    );
  });

  it('keeps a class-scope for target reachable as the declared attribute', () => {
    expectParity(
      'class C:\n    for list in [1:2]:\n        pass\n\nC() => c\nstr(c.list)^0\n',
    );
  });

  it('keeps a class-scope with target reachable after the block', () => {
    expectParity(
      'class M:\n    def __enter__(self):\n        return 7\n    def __exit__(self, a, b, c):\n        return 0\n\nclass C:\n    with M() as list:\n        pass\n\nC() => c\nstr(c.list)^0\n',
    );
  });
});
