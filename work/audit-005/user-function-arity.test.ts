import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { transpileEmlToPython } from '@eml/transpiler-python';
import { interpret } from '@eml/interp';

/**
 * EMLP-AUDIT-005 — a user function binds whatever arguments it is given and
 * never counts them.
 *
 * `packages/interp/src/index.ts:620`
 *
 *     fn.params.forEach((p, i) => local.vars.set(p.name, args[i] ?? NONE));
 *
 * A missing argument reads `undefined`, which `?? NONE` turns into a bound
 * `None`; a surplus argument is not iterated and is dropped. Neither raises.
 * CPython raises TypeError before the body runs, in both directions.
 *
 * SCOPE — the finding names one line. There are two binding sites with the
 * identical shape, and the second serves six call sites:
 *
 *     620  fn.params.forEach((p, i) => ...)          plain def, incl. @cold/@hot
 *     705  restParams.forEach((p, i) => ...)         runMethodBody, called from
 *          666  __init__ via instantiateClass
 *          680  callMethod  ->  instance.m(args)
 *          1013 __enter__
 *          1017/1028/1036  __exit__
 *
 * A fix at 620 alone leaves five of the eight rows below still red. The whole
 * interpreter contains exactly two arity checks: line 668 (a class with no
 * __init__, the CONTROL row here) and line 1294, which belongs to the builtin
 * argument accessor and not to user functions.
 *
 * Each row is compared against real CPython rather than against a hardcoded
 * expectation, following tests/builtin-shapes.test.ts — the same differential
 * shape, one axis over: that file covers builtin arity, this one covers user
 * function arity, which was never gated at all.
 */

const PYTHON = (() => {
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
})();

/** What CPython does with this program: its stdout, or the exception type. */
function cpython(py: string): string {
  const r = spawnSync(PYTHON!, ['-c', py], { encoding: 'utf8' });
  if (r.status !== 0) {
    const last = (r.stderr || '').trim().split('\n').pop() ?? '';
    return `!! ${last.split(':')[0]}`;
  }
  return (r.stdout ?? '').replace(/\r\n/g, '\n').trim();
}

/** What the interpreter does with the same program, in the same vocabulary. */
function eml(src: string): string {
  const r = interpret(src);
  if (r.error) return `!! ${r.error.type}`;
  if (!r.ok) return `~~ ${r.unsupported.join(',')}`;
  return (r.output ?? '').trim();
}

/**
 * [label, binding site, EML source].
 *
 * The comment on each row records what the interpreter answered before the
 * fix, because "returned a plausible value" is the failure mode worth
 * remembering: a missing argument silently became None and a surplus one
 * silently vanished, so the call SUCCEEDED with the wrong arity.
 */
const ROWS: [string, string, string][] = [
  // ---- 620: the plain function frame, the site the finding names ----
  ['plain def, one arg missing', '620',
    'def f(x):\n    return x\n\ntry:\n    str(f())^0\nexcept TypeError:\n    "TypeError"^0\n'],          // was: None
  ['plain def, one arg surplus', '620',
    'def f(x):\n    return x\n\ntry:\n    str(f(1, 2))^0\nexcept TypeError:\n    "TypeError"^0\n'],      // was: 1
  ['plain def, two of three missing', '620',
    'def f(a, b, c):\n    return a\n\ntry:\n    str(f(1))^0\nexcept TypeError:\n    "TypeError"^0\n'],   // was: 1
  ['@cold def, one arg surplus', '620',
    '@cold\ndef f(x):\n    return x\n\ntry:\n    str(f(1, 2))^0\nexcept TypeError:\n    "TypeError"^0\n'], // was: 1

  // ---- 705: runMethodBody, which the finding's file:line does not reach ----
  ['method, one arg missing', '705',
    'class C:\n    def m(self, y):\n        return y\n\nC() => c\ntry:\n    str(c.m())^0\nexcept TypeError:\n    "TypeError"^0\n'],       // was: None
  ['method, one arg surplus', '705',
    'class C:\n    def m(self, y):\n        return y\n\nC() => c\ntry:\n    str(c.m(1, 2))^0\nexcept TypeError:\n    "TypeError"^0\n'],   // was: 1
  ['__init__, one arg missing', '705 via 666',
    'class C:\n    def __init__(self, x):\n        x => self.x\n\ntry:\n    C() => c\n    str(c.x)^0\nexcept TypeError:\n    "TypeError"^0\n'],      // was: None
  ['__init__, two args surplus', '705 via 666',
    'class C:\n    def __init__(self, x):\n        x => self.x\n\ntry:\n    C(1, 2, 3) => c\n    str(c.x)^0\nexcept TypeError:\n    "TypeError"^0\n'], // was: 1

  // ---- CONTROL ----
  // The interpreter's one working arity check, at line 668. This row is here so
  // that a fix which simply raises TypeError from every call, and a probe that
  // reports red on every row, are both visible. If this row ever goes red the
  // rest of the file stops meaning anything.
  ['CONTROL — class with no __init__, args given', '668',
    'class C:\n    def m(self):\n        return 1\n\ntry:\n    C(1, 2) => c\n    "NO ERROR"^0\nexcept TypeError:\n    "TypeError"^0\n'],
];

describe('EMLP-AUDIT-005 — user function arity is not checked', () => {
  it('has a real CPython to compare against', () => {
    expect(PYTHON, 'no python on PATH; this gate cannot run without one').not.toBeNull();
  });

  for (const [label, site, src] of ROWS) {
    it(`${label}  [${site}]`, () => {
      const expected = cpython(transpileEmlToPython(src).python);
      const actual = eml(src);
      expect(actual, `${label}\n--- eml ---\n${src}`).toBe(expected);
    });
  }

  it('every row above raises before the body runs, not after', () => {
    // A fix that counts arguments *inside* the body would still print the
    // body's output first. CPython prints nothing at all.
    const src =
      'def f(x):\n    "BODY"^0\n    return x\n\ntry:\n    str(f(1, 2))^0\nexcept TypeError:\n    "TypeError"^0\n';
    const expected = cpython(transpileEmlToPython(src).python);
    expect(eml(src), 'the body must not run when the arity is wrong').toBe(expected);
  });

  // The two rows below are about the RECORD rather than the value. A guard
  // placed one line too late still produces the right answer and still leaves
  // the wrong trace, and the trace is what every golden, every equivalence
  // check and the workbench read. Without these, moving the guard below the
  // `eml:call` emit is invisible.
  it('records no call for a wrong-arity call, because none happened', () => {
    const r = interpret(
      'def f(x):\n    return x\n\ntry:\n    str(f(1, 2))^0\nexcept TypeError:\n    "TypeError"^0\n',
    );
    const calls = r.events.filter((e) => e.type === 'eml:call');
    expect(calls.map((e) => JSON.stringify(e)).join('\n')).toBe('');
  });

  // Every row above compares the exception TYPE, which is the bar
  // tests/builtin-shapes.test.ts sets. That bar cannot see the message, and the
  // message is where a method's counts live: drop the bound `self` from the
  // arithmetic and all thirteen rows above still pass while the interpreter
  // reports "takes 1 positional argument but 2 were given" for a call CPython
  // describes as 2 and 3. The drill that removes it went green until this row
  // existed. Messages are compared against CPython, not against my recall of
  // it — five details differ from the obvious string.
  const MESSAGES: [string, string][] = [
    ['plain missing', 'def f(x):\n    return x\n\nstr(f())^0\n'],
    ['plain surplus', 'def f(x):\n    return x\n\nstr(f(1, 2))^0\n'],
    ['plural + Oxford comma', 'def f(a, b, c):\n    return a\n\nstr(f())^0\n'],
    ['two names join with and', 'def f(a, b, c):\n    return a\n\nstr(f(1))^0\n'],
    ['method counts the bound self',
      'class C:\n    def m(self, y):\n        return y\n\nC() => c\nstr(c.m(1, 2))^0\n'],
    ['method missing is qualified',
      'class C:\n    def m(self, y):\n        return y\n\nC() => c\nstr(c.m())^0\n'],
    ['__init__ is qualified and counts self',
      'class C:\n    def __init__(self, x):\n        x => self.x\n\nC(1, 2, 3) => c\n'],
  ];

  for (const [label, src] of MESSAGES) {
    it(`message matches CPython — ${label}`, () => {
      const r = spawnSync(PYTHON!, ['-c', transpileEmlToPython(src).python], { encoding: 'utf8' });
      const expected = (r.stderr || '').trim().split('\n').pop()!.replace(/^TypeError: /, '');
      const actual = interpret(src).error?.message ?? '(no error)';
      expect(actual, label).toBe(expected);
    });
  }

  it('records the call for a right-arity call, so the row above can fail', () => {
    // The NULL control for the row above: an assertion that no call is ever
    // recorded would pass against an interpreter that records nothing at all.
    const r = interpret('def f(x):\n    return x\n\nstr(f(1))^0\n');
    const calls = r.events.filter((e) => e.type === 'eml:call');
    expect(calls.length, JSON.stringify(r.events.map((e) => e.type))).toBe(1);
  });
});
