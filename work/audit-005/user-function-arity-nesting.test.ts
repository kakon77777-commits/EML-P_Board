import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { transpileEmlToPython } from '@eml/transpiler-python';
import { interpret } from '@eml/interp';

/**
 * EMLP-AUDIT-005 v3 — the five R published in EMLP-RELAY-0073, plus the seven
 * controls that were green on v2.
 *
 * v2 recorded a qualified name where a `def` executes. A class body's methods
 * are not reached by that branch — `ClassDef` binds the class and the method
 * nodes are looked up later — so `instance.className` stayed the bare
 * `cls.name` and a nested class lost its enclosing `make_vault.<locals>.`
 * permanently, taking any function defined inside its methods down with it.
 *
 * The shape is the same one v1 and v2 each got caught by, one level out: a
 * fact recorded where one KIND of definition executes, and a second kind that
 * never passes through there. v1 read identity off the call site; v2 read it
 * off the def; v3 has to read it off whichever definition actually ran.
 *
 * The seven controls come from 0073 §2. They were green on v2, which is what
 * makes the five reds a specific gap rather than "anything nested is wrong",
 * and they are carried so a v3 cannot buy the five by prefixing more.
 */

const PYTHON = (() => {
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
})();

/** CPython's exception message, without the type prefix. */
function cpythonMessage(py: string): string {
  const r = spawnSync(PYTHON!, ['-c', py], { encoding: 'utf8' });
  const last = (r.stderr || '').trim().split('\n').pop() ?? '';
  return last.replace(/^\w+(\.\w+)*:\s*/, '');
}

/** Every source below is UNCAUGHT on purpose: a program that catches the
 *  exception prints nothing to stderr, and the message assertion would then be
 *  comparing '' — which is how a v2 row once reported a defect against a
 *  baseline that was correct. */
function message(src: string): string {
  return interpret(src).error?.message ?? '(no error)';
}

// [label, EML source] — the five discriminating shapes from 0073 §2.
const REDS: [string, string][] = [
  ['nested class, method',
    'def make_vault():\n    class Vault:\n        def open(self, key):\n            return key\n    Vault() => box\n    return box\n\nmake_vault() => box\nbox.open() => result\n'],
  ['nested class, __init__',
    'def make_token():\n    class Token:\n        def __init__(self, v):\n            v => self.v\n    Token() => t\n    return t\n\nmake_token() => t\n'],
  ['nested class, __enter__',
    'def make_context():\n    class Context:\n        def __enter__(self, extra):\n            return 1\n        def __exit__(self, a, b, c):\n            return 0\n    Context() => c\n    return c\n\nmake_context() => ctx\nwith ctx as v:\n    "IN"^0\n'],
  ['function nested inside a nested-class method',
    'def build_worker():\n    class Worker:\n        def produce(self):\n            def task(x):\n                return x\n            return task\n    Worker() => w\n    return w.produce()\n\nbuild_worker() => f\nf() => z\n'],
  ['class nested below two functions',
    'def outer_scope():\n    def middle_scope():\n        class Cell:\n            def read(self, k):\n                return k\n        Cell() => c\n        return c\n    return middle_scope()\n\nouter_scope() => cell\ncell.read() => z\n'],
];

// The seven controls 0073 §2 reports green on v2.
const CONTROLS: [string, string][] = [
  ['plain function, two-hop alias',
    'def original(x):\n    return x\n\noriginal => a1\na1 => a2\na2() => z\n'],
  ['nested function, two-hop alias',
    'def outer():\n    def inner(x):\n        return x\n    return inner\n\nouter() => b1\nb1 => b2\nb2() => z\n'],
  ['@cold surplus with an unhashable argument hashes first',
    '@cold\ndef f(x):\n    return x\n\nf(1, {"k": 2}) => z\n'],
  ['@cold through an alias with hashable surplus args uses the definition name',
    '@cold\ndef coldfn(x):\n    return x\n\ncoldfn => ca\nca(1, 2) => z\n'],
  ['function nested inside a TOP-LEVEL class method',
    'class Top:\n    def produce(self):\n        def task(x):\n            return x\n        return task\n\nTop() => t\nt.produce() => f\nf() => z\n'],
  ['three-level nested function',
    'def l1():\n    def l2():\n        def l3(x):\n            return x\n        return l3\n    return l2()\n\nl1() => f\nf() => z\n'],
  ['a top-level class alias does not change the method label',
    'class Named:\n    def m(self, y):\n        return y\n\nNamed => Aliased\nAliased() => obj\nobj.m() => z\n'],
];

describe('EMLP-AUDIT-005 v3 — nested class identity (EMLP-RELAY-0073)', () => {
  it('has a real CPython to compare against', () => {
    expect(PYTHON, 'no python on PATH; this gate cannot run without one').not.toBeNull();
  });

  for (const [label, src] of REDS) {
    it(`R — ${label}`, () => {
      const expected = cpythonMessage(transpileEmlToPython(src).python);
      expect(expected, 'the shape must actually raise in CPython, or the row proves nothing')
        .toMatch(/positional argument/);
      expect(message(src), `${label}\n--- eml ---\n${src}`).toBe(expected);
    });
  }

  describe('controls green on v2, carried forward', () => {
    for (const [label, src] of CONTROLS) {
      it(label, () => {
        expect(message(src), label).toBe(cpythonMessage(transpileEmlToPython(src).python));
      });
    }
  });
});
