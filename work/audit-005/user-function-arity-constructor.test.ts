import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { transpileEmlToPython } from '@eml/transpiler-python';
import { interpret } from '@eml/interp';

/**
 * EMLP-AUDIT-005 — the R published in EMLP-RELAY-0076: the constructor path
 * for a class with no `__init__`.
 *
 * This file exists as public R only. No product fix accompanies it: per
 * EMLP-RELAY-0078 the next candidate waits until the callable-contract
 * population has been censused and reviewed.
 *
 * The gap it closes is in the GATE, not only in the interpreter. Since v1 the
 * public suite has carried a row named
 *
 *     CONTROL — class with no __init__, args given
 *
 * written as `except TypeError: "TypeError"^0`. It proves the existing guard
 * rejects, and it throws `e` away. So every message row added in v1, v2 and v3
 * covered functions, methods and an explicit `__init__`, and the second
 * constructor arity path — a hand-written message at
 * `packages/interp/src/index.ts:784` — was never compared to CPython at all.
 *
 * Two CPython facts, measured rather than assumed, and they disagree with each
 * other:
 *
 *     no __init__        Slate() takes no arguments
 *                        — no count, and NO `<locals>` prefix even when the
 *                          class is nested
 *     explicit __init__  mk.<locals>.S.__init__() missing 1 required
 *                          positional argument: 'x'
 *
 * So the two constructor paths do not share a naming rule, and a fix that
 * applies the method rule here would be wrong in the other direction.
 */

const PYTHON = (() => {
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
})();

/** CPython's stdout, or `!! <ExceptionType>` when it faults. */
function cpython(py: string): string {
  const r = spawnSync(PYTHON!, ['-c', py], { encoding: 'utf8' });
  if (r.status !== 0) {
    const last = (r.stderr || '').trim().split('\n').pop() ?? '';
    return `!! ${last.split(':')[0]}`;
  }
  return (r.stdout ?? '').replace(/\r\n/g, '\n').trim();
}

function eml(src: string): string {
  const r = interpret(src);
  if (r.error) return `!! ${r.error.type}`;
  if (!r.ok) return `~~ ${r.unsupported.join(',')}`;
  return (r.output ?? '').trim();
}

/**
 * Every red row below prints `str(e)` rather than a literal. That is the whole
 * point: the row it replaces caught the exception and printed the word
 * "TypeError", which is true of an interpreter whose message is anything at
 * all. Comparing stdout to CPython's stdout puts the message itself on the
 * wire.
 */
const REDS: [string, string][] = [
  ['top-level class, no __init__, one argument',
    'class Slate:\n    def ping(self):\n        return 1\n\ntry:\n    Slate(9) => value\nexcept TypeError as e:\n    str(e)^0\n'],
  ['the same class reached through an alias',
    'class Slate:\n    def ping(self):\n        return 1\n\nSlate => Alias\ntry:\n    Alias(9) => value\nexcept TypeError as e:\n    str(e)^0\n'],
  ['a class returned from a function',
    'def mk():\n    class Slate:\n        def ping(self):\n            return 1\n    return Slate\n\nmk() => K\ntry:\n    K(9) => value\nexcept TypeError as e:\n    str(e)^0\n'],
  ['a class nested two functions deep',
    'def a():\n    def b():\n        class Deep:\n            def ping(self):\n                return 1\n        return Deep\n    return b()\n\na() => K\ntry:\n    K(9) => value\nexcept TypeError as e:\n    str(e)^0\n'],
  ['a class defined inside a nested-class method',
    'def build():\n    class Outer:\n        def make(self):\n            class Inner:\n                def ping(self):\n                    return 1\n            return Inner\n    Outer() => o\n    return o.make()\n\nbuild() => K\ntry:\n    K(9) => value\nexcept TypeError as e:\n    str(e)^0\n'],
];

/** The six controls 0076 §2 reports green on v3, carried so a fix here cannot
 *  be bought by breaking the neighbours. */
const CONTROLS: [string, string][] = [
  ['top-level no-__init__ class constructs with zero arguments',
    'class Slate:\n    def ping(self):\n        return 1\n\nSlate() => s\nstr(s.ping())^0\n'],
  ['nested no-__init__ class constructs with zero arguments',
    'def mk():\n    class Slate:\n        def ping(self):\n            return 1\n    return Slate\n\nmk() => K\nK() => s\nstr(s.ping())^0\n'],
  ['the existing guard still raises TypeError, not something else',
    'class Slate:\n    def ping(self):\n        return 1\n\ntry:\n    Slate(9) => v\n    "NO ERROR"^0\nexcept ValueError as e:\n    "WRONG TYPE"^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
  ['a nested class WITH an explicit __init__ keeps the full qualifier',
    'def mk():\n    class S:\n        def __init__(self, x):\n            x => self.x\n    return S\n\nmk() => K\ntry:\n    K() => v\nexcept TypeError as e:\n    str(e)^0\n'],
  ['a class alias does not change an explicit __init__ definition name',
    'class Named:\n    def __init__(self, x):\n        x => self.x\n\nNamed => Aliased\ntry:\n    Aliased() => v\nexcept TypeError as e:\n    str(e)^0\n'],
  ['a deeply nested class ordinary method keeps the full qualifier',
    'def a():\n    def b():\n        class Cell:\n            def read(self, k):\n                return k\n        Cell() => c\n        return c\n    return b()\n\na() => cell\ntry:\n    cell.read() => z\nexcept TypeError as e:\n    str(e)^0\n'],
];

describe('EMLP-AUDIT-005 — no-__init__ constructor message (EMLP-RELAY-0076)', () => {
  it('has a real CPython to compare against', () => {
    expect(PYTHON, 'no python on PATH; this gate cannot run without one').not.toBeNull();
  });

  for (const [label, src] of REDS) {
    it(`R — ${label}`, () => {
      const expected = cpython(transpileEmlToPython(src).python);
      // The row must be one where CPython prints the message, or comparing
      // stdout proves nothing about the message.
      expect(expected, 'CPython must print the caught message').toMatch(/takes no arguments/);
      expect(eml(src), `${label}\n--- eml ---\n${src}`).toBe(expected);
    });
  }

  describe('controls green on v3, carried forward', () => {
    for (const [label, src] of CONTROLS) {
      it(label, () => {
        expect(eml(src), label).toBe(cpython(transpileEmlToPython(src).python));
      });
    }
  });
});
