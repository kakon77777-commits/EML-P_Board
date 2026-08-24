/**
 * EMLP-AUDIT-004 — binder x legal-reference resolution identity.
 *
 * Scope per EMLP-RELAY-0040. The rule is NOT "alias every name position". It
 * is: a binder and the legal references to it must resolve to the same thing.
 * That gives three sites with two different correct directions:
 *
 *   except-as        binder must be ALIASED   (reads are Identifiers -> aliased)
 *   with-as          binder must be ALIASED   (same)
 *   class attribute  binder must NOT be aliased (reads are `c.list`, an
 *                    Attribute access, which is not aliased)
 *
 * My first version of this test asserted "a binder and a read of it must emit
 * the same name" as a blanket rule. Extended to class bodies that pushes the
 * third site the WRONG way; 岑衡 caught it in EMLP-RELAY-0040.
 *
 * The decorator-argument site is a control: reachable, and correctly UNaliased,
 * because it names the callee's parameter rather than a local binding.
 */
import { describe, it, expect } from 'vitest';
import { transpileEmlToPython } from '@eml/transpiler-python';

const py = (src: string) => transpileEmlToPython(src).python;

describe('EMLP-AUDIT-004 — binders that must be aliased', () => {
  it('except-as binder matches its reads', () => {
    const out = py(
      'def risky():\n    raise ValueError("boom")\n\ntry:\n    risky()\nexcept ValueError as list:\n    "caught: " + str(list) ^0\n',
    );
    expect(out, out).toMatch(/except ValueError as lst:/);
    expect(out, out).toMatch(/str\(lst\)/);
  });

  it('with-as binder matches its reads', () => {
    const out = py('with open("d.txt") as list:\n    "got: " + str(list) ^0\n');
    expect(out, out).toMatch(/as lst:/);
    expect(out, out).toMatch(/str\(lst\)/);
  });
});

describe('EMLP-AUDIT-004 — a binder that must NOT be aliased', () => {
  it('class-body assignment stays a class attribute the reader can reach', () => {
    const out = py('class C:\n    5 => list\nC() => c\nstr(c.list)^0\n');
    // the attribute is written under the name every reader spells
    expect(out, out).toMatch(/^\s+list = 5$/m);
    expect(out, out).not.toMatch(/^\s+lst = 5$/m);
    expect(out, out).toMatch(/c\.list/);
  });

  it('class-attribute suppression does not leak into a method body', () => {
    const out = py('class C:\n    def m(self):\n        5 => list\n        return list\n');
    // inside a def, an ordinary local scope resumes, so it aliases again
    expect(out, out).toMatch(/lst = 5/);
    expect(out, out).not.toMatch(/^\s+list = 5$/m);
  });
});

describe('EMLP-AUDIT-004 — controls that must stay unaliased', () => {
  it('a decorator keyword names the callee parameter, not a local binding', () => {
    const out = py('@temporal_loop(list=5)\nasync def f(x):\n    return x\n');
    expect(out, out).toMatch(/@temporal_loop\(list=5\)/);
    expect(out, out).not.toMatch(/@temporal_loop\(lst=5\)/);
  });

  it('a genuine builtin call is still a builtin call', () => {
    const out = py('list(1) => r\nstr(r)^0\n');
    expect(out, out).toMatch(/list\(1\)/);
  });

  it('an ordinary binder with a non-colliding name is untouched', () => {
    const out = py(
      'def risky():\n    raise ValueError("boom")\n\ntry:\n    risky()\nexcept ValueError as e:\n    "caught: " + str(e) ^0\n',
    );
    expect(out, out).toMatch(/except ValueError as e:/);
    expect(out, out).toMatch(/str\(e\)/);
  });
});
