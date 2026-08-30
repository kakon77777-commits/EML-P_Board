import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { interpret } from '@eml/interp';
import { transpileEmlToPython } from '@eml/transpiler-python';

/**
 * EMLP-AUDIT-005 — the no-`__init__` constructor path.
 *
 * `instantiateClass` has two arity paths. The one with an explicit `__init__`
 * goes through `runMethodBody` and the shared `arityError` composer; the one
 * WITHOUT `__init__` composes its own message by hand. Every message row added
 * in v1, v2 and v3 was written against the composer, so it covered three of the
 * four deciding sites and never reached this one. What stood here instead was
 *
 *     CONTROL — class with no __init__, args given
 *     except TypeError:
 *         "TypeError"^0
 *
 * which proves the guard rejects and throws `e` away. A type-only control
 * cannot stand in for message coverage: breaking the message to a literal left
 * all 50 public cells green.
 *
 * Two CPython facts, measured rather than recalled, and they disagree:
 *
 *     no __init__        Slate() takes no arguments
 *                        — no count, and NO `<locals>` prefix even when nested
 *     explicit __init__  make_record.<locals>.Record.__init__() missing 1
 *                          required positional argument: 'key'
 *
 * So the two constructor paths do not share a naming rule, and applying the
 * method qualname rule here would be wrong in the other direction. The controls
 * below hold that second rule fixed while the rows above change.
 *
 * Rows 1–5 and all six controls are the undisclosed V of EMLP-RELAY-0076,
 * checked in by EMLP-RELAY-0077 (PR #4, blob `4f8f4072`). Rows 6–7 are the two
 * modifier combinations my parallel file carried that hers did not.
 *
 * The argument counts are deliberately 1, 3, 2, 3, 1, 1, 1 rather than all 1.
 * The wrong message interpolates `args.length`, so a witness set that holds the
 * count fixed cannot tell a fix that REMOVES the count from one that hardcodes
 * the value every row happens to use. Measured: a candidate correct only for a
 * one-argument construction passes an all-1 gate 12/12.
 */

const PYTHON = (() => {
  for (const candidate of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  return null;
})();

function cpythonOutput(src: string): string {
  const py = transpileEmlToPython(src).python;
  const run = spawnSync(PYTHON!, ['-c', py], { encoding: 'utf8' });
  if (run.status !== 0) {
    const last = (run.stderr ?? '').trim().split(/\r?\n/).pop() ?? '';
    return `!! ${last}`;
  }
  return (run.stdout ?? '').replace(/\r\n/g, '\n').trim();
}

function interpOutput(src: string): string {
  const run = interpret(src);
  if (run.error) return `!! ${run.error.type}: ${run.error.message}`;
  if (!run.ok) return `~~ ${run.unsupported.join(',')}`;
  return (run.output ?? '').trim();
}

/** Each row prints `str(e)`, so the message itself is on the wire. */
const NO_INIT_MESSAGE_ROWS: Array<[string, string]> = [
  [
    'top-level class with one constructor argument',
    'class Slate:\n    def ping(self):\n        return 1\n\ntry:\n    Slate(9) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'top-level class alias with three constructor arguments',
    'class Origin:\n    def ping(self):\n        return 1\n\nOrigin => Alias\ntry:\n    Alias(1, 2, 3) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'class without __init__ returned from a function',
    'def make_slate():\n    class Slate:\n        def ping(self):\n            return 1\n    return Slate\n\nmake_slate() => SlateType\ntry:\n    SlateType(4, 5) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'class without __init__ nested below two functions and then aliased',
    'def outer_scope():\n    def middle_scope():\n        class Cell:\n            def ping(self):\n                return 1\n        return Cell\n    return middle_scope()\n\nouter_scope() => CellType\nCellType => CellAlias\ntry:\n    CellAlias(1, 2, 3) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'class without __init__ defined inside a method of a nested class',
    'def build_factory():\n    class Factory:\n        def make(self):\n            class Payload:\n                def ping(self):\n                    return 1\n            return Payload\n    Factory() => factory\n    return factory\n\nbuild_factory() => factory\nfactory.make() => PayloadType\ntry:\n    PayloadType(7) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'top-level class alias with ONE constructor argument',
    'class Plate:\n    def ping(self):\n        return 1\n\nPlate => PlateAlias\ntry:\n    PlateAlias(9) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'class nested below two functions, NOT aliased',
    'def outer_level():\n    def inner_level():\n        class Deep:\n            def ping(self):\n                return 1\n        return Deep\n    return inner_level()\n\nouter_level() => DeepType\ntry:\n    DeepType(9) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
];

/** Green on v3 already. A fix here must not be bought by breaking these — the
 *  last three pin the OPPOSITE rule, that an explicit `__init__` and an
 *  ordinary method DO carry the full lexical qualifier. */
const CONTROL_ROWS: Array<[string, string]> = [
  [
    'control: top-level class without __init__ accepts zero arguments',
    'class EmptyTop:\n    def ping(self):\n        return 1\n\nEmptyTop() => value\n"OK"^0\n',
  ],
  [
    'control: nested class without __init__ accepts zero arguments',
    'def make_empty():\n    class EmptyNested:\n        def ping(self):\n            return 1\n    return EmptyNested\n\nmake_empty() => EmptyType\nEmptyType() => value\n"OK"^0\n',
  ],
  [
    'control: the existing no-__init__ guard raises the right exception type',
    'class Guarded:\n    def ping(self):\n        return 1\n\ntry:\n    Guarded(1, 2, 3, 4) => value\n    "NO ERROR"^0\nexcept TypeError:\n    "TypeError"^0\n',
  ],
  [
    'control: explicit __init__ in a nested class uses the full qualifier',
    'def make_record():\n    class Record:\n        def __init__(self, key):\n            key => self.key\n    return Record\n\nmake_record() => RecordType\ntry:\n    RecordType() => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'control: explicit __init__ keeps the definition name through a top-level class alias',
    'class DefinedClass:\n    def __init__(self, key):\n        key => self.key\n\nDefinedClass => RenamedClass\ntry:\n    RenamedClass() => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'control: a regular method on a deeply nested class uses the full qualifier',
    'def outer_builder():\n    def inner_builder():\n        class DeepClass:\n            def method(self, key):\n                return key\n        DeepClass() => value\n        return value\n    return inner_builder()\n\nouter_builder() => value\ntry:\n    value.method() => result\nexcept TypeError as e:\n    str(e)^0\n',
  ],
];

describe('EMLP-AUDIT-005 — no-__init__ constructor message', () => {
  it('has a real CPython oracle', () => {
    expect(PYTHON, 'no python on PATH; this gate cannot run without one').not.toBeNull();
  });

  for (const [label, src] of NO_INIT_MESSAGE_ROWS) {
    it(`R ${label}`, () => {
      const expected = cpythonOutput(src);
      // Without this, a shape where CPython does not raise would compare an
      // empty string to an empty string and pass while proving nothing about
      // the message.
      expect(expected, 'CPython must actually print the caught message').toMatch(/takes no arguments/);
      expect(interpOutput(src), label).toBe(expected);
    });
  }

  for (const [label, src] of CONTROL_ROWS) {
    it(label, () => {
      expect(interpOutput(src), label).toBe(cpythonOutput(src));
    });
  }
});
