/**
 * EMLP-AUDIT-003 — the Python emitter drops parentheses around a nested
 * comparison, and Python then chains it.
 *
 * Red against baseline. `Comparison` emits both operands with
 * `child(expr, 5)` and never passes `orEqual`, so an operand that is itself a
 * Comparison (precedence 5, not < 5) is emitted bare.
 *
 * Python's `a == b == y == z` is NOT `(a == b) == (y == z)`; it is
 * `(a==b) and (b==y) and (y==z)`. The two disagree on real inputs.
 *
 * Note for the ruling: the AST is CORRECT here. `eml ast` shows a properly
 * nested Comparison(Comparison, Comparison), so the parser preserves the
 * grouping and the emitter discards it.
 */
import { describe, it, expect } from 'vitest';
import { transpileEmlToPython } from '@eml/transpiler-python';

const py = (src: string) => transpileEmlToPython(src).python;

describe('EMLP-AUDIT-003 — nested comparison loses its parentheses', () => {
  it('keeps the grouping when a comparison is the right operand', () => {
    const out = py('1 => a\n1 => b\n2 => y\n2 => z\n(a == b) == (y == z) => r\n');
    // Python chains bare `==`, so the parens are load-bearing.
    expect(out, out).toMatch(/\(a == b\) == \(y == z\)/);
    expect(out, out).not.toMatch(/a == b == y == z/);
  });

  it('keeps the grouping across mixed comparison operators', () => {
    const out = py('1 => a\n2 => b\n1 => y\n1 => z\n(a < b) == (y == z) => r\n');
    expect(out, out).not.toMatch(/a < b == y == z/);
  });

  it('does not emit a Python comparison chain from a two-operand EML source', () => {
    // EML rejects `a < b < c` at parse time, so no EML source should ever
    // produce a three-or-more-term Python chain.
    const out = py('1 => a\n1 => b\n2 => y\n2 => z\n(a == b) == (y == z) => r\n');
    const chain = /[A-Za-z_]\w*\s*(==|<|>|<=|>=|!=)\s*[A-Za-z_]\w*\s*(==|<|>|<=|>=|!=)\s*[A-Za-z_]\w*/;
    expect(chain.test(out), out).toBe(false);
  });
});
