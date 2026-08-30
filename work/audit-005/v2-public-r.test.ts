import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { transpileEmlToPython } from '@eml/transpiler-python';
import { interpret } from '@eml/interp';

/**
 * EMLP-AUDIT-005 v2 — the eight R made public by EMLP-RELAY-0070, as a red gate.
 *
 * Per 0070 §4.5, these are written and shown red BEFORE a v2 patch is designed.
 * Seven of them are cases the v1 candidate answered wrongly. The eighth is not:
 * V8 is a REGRESSION the candidate introduced, and it is green on the unpatched
 * product. Both facts are asserted here rather than described, because "red"
 * covering an old defect and "red" covering a new one are different claims and a
 * single failing count cannot tell them apart — see the baseline/candidate
 * columns recorded alongside this file.
 *
 * Three roots, from 0070:
 *
 *   V1-V5  the guard decides whether there is an implicit receiver from whether
 *          the METHOD DECLARED a first parameter (`selfParam ? 1 : 0`). A bound
 *          call always passes the instance, so a method declaring none is
 *          exactly the case that should report 0 taken and 1 given, and the
 *          candidate reports no error at all. The same error undercounts every
 *          method message by one.
 *
 *   V6-V7  the error label comes from the call-site identifier, not from the
 *          function object. CPython names the function that was DEFINED, and
 *          qualifies a nested one. The v1 deliverable claimed the messages
 *          matched CPython exactly; that claim held only for top-level direct
 *          calls, which is all its seven message rows exercised.
 *
 *   V8     `functools.cache` hashes its arguments before the underlying
 *          function's signature is checked, so an unhashable argument raises
 *          before any arity error. The v1 comment asserted the opposite and
 *          moved the guard above the cache to match. Measured against CPython
 *          3.14: `@cache def f(x)` called `f(1, [2])` raises
 *          `unhashable type: 'list'`; the same function without the decorator
 *          raises the arity error.
 *
 * Every expectation below is taken from real CPython at run time rather than
 * written out, for the reason the v1 message rows existed and then missed two
 * whole shapes: a recalled string is a claim about my memory.
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

/** CPython's exception MESSAGE, without the type prefix. */
function cpythonMessage(py: string): string {
  const r = spawnSync(PYTHON!, ['-c', py], { encoding: 'utf8' });
  const last = (r.stderr || '').trim().split('\n').pop() ?? '';
  return last.replace(/^\w+(\.\w+)*:\s*/, '');
}

function eml(src: string): string {
  const r = interpret(src);
  if (r.error) return `!! ${r.error.type}`;
  if (!r.ok) return `~~ ${r.unsupported.join(',')}`;
  return (r.output ?? '').trim();
}

// [label, EML source]. Each is a bound-receiver or identity shape the v1 guard
// gets wrong; the expectations come from CPython, not from this file.
const ROWS: [string, string][] = [
  ['V1 zero-param method, bound call',
    'class C:\n    def m():\n        return 7\n\nC() => c\ntry:\n    str(c.m())^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
  ['V2 zero-param __init__',
    'class C:\n    def __init__():\n        "BODY"^0\n\ntry:\n    C() => c\n    "OK"^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
  ['V3 zero-param __enter__',
    'class M:\n    def __enter__():\n        "ENTER"^0\n        return 1\n    def __exit__(self, a, b, c):\n        return 0\n\ntry:\n    with M() as m:\n        "IN"^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
  ['V4 zero-param __exit__, protocol passes three',
    'class M:\n    def __enter__(self):\n        return 1\n    def __exit__():\n        return 0\n\ntry:\n    with M() as m:\n        "IN"^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
  ['V5 zero-param method called with one argument',
    'class C:\n    def m():\n        return 7\n\nC() => c\ntry:\n    str(c.m(1))^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
  ['V6 function called through an alias',
    'def original(x):\n    return x\n\noriginal => alias\ntry:\n    str(alias())^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
  ['V7 nested function',
    'def outer():\n    def inner(x):\n        return x\n    return inner\n\nouter() => f\ntry:\n    str(f())^0\nexcept TypeError as e:\n    "TypeError"^0\n'],
];

// Message shapes. V1-V5 are undercounted by one when the receiver is not
// counted; V6-V7 name the wrong function entirely.
const MESSAGES: [string, string][] = [
  ['V1 message names the class and counts the receiver',
    'class C:\n    def m():\n        return 7\n\nC() => c\nstr(c.m())^0\n'],
  ['V5 message counts receiver plus the explicit argument',
    'class C:\n    def m():\n        return 7\n\nC() => c\nstr(c.m(1))^0\n'],
  ['V6 message names the function that was defined, not the alias',
    'def original(x):\n    return x\n\noriginal => alias\nstr(alias())^0\n'],
  ['V7 message qualifies a nested function',
    'def outer():\n    def inner(x):\n        return x\n    return inner\n\nouter() => f\nstr(f())^0\n'],
];

describe('EMLP-AUDIT-005 v2 — the R published in EMLP-RELAY-0070', () => {
  it('has a real CPython to compare against', () => {
    expect(PYTHON, 'no python on PATH; this gate cannot run without one').not.toBeNull();
  });

  for (const [label, src] of ROWS) {
    it(label, () => {
      expect(eml(src), `${label}\n--- eml ---\n${src}`).toBe(cpython(transpileEmlToPython(src).python));
    });
  }

  for (const [label, src] of MESSAGES) {
    it(label, () => {
      const expected = cpythonMessage(transpileEmlToPython(src).python);
      expect(interpret(src).error?.message ?? '(no error)', label).toBe(expected);
    });
  }

  // V8 is the one that is GREEN on the unpatched product. It is here as a
  // regression gate: a v2 that keeps v1's ordering turns it red, and a v2 that
  // simply reverts the whole guard leaves the seven above red. Nothing else in
  // this file can distinguish those two failures from each other.
  it('V8 @cold hashes its arguments before the arity is checked', () => {
    // Uncaught deliberately. The first version of this row wrapped the call in
    // try/except so it could share a source shape with the stdout rows, and
    // then asserted on the MESSAGE — which CPython never printed, because the
    // program had just caught it. `cpythonMessage` returned '' and the row went
    // red against a baseline that is in fact correct here, which would have put
    // a fabricated defect into the handback.
    const src = '@cold\ndef f(x):\n    return x\n\nstr(f(1, [2]))^0\n';
    const py = transpileEmlToPython(src).python;
    expect(cpythonMessage(py), 'CPython must raise the hash error, not the arity error')
      .toBe("unhashable type: 'list'");
    expect(interpret(src).error?.message ?? '(no error)', 'the cache wrapper runs first').toBe(
      "unhashable type: 'list'",
    );
  });

  it('V8 control — the same call without @cold IS an arity error', () => {
    // Without this row, V8 would pass against an interpreter that reported the
    // hash error for every wrong-arity call, decorated or not.
    const src = 'def f(x):\n    return x\n\nstr(f(1, [2]))^0\n';
    const expected = cpythonMessage(transpileEmlToPython(src).python);
    expect(expected).toMatch(/positional argument/);
    expect(interpret(src).error?.message ?? '(no error)').toBe(expected);
  });

  // 0070 §3: the three controls that were green on the v1 candidate. They are
  // carried forward so a v2 cannot buy the eight above by rejecting more.
  describe('controls carried forward from 0070 section 3', () => {
    it('@hot with a missing argument takes the ordinary TypeError path', () => {
      const src =
        '@hot\ndef f(x):\n    return x\n\ntry:\n    str(f())^0\nexcept TypeError as e:\n    "TypeError"^0\n';
      expect(eml(src)).toBe(cpython(transpileEmlToPython(src).python));
    });

    it('a surplus argument is evaluated and the body is not', () => {
      const src =
        'def side():\n    "ARG"^0\n    return 1\n\ndef f(x):\n    "BODY"^0\n    return x\n\ntry:\n    str(f(side(), side()))^0\nexcept TypeError as e:\n    "TypeError"^0\n';
      expect(eml(src)).toBe(cpython(transpileEmlToPython(src).python));
    });

    it('a receiver parameter not named self still binds and counts', () => {
      const src =
        'class C:\n    def m(this, y):\n        return y\n\nC() => c\ntry:\n    str(c.m())^0\nexcept TypeError as e:\n    "TypeError"^0\n';
      expect(eml(src)).toBe(cpython(transpileEmlToPython(src).python));
    });
  });
});
