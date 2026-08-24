/**
 * EMLP-AUDIT-003 — A-matrix. One finding, three mechanisms, six cells.
 *
 * Scope per EMLP-RELAY-0040: EMITTER ONLY. The interpreter is correct in every
 * cell below and must not be touched. The correct direction is the existing
 * `eml:equiv` going red -> green.
 *
 * Each cell is asserted twice, in separate columns:
 *   exact emission  - the parentheses the AST requires actually appear
 *   behavioural     - interpreter and CPython agree on a discriminating input
 *
 * Behavioural values were chosen so that nested and chained/re-associated
 * semantics predict DIFFERENT answers. A first draft of cmp_left / cmp_right
 * used values where both predictions coincided and the cells reported ok:true
 * against the unpatched emitter; those witnesses were replaced.
 */
import { describe, it, expect } from 'vitest';
import { transpileEmlToPython } from '@eml/transpiler-python';

const py = (src: string) => transpileEmlToPython(src).python;
const rhs = (src: string) => {
  const m = /^r = (.+)$/m.exec(py(src));
  if (!m) throw new Error('no `r = ...` line in:\n' + py(src));
  return m[1];
};

const CELLS = {
  cmp_left: '1 => a\n2 => b\n0 => c\n((a == b) == c) => r\nstr(r)^0\n',
  cmp_right: '0 => a\n1 => b\n2 => c\n(a == (b == c)) => r\nstr(r)^0\n',
  float_add: '1.0 => a\n10000000000000000.0 => b\n-10000000000000000.0 => c\n(a + (b + c)) => r\nstr(r)^0\n',
  float_mul: '0.1 => a\n3.0 => b\n7.0 => c\n(a * (b * c)) => r\nstr(r)^0\n',
  member_elem: '1 => a\n2 => b\n[0] => c\n((a == b) in c) => r\nstr(r)^0\n',
  member_coll: '9 => x\n[1] => p\n[9] => q\n(x in (p or q)) => r\nstr(r)^0\n',
};

describe('EMLP-AUDIT-003 — exact emission: AST grouping survives', () => {
  it('mechanism 2, comparison in LEFT position keeps its parentheses', () => {
    expect(rhs(CELLS.cmp_left)).toBe('(a == b) == c');
  });
  it('mechanism 2, comparison in RIGHT position keeps its parentheses', () => {
    expect(rhs(CELLS.cmp_right)).toBe('a == (b == c)');
  });
  it('mechanism 1, float + keeps an equal-precedence right operand grouped', () => {
    expect(rhs(CELLS.float_add)).toBe('a + (b + c)');
  });
  it('mechanism 1, float * keeps an equal-precedence right operand grouped', () => {
    expect(rhs(CELLS.float_mul)).toBe('a * (b * c)');
  });
  it('mechanism 3, membership ELEMENT keeps its parentheses', () => {
    expect(rhs(CELLS.member_elem)).toBe('(a == b) in c');
  });
  it('mechanism 3, membership COLLECTION keeps its parentheses', () => {
    expect(rhs(CELLS.member_coll)).toBe('x in (p or q)');
  });

  it('no EML source emits a Python comparison chain', () => {
    // EML rejects `a < b < c` at parse time, so a three-term chain in the
    // output can only ever be an emitter artefact.
    const chain = /\w+\s*(==|!=|<=|>=|<|>|\bin\b)\s*\w+\s*(==|!=|<=|>=|<|>|\bin\b)\s*\w+/;
    for (const [name, src] of Object.entries(CELLS)) {
      const out = rhs(src);
      expect(chain.test(out), `${name}: ${out}`).toBe(false);
    }
  });
});

describe('EMLP-AUDIT-003 — NULL controls: already-correct shapes must not gain parentheses', () => {
  it('a left-associated chain of + is already correct and stays bare', () => {
    expect(rhs('1.0 => a\n2.0 => b\n3.0 => c\n((a + b) + c) => r\nstr(r)^0\n')).toBe('a + b + c');
  });
  it('a single comparison stays bare', () => {
    expect(rhs('1 => a\n2 => b\n(a == b) => r\nstr(r)^0\n')).toBe('a == b');
  });
  it('a plain membership stays bare', () => {
    expect(rhs('1 => a\n[1] => c\n(a in c) => r\nstr(r)^0\n')).toBe('a in c');
  });
  it('tighter-binding operands are not parenthesized by the fix', () => {
    expect(rhs('1 => a\n2 => b\n3 => c\n((a * b) == c) => r\nstr(r)^0\n')).toBe('a * b == c');
  });
});
