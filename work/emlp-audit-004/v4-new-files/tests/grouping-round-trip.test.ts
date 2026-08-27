import { describe, it, expect } from 'vitest';
import { roundTripFromEml } from '@eml/transpiler-eml';
import { transpileEmlToCpp } from '@eml/transpiler-cpp';

/**
 * GROUPING IS A PROPERTY OF THE AST, AND EVERY EMITTER RENDERS THE SAME AST.
 *
 * EMLP-AUDIT-003 fixed the Python emitter: it was dropping parentheses the AST
 * requires, because it treated `+`/`*` as re-associable (they are not, under
 * IEEE-754) and let a comparison or a membership operand sit bare inside
 * another comparison.
 *
 * That fix was applied to ONE emitter. There are three, and all three render
 * the same AST:
 *
 *   transpiler-python  AST -> Python      fixed by 003
 *   transpiler-eml     AST -> EML         EMLP-AUDIT-023, CRITICAL
 *   transpiler-cpp     AST -> C++         EMLP-AUDIT-024, MAJOR
 *
 * 023 is CRITICAL because §9's round-trip fixpoint for the supported subset is
 * a FROZEN guarantee (spec §11): with the forward emitter keeping a paren that
 * the reverse emitter then removes, `Python -> EML -> Python` stops being a
 * fixpoint and the second Python means something else.
 *
 * 024 is MAJOR rather than CRITICAL only because the C++ back end is declared
 * non-normative (spec §11, "may change without a major bump"). The defect is
 * the same one, and real MSVC computes a different number.
 *
 * WHY THE EXISTING GATES DID NOT CATCH EITHER
 *
 * The corpus roundtrip gate runs `eml roundtrip` over every corpus program and
 * was green. None of the 576 corpus programs contains the shapes 003 is about,
 * so the gate's population excluded the failure. The 003 witnesses were run
 * through forward equivalence only. Nobody crossed the two.
 *
 * These gates cross them: the SAME witnesses, through the round trip and
 * through C++.
 */

// [label, EML source] - the grouping shapes 003 is about.
const WITNESSES: [string, string][] = [
  ['comparison on the left', 'str((1 != 2) < 1)^0\n'],
  ['comparison on the right', 'str(1 != (2 < 1))^0\n'],
  ['membership on both comparison sides', 'str((1 in []) == (2 in []))^0\n'],
  ['not as a membership element', 'str((not 0) in [])^0\n'],
  ['conditional as a membership collection', 'str(1 in (0 ? [1] : [2]))^0\n'],
];

describe('EMLP-AUDIT-023 - the reverse emitter preserves the grouping the forward one keeps', () => {
  for (const [label, src] of WITNESSES) {
    it(`round-trips to a fixpoint: ${label}`, () => {
      const r = roundTripFromEml(src);
      expect(r.ok, `round trip refused:\n${src}`).toBe(true);
      const { python1, eml2, python2 } = r.steps;
      expect(python2, `python1:\n${python1}\neml2:\n${eml2}\npython2:\n${python2}`).toBe(python1);
    });
  }

  // The minimal witness, kept separate because it is the one in the report and
  // because its two forms are both VALID Python that mean different things -
  // which is what makes a silent rewrite dangerous rather than merely wrong.
  it('the minimal witness: (not 0) in [] does not become not (0 in [])', () => {
    const r = roundTripFromEml('str((not 0) in [])^0\n');
    expect(r.ok).toBe(true);
    const { python1, eml2, python2 } = r.steps;
    expect(python1).toContain('(not 0) in []');
    expect(eml2, `eml2 was: ${eml2}`).toContain('(not 0) in');
    expect(python2).toBe(python1);
  });

  // Float grouping: `a + (b + c)` is not `(a + b) + c` once rounding is in
  // play, so the reverse emitter must not flatten it either.
  it('float addition grouping survives the reverse path', () => {
    const src = '1.0 => a\n10000000000000000.0 => b\n-10000000000000000.0 => c\nstr(a + (b + c))^0\n';
    const r = roundTripFromEml(src);
    expect(r.ok, `round trip refused:\n${src}`).toBe(true);
    const { python1, python2 } = r.steps;
    expect(python1).toMatch(/\+ \(/);
    expect(python2).toBe(python1);
  });
});

describe('EMLP-AUDIT-024 - the C++ emitter preserves it too', () => {
  it('a nested comparison keeps its parentheses', () => {
    const r = transpileEmlToCpp('(((1 != 2) < 1) + 0)^0\n');
    expect(r.ok, JSON.stringify(r.diagnostics ?? [])).toBe(true);
    // C++ splits comparison across two precedence tiers: `<` binds tighter
    // than `!=`. Bare, `1 != 2 < 1` is `1 != (2 < 1)` and evaluates to 1 where
    // the AST says 0.
    expect(r.cpp, r.cpp).toContain('((1 != 2) < 1)');
    expect(r.cpp, r.cpp).not.toMatch(/[^(]1 != 2 < 1/);
  });

  it('float addition grouping is not flattened', () => {
    const r = transpileEmlToCpp('1.0 => a\n10000000000000000.0 => b\n-10000000000000000.0 => c\nstr(a + (b + c))^0\n');
    expect(r.ok, JSON.stringify(r.diagnostics ?? [])).toBe(true);
    expect(r.cpp, r.cpp).toMatch(/\+ \(/);
  });
});

/**
 * The real-compiler gate lives with the demos, not here. `examples/phase4-cpp/`
 * is compiled and RUN by tests/transpiler-cpp.test.ts against a real C++20
 * toolchain in one shared MSVC session, and `grouping_comparison` was added to
 * that set for this finding: its expected stdout is 0, which is what the
 * interpreter and real CPython produce, and what MSVC produced before the fix
 * was 1.
 *
 * Reusing that machinery rather than duplicating it also keeps the async spawn
 * discipline that file documents - a synchronous spawn over a ~100s MSVC
 * session starves vitest's reporter.
 */
