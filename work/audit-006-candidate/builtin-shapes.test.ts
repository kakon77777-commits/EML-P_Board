import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { transpileEmlToPython } from '@eml/transpiler-python';
import { interpret } from '@eml/interp';

/**
 * BUILTIN ARGUMENT SHAPES — differential gate against real CPython.
 *
 * The corpus reached 149 programs with every tracked SYNTAX construct covered,
 * which made it look finished. Measuring a different axis said otherwise: of
 * the ten builtins the interpreter implements, five (`abs`, `float`, `min`,
 * `set`, `sum`) were called by ZERO corpus programs, and the other five were
 * only ever called with one argument.
 *
 * Probing the uncovered shapes against CPython found twelve divergences. The
 * lesson is the same one `%`-formatting taught: coverage of a NAME proves
 * nothing. `str` appeared in 130 programs and was fine; `float` appeared in
 * none and was wrong five different ways.
 *
 * Every row below failed before the fix that accompanies this file. They are
 * kept as a set rather than prose so that adding a shape is one line, and so
 * the comparison is against CPython rather than against my belief about it.
 */

const PYTHON = (() => {
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
})();

/** What CPython does with this program: its stdout, or the exception type.
 *  Line endings are normalized for the same reason `tests/interp.test.ts` does
 *  it — Python's text-mode stdout is '\r\n' on Windows while the interpreter
 *  emits the logical '\n', and that is a console convention, not semantics. */
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
 * Shapes the corpus never exercised. The comment on a row records what the
 * interpreter used to answer, because "this returned a plausible wrong number"
 * is the failure mode worth remembering — an exception at least announces itself.
 */
const SHAPES: [string, string][] = [
  // abs — was entirely uncalled by the corpus.
  ['abs of negative int', 'str(abs(0 - 7))^0'],
  ['abs of negative float', 'str(abs(0.0 - 2.5))^0'],
  ['abs of bool', 'str(abs(True))^0'], // bool is an int subtype: abs(True) == 1
  ['abs of huge int', 'str(abs(0 - 12345678901234567890123456789))^0'],

  // float(str) — JS `Number()` and Python disagree five different ways.
  ['float of int', 'str(float(3))^0'],
  ['float of bool', 'str(float(True))^0'],
  ['float of decimal string', 'str(float("2.5"))^0'],
  ['float of padded string', 'str(float("  2.5  "))^0'],
  ['float of underscored string', 'str(float("1_000.5"))^0'], // was ValueError; Python allows _
  ['float of empty string', 'str(float(""))^0'], // was 0.0; Number("") is 0
  ['float of "banana"', 'str(float("banana"))^0'], // was nan — /nan/i matched baNANa
  ['float of "nan"', 'str(float("nan"))^0'],
  ['float of "inf"', 'str(float("inf"))^0'], // was ValueError; JS wants "Infinity"
  ['float of "-Infinity"', 'str(float("-Infinity"))^0'],
  ['float of hex string', 'str(float("0x10"))^0'], // was 16.0; Python rejects hex here
  ['float of exponent string', 'str(float("1e3"))^0'],

  // int(str) — same underscore gap.
  ['int truncates toward zero', 'str(int(2.9))^0'],
  ['int truncates negatives toward zero', 'str(int(0.0 - 2.9))^0'],
  ['int of padded string', 'str(int("  42  "))^0'],
  ['int of underscored string', 'str(int("1_000"))^0'], // was ValueError
  ['int rejects a float string', 'str(int("2.5"))^0'],
  ['int of bool', 'str(int(False))^0'],

  // min/max — one argument means "iterate this", for every iterable.
  ['max of two args', 'str(max(3, 7))^0'],
  ['max of three args', 'str(max(3, 7, 5))^0'],
  ['min of two args', 'str(min(3, 7))^0'],
  ['max of a list', 'str(max([3, 7, 5]))^0'],
  ['max of a tuple', 'str(max((3, 7, 5)))^0'],
  ['min of an empty list', 'str(min([]))^0'],
  ['max across int and float', 'str(max(2, 2.5))^0'],
  ['max keeps the first of a tie', 'str(max(2, 2.0))^0'],
  ['max of two strings', 'str(max("pear", "apple"))^0'],
  ['max iterates a string', 'str(max("hello"))^0'], // was "hello"; Python gives 'o'
  ['max rejects a lone int', 'str(max(5))^0'], // was 5; Python raises TypeError

  // sum — accepts any iterable, and refuses strings on purpose.
  ['sum of ints', 'str(sum([1, 2, 3]))^0'],
  ['sum with a start value', 'str(sum([1, 2, 3], 10))^0'],
  ['sum of empty', 'str(sum([]))^0'],
  ['sum of floats is compensated', 'str(sum([0.1, 0.2, 0.3]))^0'],
  ['sum of bools', 'str(sum([True, True, False]))^0'],
  ['sum of a tuple', 'str(sum((1, 2, 3)))^0'], // was TypeError
  ['sum of a set of ints', 'str(sum({1, 2, 3}))^0'], // was TypeError
  ['sum refuses strings', 'str(sum(["a", "b"], ""))^0'], // was "ab"

  // len — the set of things with a length now matches the set you can iterate.
  ['len of empty set()', 'str(len(set()))^0'],
  ['len of a tuple', 'str(len((1, 2, 3)))^0'], // was TypeError
  ['len of a dict', 'str(len({"a": 1, "b": 2}))^0'],
  ['len of a string', 'str(len("hello"))^0'],
  ['len counts code points', 'str(len("a\u{1F600}b"))^0'],

  // Iteration order — a dict is insertion-ordered in Python and here.
  ['for over dict keys', '{"b": 1, "a": 2} => d\nfor k in d:\n    k^0'],
];

describe.skipIf(!PYTHON)('builtin argument shapes ≡ CPython', () => {
  for (const [label, src] of SHAPES) {
    it(label, () => {
      const fwd = transpileEmlToPython(src);
      expect(fwd.ok, `forward transpile failed: ${fwd.diagnostics.map((d) => d.code).join(',')}`).toBe(true);
      expect(eml(src), `EML interpreter disagrees with CPython for: ${src}`).toBe(cpython(fwd.python));
    });
  }
});

/**
 * Order-sensitive shapes the interpreter must REFUSE rather than answer.
 *
 * CPython iterates a set in hash order — `{3, 1, 2}` yields 1, 2, 3 — which
 * this interpreter cannot reproduce without reimplementing CPython's hash
 * table. Inventing our own order would be a silent wrong answer, which is
 * strictly worse than declining, so these defer to real Python instead.
 *
 * This is the honest half of the fix and deserves a gate of its own: a later
 * "improvement" that makes set iteration merely WORK would pass every test
 * above while quietly reintroducing an order divergence.
 */
describe('order-sensitive set operations defer instead of guessing', () => {
  const mustDefer: [string, string][] = [
    ['for over a set', '{3, 1, 2} => s\nfor x in s:\n    str(x)^0'],
    ['comprehension over a set', 'str([x for x in {3, 1, 2}])^0'],
    ['sum of a set of floats', 'str(sum({1.5, 2.5}))^0'],
  ];
  for (const [label, src] of mustDefer) {
    it(label, () => {
      const r = interpret(src);
      expect(r.ok, 'should not claim success').toBe(false);
      expect(r.unsupported.length, 'should record why it declined').toBeGreaterThan(0);
      expect(r.error, 'declining is not an error — it is a deferral').toBeUndefined();
    });
  }

  it('a set literal itself is still fine — only ITERATING one is deferred', () => {
    const r = interpret('{3, 1, 2} => s\nstr(len(s))^0');
    expect(r.ok).toBe(true);
    expect(r.output).toBe('3\n');
  });
});

/**
 * ARITY CONTRACT — EMLP-AUDIT-006.
 *
 * The census above covers argument SHAPES a test author would write, which is
 * the same population `builtin-shapes.test.ts` already had: calls with the
 * right number of arguments. Nineteen mutations showed the consequence — the
 * arity check that four builtins depend on could be deleted entirely and all
 * 51 cells stayed green.
 *
 * Every row here prints `str(e)`, so the comparison is against CPython's exact
 * MESSAGE. A row that printed only the exception's type name would pass against
 * any wording at all, and the wording is the point: CPython says "takes exactly
 * one argument (2 given)" for abs, "expected at most 1 argument, got 2" for
 * float, and "takes at least 1 positional argument" for a zero-argument sum
 * where the surplus form says "takes at most 2 arguments". One shared sentence
 * cannot be right for more than one of them.
 *
 * The legal rows — repr(42), str(), str("a"), int(), int("10"), float(), set()
 * — are positive controls, not filler. Without them a fix that rejected every
 * call to a builtin would turn this whole block green.
 */
const arityProbe = (call: string) =>
  `try:\n    str(${call})^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0\nexcept ValueError as e:\n    "ValueError: " + str(e)^0`;

describe.skipIf(!PYTHON)('builtin arity contract ≡ CPython (EMLP-AUDIT-006)', () => {
  const CALLS: [string, string][] = [
    // exactly-one builtins, both directions, and the N in the message
    ['abs with no arguments', 'abs()'],
    ['abs with two arguments', 'abs(1, 2)'],
    ['len with no arguments', 'len()'],
    ['len with two arguments', 'len([1], 2)'],
    ['repr with one argument is LEGAL', 'repr(42)'],
    ['repr with no arguments', 'repr()'],
    ['repr with two arguments', 'repr(1, 2)'],
    // str: 0 and 1 legal, 4+ is where arity begins
    ['str with no arguments is LEGAL', 'str()'],
    ['str with one argument is LEGAL', 'str("a")'],
    ['str with four arguments', 'str("a", "b", "c", "d")'],
    // sum: the two directions are worded differently in CPython
    ['sum with no arguments', 'sum()'],
    ['sum with three arguments', 'sum([1], 0, 9)'],
    // int: 0 and 1 legal, 3+ is arity, decided before the base question
    ['int with no arguments is LEGAL', 'int()'],
    ['int with one argument is LEGAL', 'int("10")'],
    ['int with three arguments', 'int("10", 2, 3)'],
    // float
    ['float with no arguments is LEGAL', 'float()'],
    ['float with two arguments', 'float(1, 2)'],
    // set: four regions, and the arity decision precedes the conversion one
    ['set with no arguments is LEGAL', 'set()'],
    ['set with one NON-iterable argument', 'set(1)'],
    ['set with two arguments', 'set(1, 2)'],
    // min/max: no arguments and an empty iterable are different TYPES
    ['min with no arguments', 'min()'],
    ['max with no arguments', 'max()'],
    ['min of an empty iterable', 'min([])'],
    ['max of an empty iterable', 'max([])'],
  ];
  for (const [label, call] of CALLS) {
    it(label, () => {
      const src = arityProbe(call);
      const fwd = transpileEmlToPython(src);
      expect(fwd.ok, `forward transpile failed: ${fwd.diagnostics.map((d) => d.code).join(',')}`).toBe(true);
      expect(eml(src), `EML interpreter disagrees with CPython for: ${call}`).toBe(cpython(fwd.python));
    });
  }
});

/**
 * The six shapes that DEFER rather than answer — EMLP-AUDIT-006, per the policy
 * fixed in EMLP-RELAY-0097 section 2.
 *
 * `int(x, base)` at exactly two arguments and `str(object, encoding[, errors])`
 * at exactly two or three are declined rather than implemented: no corpus
 * program reaches either (0 of 741 call sites), and implementing them means a
 * message surface nothing exercises. Declining is not the same as answering
 * wrongly, and before this change `int("101", 2)` returned 101 where CPython
 * returns 5 — the only wrong VALUE in the census.
 *
 * These rows exist so a later "improvement" that makes any of them merely
 * ANSWER goes red instead of passing quietly.
 */
/**
 * ITERABILITY OF A USER INSTANCE — EMLP-AUDIT-006 v2, from EMLP-RELAY-0100.
 *
 * Candidate v1 asked `iterableItems(x)` and read its null as "not iterable".
 * That function answers whether the shape is one the interpreter models
 * directly; it does not answer whether CPython would iterate the object
 * through a user class's `__iter__`/`__next__` or the sequence protocol's
 * `__getitem__`. The two sets are not equal, and v1 turned the product's
 * honest deferral into a wrong answer for every instance in the gap.
 *
 * The decision is three-valued, so it needs rows on both sides of both
 * boundaries. The two TypeError rows are the negative controls: without them a
 * fix that deferred on every instance would look correct.
 */
describe.skipIf(!PYTHON)('a user instance is iterable when CPython says so (EMLP-AUDIT-006)', () => {
  const NOT_ITERABLE: [string, string][] = [
    ['an instance with no iteration protocol',
     'class Plain:\n    def hello(self):\n        return 1\n\nPlain() => p\ntry:\n    str(len(set(p)))^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0'],
    ['an instance with only __len__',
     'class Sized:\n    def __len__(self):\n        return 3\n\nSized() => z\ntry:\n    str(len(set(z)))^0\nexcept TypeError as e:\n    "TypeError: " + str(e)^0'],
  ];
  for (const [label, src] of NOT_ITERABLE) {
    it(label, () => {
      const fwd = transpileEmlToPython(src);
      expect(fwd.ok, `forward transpile failed: ${fwd.diagnostics.map((d) => d.code).join(',')}`).toBe(true);
      expect(eml(src), `EML interpreter disagrees with CPython for: ${label}`).toBe(cpython(fwd.python));
    });
  }
});

describe('an instance that CPython WOULD iterate is deferred, not refused (EMLP-AUDIT-006)', () => {
  const MUST_DEFER: [string, string][] = [
    ['a class defining __iter__ and __next__',
     'class EmptyIter:\n    def __iter__(self):\n        return self\n    def __next__(self):\n        raise StopIteration()\n\nEmptyIter() => it\nstr(len(set(it)))^0'],
    ['a class defining __getitem__',
     'class Seq:\n    def __getitem__(self, i):\n        if i < 3:\n            return i\n        raise IndexError()\n\nSeq() => s\nstr(len(set(s)))^0'],
    // The entry point can also arrive at runtime. Searching only the class
    // body misses this one; searching only the class attributes misses the
    // two above.
    ['a __getitem__ bound as a class attribute',
     'class Assigned:\n    def marker(self):\n        return 0\n\ndef pick(self, i):\n    if i < 2:\n        return i\n    raise IndexError()\n\npick => Assigned.__getitem__\nAssigned() => a\nstr(len(set(a)))^0'],
  ];
  for (const [label, src] of MUST_DEFER) {
    it(label, () => {
      const r = interpret(src);
      expect(r.ok, 'should not claim success').toBe(false);
      expect(r.unsupported.length, 'should record why it declined').toBeGreaterThan(0);
      expect(r.error, 'declining is not an error — it is a deferral').toBeUndefined();
    });
  }
});

describe('the shapes that decline rather than guess (EMLP-AUDIT-006)', () => {
  const mustDefer: [string, string][] = [
    ['int with a base', 'str(int("101", 2))^0'],
    ['int with a base that rejects the literal', 'str(int("5", 2))^0'],
    ['int with a base and a non-string', 'str(int(1, 2))^0'],
    ['str with two arguments is the decoding path', 'str(str("a", "b"))^0'],
    ['str with three arguments is the decoding path', 'str(str("a", "b", "c"))^0'],
    ['set from an iterable', 'str(set([1, 2]))^0'],
  ];
  for (const [label, src] of mustDefer) {
    it(label, () => {
      const r = interpret(src);
      expect(r.ok, 'should not claim success').toBe(false);
      expect(r.unsupported.length, 'should record why it declined').toBeGreaterThan(0);
      expect(r.error, 'declining is not an error — it is a deferral').toBeUndefined();
    });
  }
});
