import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { interpret } from '@eml/interp';
import { transpileEmlToPython } from '@eml/transpiler-python';

/**
 * Corrected post-ruling verification artifact.
 *
 * Current speaker identity: unresolved (host did not expose an exact native
 * task/session binding in this task).
 *
 * Candidate: EML-P_Board 500db00600060707db92f9407f3530e108e6ea9a
 * Emitter blob: 48247c20f1259df1b0930b2575eeae4c60e95733
 * Product head tested: 9011c91ef0cde30f047e20520c6597264924edbb
 * Board:
 *   - EMLP-RELAY-0048 / fd3c892b-a0c3-4af9-98a8-dbb581f61dec
 *     AUDIT-004 -> REPRODUCED; withdraws V2/V3 behavioral parity
 *   - EMLP-RELAY-0049 / a9762fb0-d459-47cd-8a87-cda7a0fe2b05
 *     AUDIT-003 -> VERIFIED_FIXED, rebound to candidate v2
 *
 * Correction to the prior version of this file:
 * class-body for/with programs are E_CLASS_BODY_UNSUPPORTED and are not valid
 * behavioral parity witnesses. They remain only as analyzer/exact-emission
 * controls below. The new discriminating AUDIT-004 V is assignment-only,
 * baseline-green, and candidate-red.
 */

function expectParity(src: string) {
  const ir = interpret(src);
  const tr = transpileEmlToPython(src);
  const py = spawnSync('python', ['-c', tr.python], { encoding: 'utf8' });
  expect(tr.ok, JSON.stringify(tr.diagnostics)).toBe(true);
  expect(ir.error, JSON.stringify(ir.error)).toBeUndefined();
  expect(py.status, py.stderr).toBe(0);
  expect((py.stdout ?? '').replace(/\r\n/g, '\n')).toBe(ir.output);
}

describe('unresolved V — EMLP-AUDIT-003 rebinding', () => {
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

describe('EMLP-AUDIT-004 valid class namespace', () => {
  it('keeps assignment and later bare read consistent', () => {
    expectParity('class C:\n    5 => list\n    list => mirror\n\nC() => c\nstr(c.mirror)^0\n');
  });

  it('resolves a class-body read sequentially before a later class binding', () => {
    expectParity(
      '5 => list\nclass C:\n    list => before\n    7 => list\n\nC() => c\nstr(c.before)^0\n',
    );
  });

  it('reads an unbound class-body name from module scope with ordinary aliasing', () => {
    expectParity('5 => list\nclass C:\n    list => mirror\n\nC() => c\nstr(c.mirror)^0\n');
  });

  it('method bodies do not capture the class namespace', () => {
    expectParity(
      '5 => list\nclass C:\n    7 => list\n    def m(self):\n        return list\n\nC() => c\nc.m() => r\nstr(r)^0\n',
    );
  });
});

describe('diagnosed-unsupported class-body controls', () => {
  const invalidFor =
    'class C:\n    for list in [1:2]:\n        pass\n\nC() => c\nstr(c.list)^0\n';
  const invalidWith =
    'class M:\n    def __enter__(self):\n        return 7\n    def __exit__(self, a, b, c):\n        return 0\n\nclass C:\n    with M() as list:\n        pass\n\nC() => c\nstr(c.list)^0\n';

  it('rejects class for/with with the documented diagnostic', () => {
    for (const src of [invalidFor, invalidWith]) {
      const tr = transpileEmlToPython(src);
      expect(tr.ok).toBe(false);
      expect(tr.diagnostics.some((d) => d.code === 'E_CLASS_BODY_UNSUPPORTED')).toBe(true);
    }
  });

  it('may preserve raw diagnostic-path spelling without claiming parity', () => {
    expect(transpileEmlToPython(invalidFor).python).toMatch(/for list in range\(/);
    expect(transpileEmlToPython(invalidWith).python).toMatch(/with M\(\) as list:/);
  });
});
