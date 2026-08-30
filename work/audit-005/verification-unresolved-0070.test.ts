import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { interpret } from '@eml/interp';
import { transpileEmlToPython } from '@eml/transpiler-python';

/**
 * Post-ruling V for EMLP-AUDIT-005.
 *
 * Speaker identity is unresolved: the host did not expose a current native
 * task/session identifier. The role claim is EML-P defect inspector.
 *
 * Board ruling: EMLP-RELAY-0070
 * Board id: d56c4149-61f2-4ebd-8f13-0cf58ef0696c
 * Candidate: 5ffd2578ed18be5411f6f7221b348c49d98d8129
 * Candidate interpreter blob: f8f61a8359bb5aef1b01d0645a2f0a593ae5f212
 * Product HEAD tested: 2a935fd7dedaa35c55ae472b078887dbc768f8eb
 * Exact discriminating-input overlap with the fixer: 0/8.
 *
 * Current candidate result: 8 red / 3 green. The three green rows are NULL or
 * ordering controls; the eight red rows define the next candidate's public R.
 */

function parity(src: string): void {
  const tr = transpileEmlToPython(src);
  expect(tr.ok, JSON.stringify(tr.diagnostics)).toBe(true);
  const ir = interpret(src);
  expect(ir.error, JSON.stringify(ir.error)).toBeUndefined();
  const py = spawnSync('python', ['-c', tr.python], { encoding: 'utf8' });
  expect(py.status, py.stderr).toBe(0);
  expect((ir.output ?? '').replace(/\r\n/g, '\n'), tr.python).toBe(
    (py.stdout ?? '').replace(/\r\n/g, '\n'),
  );
}

const CASES = [
  [
    'bound method with no declared parameter still receives implicit self',
    'class C:\n    def m():\n        return 7\nC() => c\ntry:\n    str(c.m())^0\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    '__init__ with no declared parameter still receives implicit self',
    'class C:\n    def __init__():\n        "BODY"^0\ntry:\n    C() => c\n    "OK"^0\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    '__enter__ with no declared parameter still receives implicit self',
    'class C:\n    def __enter__():\n        "ENTER"^0\n        return 1\n    def __exit__(self, a, b, c):\n        return 0\ntry:\n    with C() as x:\n        "IN"^0\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    '__exit__ with no declared parameter counts implicit self in its message',
    'class C:\n    def __enter__(self):\n        return 1\n    def __exit__():\n        return 0\ntry:\n    with C() as x:\n        "IN"^0\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'zero-parameter method called with one explicit arg reports two given',
    'class C:\n    def m():\n        return 7\nC() => c\ntry:\n    c.m(1) => z\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'function alias reports the function definition name',
    'def original(x):\n    return x\noriginal => alias\ntry:\n    alias() => z\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'nested function reports its Python qualified name',
    'def outer():\n    def inner(x):\n        return x\n    try:\n        inner() => z\n    except TypeError as e:\n        str(e)^0\nouter()\n',
  ],
  [
    '@cold wrapper rejects an unhashable surplus arg before underlying arity',
    '@cold\ndef f(x):\n    return x\ntry:\n    f(1, [2]) => z\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    '@hot function takes the ordinary missing-argument path',
    '@hot\ndef f(x):\n    return x\ntry:\n    f() => z\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'surplus argument expressions run before the arity error but body does not',
    'def p():\n    "ARG"^0\n    return 2\ndef f(x):\n    "BODY"^0\n    return x\ntry:\n    f(1, p()) => z\nexcept TypeError:\n    "TYPE"^0\n',
  ],
  [
    'the implicit receiver need not be named self',
    'class C:\n    def m(receiver, x):\n        return x\nC() => c\ntry:\n    c.m() => z\nexcept TypeError as e:\n    str(e)^0\n',
  ],
] as const;

describe('unresolved V — EMLP-AUDIT-005 after EMLP-RELAY-0070', () => {
  it.each(CASES)('%s', (_label, src) => parity(src));
});
