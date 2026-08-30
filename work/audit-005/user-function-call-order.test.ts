import { describe, expect, it } from 'vitest';
import { interpret } from '@eml/interp';

/**
 * EMLP-AUDIT-005 — where the arity guard fires relative to `eml:call`.
 *
 * `tests/user-function-arity.test.ts` has carried one row asserting that a
 * wrong-arity PLAIN function call records no `eml:call`, because no call
 * happened. Nothing asserted the same of a wrong-arity METHOD call, and
 * `runMethodBody` is a single frame serving six boundaries — bound methods,
 * explicit `__init__`, `__enter__`, and `__exit__` on both paths.
 *
 * Measured, not inferred: moving that guard below the `eml:call` emission takes
 * the emitted count from 0 to 1 for a call whose body never runs, and leaves
 * every one of the 62 public cells green. The interpreter is right and nothing
 * was watching it. These rows are what watches it.
 *
 * The last three rows are the reason the first five mean anything. `events`
 * being empty passes every "records nothing" assertion, including on an
 * interpreter that emits no events at all — so a positive control has to show
 * the same channel carrying traffic, by name and in order.
 */

function calls(src: string): string[] {
  const r = interpret(src);
  expect(r.error, `unexpected interpreter error in fixture:\n${src}`).toBeUndefined();
  expect(r.unsupported, `fixture uses unsupported constructs:\n${src}`).toEqual([]);
  // `TraceEvent` is flat, with an index signature, so `e.fn` is `unknown` and
  // there is no discriminant to narrow on. Casting it to string would keep
  // compiling if eml:call ever stopped carrying `fn` — and every row below
  // would then compare undefined to undefined and pass. Reporting the whole
  // event instead turns that into a visible failure.
  const names: string[] = [];
  for (const e of r.events) {
    if (e.type !== 'eml:call') continue;
    names.push(typeof e.fn === 'string' ? e.fn : `<eml:call without a string fn: ${JSON.stringify(e)}>`);
  }
  return names;
}

const METHOD = 'class C:\n    def m(self, y):\n        return y\n\nC() => c\n';
const CTX_OK =
  'class Ctx:\n    def __enter__(self):\n        return 1\n    def __exit__(self, a, b, c):\n        return 0\n\n';

describe('EMLP-AUDIT-005 — the arity guard fires before eml:call', () => {
  it('a wrong-arity bound method call records no call', () => {
    expect(calls(`${METHOD}try:\n    str(c.m(1, 2))^0\nexcept TypeError:\n    "T"^0\n`)).toEqual([]);
  });

  it('a wrong-arity explicit __init__ records no call', () => {
    expect(
      calls(
        'class K:\n    def __init__(self, x):\n        x => self.x\n\ntry:\n    K(1, 2) => k\nexcept TypeError:\n    "T"^0\n',
      ),
    ).toEqual([]);
  });

  it('a no-__init__ constructor given arguments records no call', () => {
    expect(
      calls(
        'class Bare:\n    def ping(self):\n        return 1\n\ntry:\n    Bare(9) => b\nexcept TypeError:\n    "T"^0\n',
      ),
    ).toEqual([]);
  });

  it('a wrong-arity __enter__ records no call', () => {
    expect(
      calls(
        'class Ctx:\n    def __enter__(self, extra):\n        return 1\n    def __exit__(self, a, b, c):\n        return 0\n\ntry:\n    with Ctx() as v:\n        str(v)^0\nexcept TypeError:\n    "T"^0\n',
      ),
    ).toEqual([]);
  });

  it('a wrong-arity __exit__ records __enter__ and stops there', () => {
    // __exit__ is reached only after the body, so this row asserts a boundary
    // BETWEEN two calls rather than the absence of all of them — the one shape
    // an "expect empty" row cannot express.
    expect(
      calls(
        'class Half:\n    def __enter__(self):\n        return 1\n    def __exit__(self, a):\n        return 0\n\ntry:\n    with Half() as v:\n        str(v)^0\nexcept TypeError:\n    "T"^0\n',
      ),
    ).toEqual(['Half.__enter__']);
  });

  it('CONTROL a right-arity method call records exactly one call, by name', () => {
    expect(calls(`${METHOD}str(c.m(1))^0\n`)).toEqual(['C.m']);
  });

  it('CONTROL a right-arity with records __enter__ then __exit__, in order', () => {
    expect(calls(`${CTX_OK}with Ctx() as v:\n    str(v)^0\n`)).toEqual(['Ctx.__enter__', 'Ctx.__exit__']);
  });

  it('CONTROL a right-arity plain function still records its call', () => {
    expect(calls('def f(x):\n    return x\n\nstr(f(1))^0\n')).toEqual(['f']);
  });
});
