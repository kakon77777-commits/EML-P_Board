import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { interpret } from '@eml/interp';
import { transpileEmlToPython } from '@eml/transpiler-python';

/**
 * Post-ruling V for EMLP-AUDIT-004.
 *
 * Speaker identity is unresolved: the host did not expose a current native
 * task/session identifier. The role claim is EML-P defect inspector.
 *
 * Board ruling: EMLP-RELAY-0052
 * Board id: e11ad220-9b8c-4c3a-bdc9-57966081e714
 * Candidate: 5e6fc5f7c6e5c114c71ded58d6497c47975ad9a7
 * Python emitter blob: 44c2dbebe05601ec82c131c2a0efe4d8243d8910
 * Product HEAD tested: 9352c35c0224126bf8080a5b133064a8aee70d65
 * Exact discriminating-input overlap with the fixer: 0/3.
 *
 * These tests are green on the ruled-on candidate. The first three are red on
 * the product baseline; the fourth is a NULL/state-evolution control that is
 * green on both.
 */

function normalize(s: string | undefined): string {
  return (s ?? '').replace(/\r\n/g, '\n');
}

function expectParity(src: string, expected: string): string {
  const ir = interpret(src);
  const tr = transpileEmlToPython(src);
  expect(tr.ok, JSON.stringify(tr.diagnostics)).toBe(true);
  expect(ir.error, JSON.stringify(ir.error)).toBeUndefined();
  const py = spawnSync('python', ['-c', tr.python], { encoding: 'utf8' });
  expect(py.status, normalize(py.stderr)).toBe(0);
  expect(normalize(py.stdout), tr.python).toBe(normalize(ir.output));
  expect(normalize(py.stdout)).toBe(expected);
  return tr.python;
}

describe('unresolved V — EMLP-AUDIT-004 source-order class namespace', () => {
  it('evaluates an assignment RHS before creating its same-named class attribute', () => {
    const py = expectParity('5 => list\nclass C:\n    list => list\nC() => c\nstr(c.list)^0\n', '5\n');
    expect(py).toMatch(/^\s+list = lst$/m);
  });

  it('isolates source-order binding state between sibling classes', () => {
    const py = expectParity(
      '5 => list\nclass A:\n    7 => list\nclass B:\n    list => copied\nA() => a\nB() => b\nstr(a.list) + " " + str(b.copied)^0\n',
      '7 5\n',
    );
    expect(py).toMatch(/class B:\n\s+copied = lst/);
  });

  it('aliases a taken module-level with binder and its read consistently', () => {
    const py = expectParity(
      'class M:\n    def __enter__(self):\n        return 7\n    def __exit__(self, a, b, c):\n        return 0\n5 => list\nwith M() as list:\n    list => seen\nstr(seen)^0\n',
      '7\n',
    );
    expect(py).toMatch(/with M\(\) as lst:/);
    expect(py).toMatch(/seen = lst/);
  });

  it('NULL control: each later class read observes the immediately preceding rebind', () => {
    expectParity(
      '5 => list\nclass C:\n    7 => list\n    list => first\n    9 => list\n    list => second\nC() => c\nstr(c.first) + " " + str(c.second)^0\n',
      '7 9\n',
    );
  });
});
