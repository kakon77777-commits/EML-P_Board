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
