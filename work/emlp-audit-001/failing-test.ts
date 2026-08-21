import { describe, it, expect } from 'vitest';
import { validateEquivalence } from '@eml/ai-converter';

/**
 * Minimal failing witnesses for EMLP-AUDIT-001 and EMLP-AUDIT-002.
 *
 * Both were reported by 岑衡 (Codex) and reproduced by him against HEAD a2c57d1
 * (AI Board eml-p-relay, EMLP-RELAY-0010). These tests are RED against the
 * baseline f77a43f and must stay red until the fixes land.
 *
 * Source: EMLP-AUDIT-001 packages/ai-converter/src/validator.ts:112
 *         EMLP-AUDIT-002 packages/ai-converter/src/validator.ts:126
 */
describe('EMLP-AUDIT-001: only the first numeric free variable is varied', () => {
  it('certifies a candidate that ignores the second variable entirely', () => {
    // The validator varies freeVars[0] across SPREAD and pins every other
    // numeric free variable to the literal '3'. A candidate that dropped `b`
    // and folded in the pinned value therefore agrees on every input it is
    // ever shown.
    const original = 'result = a + b';
    const compiled = 'result = a + 3';

    // The LLM proposes bindings consistent with its own (wrong) reading, so
    // the extra check on its bindings also sits at b = 3.
    const r = validateEquivalence(original, compiled, 'result', ['a = 1\nb = 3']);

    // They are not equivalent: at b = 4 the original gives a + 4.
    expect(r.equivalent).toBe(false);
  });

  it('the same pair IS distinguishable, so the defect is the input choice', () => {
    // Same two programs, with b varied instead of a. This is the control:
    // it shows the programs really do differ, so the certification above is
    // about which inputs were generated and not about the programs agreeing.
    const original = 'result = a + b';
    const compiled = 'result = a + 3';
    const r = validateEquivalence(original, compiled, 'result', ['b = 1\na = 3']);
    expect(r.equivalent).toBe(false);
  });
});

describe('EMLP-AUDIT-002: inputs that crash the candidate are dropped', () => {
  it('certifies a candidate that raises where the original does not', () => {
    // a = 7 is one of the validator's own SPREAD values. The candidate raises
    // there; runPython reports !ok; the loop `continue`s and the input leaves
    // no trace. The remaining inputs agree, so the pair is certified.
    const original = 'result = a * 2';
    const compiled = "if a == 7:\n    raise ValueError('boom')\nresult = a * 2";

    const r = validateEquivalence(original, compiled, 'result', ['a = 1']);

    // Not equivalent: the candidate introduces an exception on an input the
    // original handles.
    expect(r.equivalent).toBe(false);
  });

  it('NULL control: an equivalent pair over the same inputs is certified', () => {
    // Nothing above should be read as "the validator rejects too much". With
    // no dropped input and no ignored variable it accepts correctly.
    const r = validateEquivalence('result = a * 2', 'result = a + a', 'result', ['a = 1']);
    expect(r.equivalent).toBe(true);
  });
});

/**
 * Acceptance surface for the 001 patch, set by 岑衡 in EMLP-RELAY-0025 §4.
 * These are GREEN after the fix; the drill that makes 001 red again lives in
 * work/emlp-audit-001/DRILL.md.
 */
describe('EMLP-AUDIT-001 acceptance', () => {
  it('§4.2 verdict is invariant under permutation of the binding lines', () => {
    const original = 'result = a + b';
    const compiled = 'result = a + 3';
    const one = validateEquivalence(original, compiled, 'result', ['a = 1\nb = 3']);
    const two = validateEquivalence(original, compiled, 'result', ['b = 3\na = 1']);
    expect(one.equivalent).toBe(two.equivalent);
    // §4.3: and both must be false.
    expect(one.equivalent).toBe(false);
  });

  it('§4.1 a candidate ignoring the THIRD of three variables is caught', () => {
    // The old rule varied a only. Nothing about "first" saves c.
    const original = 'result = a + b + c';
    const compiled = 'result = a + b + 3';
    expect(validateEquivalence(original, compiled, 'result', ['a = 1\nb = 1\nc = 3']).equivalent).toBe(false);
  });

  it('the coverage rule is reported, so the bound is visible in the result', () => {
    const r = validateEquivalence('result = a + b', 'result = b + a', 'result', ['a = 1\nb = 2']);
    expect(r.equivalent).toBe(true);
    expect(r.detail).toMatch(/one-at-a-time over 2 numeric variable\(s\)/);
  });
});

/**
 * Acceptance surface for 002. Separate root cause, separate obligations
 * (EMLP-RELAY-0025 §5): the divergence must be proved directly and the errored
 * inputs must be visible rather than dropped.
 */
describe('EMLP-AUDIT-002 acceptance', () => {
  it('names the failing side in the detail', () => {
    const r = validateEquivalence(
      'result = a * 2',
      "if a == 7:\n    raise ValueError('boom')\nresult = a * 2",
      'result',
      ['a = 1'],
    );
    expect(r.equivalent).toBe(false);
    expect(r.detail).toMatch(/compiled failed where the other succeeded/);
  });

  it('catches the reverse: the candidate swallows an error the original raises', () => {
    const r = validateEquivalence(
      "if a == 7:\n    raise ValueError('boom')\nresult = a * 2",
      'result = a * 2',
      'result',
      ['a = 1'],
    );
    expect(r.equivalent).toBe(false);
    expect(r.detail).toMatch(/original failed where the other succeeded/);
  });

  it('an input unusable on BOTH sides is counted, not hidden', () => {
    const r = validateEquivalence('result = 1/0', 'result = 1/0', 'result', ['a = 1']);
    expect(r.inconclusive).toBe(true);
    expect(r.detail).toMatch(/failed on BOTH sides/);
  });
});

/**
 * Added after 岑衡's EMLP-RELAY-0028 escape, because her test alone cannot
 * distinguish the two fixes that make it green:
 *   (a) extend numeric coverage across mixed bindings  <- what was intended
 *   (b) refuse to certify anything with a non-numeric variable
 * Both return equivalent:false for her non-equivalent pair. Only (a) still
 * certifies an equivalent one.
 */
describe('EMLP-AUDIT-001 mixed bindings: coverage, not refusal', () => {
  it('still CERTIFIES a genuinely equivalent mixed numeric/string pair', () => {
    const r = validateEquivalence(
      'result = a * 100 + b * 10 + len(tag)',
      'result = b * 10 + a * 100 + len(tag)',
      'result',
      ["a = 1\nb = 3\ntag = 'x'"],
    );
    expect(r, JSON.stringify(r)).toMatchObject({ equivalent: true });
  });

  it('reports that the numeric variables were covered despite the string one', () => {
    const r = validateEquivalence(
      'result = a + b + len(tag)',
      'result = b + a + len(tag)',
      'result',
      ["a = 1\nb = 2\ntag = 'zz'"],
    );
    expect(r.detail).toMatch(/one-at-a-time over 2 numeric variable\(s\)/);
    expect(r.detail).toMatch(/1 non-numeric held at the supplied value/);
  });

  it('fails closed when EVERY free variable is non-numeric', () => {
    const r = validateEquivalence("result = tag + 'x'", "result = tag + 'x'", 'result', ["tag = 'a'"]);
    expect(r.inconclusive).toBe(true);
    expect(r.detail).toMatch(/every free variable is non-numeric/);
  });
});
