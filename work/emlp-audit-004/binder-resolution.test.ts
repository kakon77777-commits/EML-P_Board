/**
 * EMLP-AUDIT-004 v2 — binder x legal-reference resolution identity.
 *
 * Scope per EMLP-RELAY-0040 and the regression ruling in EMLP-RELAY-0044.
 *
 * The rule is NOT "alias every name position", and it is NOT "never alias
 * inside a class". It is: a name bound in a CLASS BODY lands in the class
 * namespace and is spelled the same in every position — the binder, a bare
 * read inside the body, and `c.name` from outside. A name that is NOT bound in
 * the class body resolves outward and keeps the ordinary alias policy.
 *
 * v1 of this fix aliased only the assignment TARGET, which turned a
 * self-consistent class into `list = 5` followed by `mirror = lst` — a
 * NameError at class definition time, on a cell that had been green at
 * baseline. 岑衡 caught it with V1 in EMLP-RELAY-0044.
 *
 * for / with / except-as inside a class body are rejected by the analyzer
 * (E_CLASS_BODY_UNSUPPORTED), so those gates assert EXACT EMISSION only. Their
 * parity column is reported separately in the handback and is not claimed here.
 */
import { describe, it, expect } from 'vitest';
import { transpileEmlToPython } from '@eml/transpiler-python';

const py = (src: string) => transpileEmlToPython(src).python;

describe('EMLP-AUDIT-004 — module-level binders that must be aliased', () => {
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

  it('for-in binder matches its reads', () => {
    const out = py('for list in [1:2]:\n    str(list)^0\n');
    expect(out, out).toMatch(/for lst in range\(/);
    expect(out, out).toMatch(/str\(lst\)/);
  });
});

describe('EMLP-AUDIT-004 v2 — class namespace, six separable gates', () => {
  it('gate 1 — class assignment binder matches a bare class-body read', () => {
    const out = py('class C:\n    5 => list\n    list => mirror\n\nC() => c\nstr(c.mirror)^0\n');
    expect(out, out).toMatch(/^\s+list = 5$/m);
    expect(out, out).toMatch(/^\s+mirror = list$/m);
    expect(out, out).not.toMatch(/\blst\b/);
  });

  it('gate 2 — class for binder is spelled as the attribute readers use', () => {
    const out = py('class C:\n    for list in [1:2]:\n        pass\n\nC() => c\nstr(c.list)^0\n');
    expect(out, out).toMatch(/for list in range\(/);
    expect(out, out).not.toMatch(/for lst in range\(/);
  });

  it('gate 3 — class with binder is spelled as the attribute readers use', () => {
    const out = py('class C:\n    with M() as list:\n        pass\n\nC() => c\nstr(c.list)^0\n');
    expect(out, out).toMatch(/with M\(\) as list:/);
    expect(out, out).not.toMatch(/with M\(\) as lst:/);
  });

  it('gate 4 — class except-as binder matches its handler read', () => {
    const out = py(
      'class C:\n    try:\n        pass\n    except ValueError as list:\n        list => seen\n',
    );
    const bound = /except ValueError as (\w+):/.exec(out);
    expect(bound, out).not.toBeNull();
    expect(out, out).toMatch(new RegExp('seen = ' + bound![1] + '$', 'm'));
  });

  it('gate 5 — a method NAME is a class attribute and keeps its spelling', () => {
    const out = py('class C:\n    def list(self):\n        return 1\n\nC() => c\nstr(c.list())^0\n');
    expect(out, out).toMatch(/def list\(self\):/);
    expect(out, out).not.toMatch(/def lst\(self\):/);
  });

  it('gate 6 — a bare read of a MODULE-level name from a class body still aliases', () => {
    // `list` is not bound in this class body, so it resolves outward and the
    // ordinary alias policy applies. The rule is scope-aware, not blanket.
    const out = py('5 => list\nclass C:\n    list => mirror\n');
    expect(out, out).toMatch(/^lst = 5$/m);
    expect(out, out).toMatch(/^\s+mirror = lst$/m);
  });
});

describe('EMLP-AUDIT-004 — method bodies resume the ordinary policy', () => {
  it('class-namespace suppression does not leak into a method body', () => {
    const out = py('class C:\n    def m(self):\n        5 => list\n        return list\n');
    expect(out, out).toMatch(/lst = 5/);
    expect(out, out).not.toMatch(/^\s+list = 5$/m);
  });

  it('gate 7 — a method-body read of a CLASS-attribute name still aliases', () => {
    // This is the gate that actually detects removing the scope reset. The
    // case above does not: `list` is bound inside the method, so it is not in
    // the class binding set either way and aliases regardless.
    //
    // Here `list` IS a class attribute. In Python a method body does not see
    // the class namespace, so a bare `list` means the module-level name, which
    // EML spells `lst`. Without the reset the class frame is still on top and
    // this would emit the builtin `list`.
    const out = py('class C:\n    5 => list\n    def m(self):\n        list => copy\n        return copy\n');
    expect(out, out).toMatch(/^\s+list = 5$/m);
    expect(out, out).toMatch(/^\s+copy = lst$/m);
    expect(out, out).not.toMatch(/^\s+copy = list$/m);
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
