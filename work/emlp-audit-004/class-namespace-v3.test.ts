/**
 * EMLP-AUDIT-004 v3 — a class namespace built in SOURCE ORDER.
 *
 * Scope per EMLP-RELAY-0040, corrected by EMLP-RELAY-0048.
 *
 * WHAT v2 GOT WRONG. v2 pre-collected the whole class body into a binding set
 * before emitting any of it, so a read EARLIER in the body resolved against a
 * binding that happens LATER:
 *
 *     5 => list
 *     class C:
 *         list => before      # v2 emitted `before = list`  -> the builtin
 *         7 => list
 *
 * Python executes a class body one statement at a time. At the first body line
 * `list` is not yet a class attribute, so it must still resolve outward to the
 * module alias `lst`. 岑衡 caught this in EMLP-RELAY-0048 with a legal,
 * transpile.ok=true witness; it is reproduced here as gate 1.
 *
 * WHAT v3 DOES. Two rules, not one:
 *
 *   a READ            unaliased only if the name is ALREADY an attribute at
 *                     this point in the body
 *   a DEFINITION SITE always unaliased inside a class body, because it is what
 *                     creates the attribute - that is the finding itself,
 *                     `5 => list` must give `c.list` and not `c.lst`
 *
 * v2 had one rule for both, which is why it could not express gate 1 and
 * gate 8 at the same time.
 *
 * WHAT IS MODELLED. Only the two shapes the analyzer admits in a class body.
 * Measured against the analyzer on 2026-08-26:
 *
 *     plain Assignment      ok
 *     method FunctionDef    ok
 *     AugmentedAssign       E_CLASS_BODY_UNSUPPORTED
 *     nested ClassDef       E_CLASS_BODY_UNSUPPORTED
 *     ForIn / With / If / While / Try / bare expression
 *                           E_CLASS_BODY_UNSUPPORTED
 *
 * v2 modelled six shapes that cannot occur. Per 0048 those are no longer parity
 * gates; the diagnosed-unsupported assertions live in the 003/004 verification
 * file, not here.
 *
 * EVERY LEGAL GATE IS CHECKED TWICE: the exact emission, and behavioral parity
 * between the interpreter and real CPython. An emission assertion alone cannot
 * fail in the direction that matters - it tests the string I chose to write.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transpileEmlToPython } from '@eml/transpiler-python';
import { interpret } from '@eml/interp';

const PYTHON = process.env.EML_PYTHON ?? 'python';

function py(src: string): string {
  const r = transpileEmlToPython(src);
  if (!r.ok) throw new Error(`transpile refused a program this gate needs:\n${src}`);
  return r.python;
}

function cpython(program: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'emlp-004-v3-'));
  try {
    const f = join(dir, 'case.py');
    writeFileSync(f, program, 'utf8');
    const r = spawnSync(PYTHON, [f], { encoding: 'utf8' });
    if (r.status !== 0) return `!! exit ${r.status}: ${(r.stderr ?? '').trim().split('\n').pop()}`;
    return (r.stdout ?? '').trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function interpOut(src: string): string {
  const ir = interpret(src);
  if (ir.error) return `!! ${ir.error.type}: ${ir.error.message}`;
  if (!ir.ok) return `~~ DEFER`;
  return (ir.output ?? '').trim();
}

/** Both halves: the emitted text, and that both engines agree on the result. */
function gate(src: string, expectEmit: RegExp[], expectOut: string): void {
  const out = py(src);
  for (const re of expectEmit) expect(out, out).toMatch(re);
  const fromInterp = interpOut(src);
  const fromCPython = cpython(out);
  expect(fromInterp, `interpreter\n${out}`).toBe(expectOut);
  expect(fromCPython, `CPython\n${out}`).toBe(expectOut);
}

describe('EMLP-AUDIT-004 v3 — source-order class namespace', () => {
  // The witness from EMLP-RELAY-0048. v2 emits `before = list` here and CPython
  // prints "<class 'list'>" while the interpreter prints 5.
  it('gate 1: a read BEFORE the binding resolves to the module alias', () => {
    gate(
      '5 => list\n\nclass C:\n    list => before\n    7 => list\n\nC() => c\nstr(c.before) + " " + str(c.list)^0\n',
      [/before = lst/, /^\s+list = 7$/m],
      '5 7',
    );
  });

  it('gate 2: a read AFTER the binding resolves to the class attribute', () => {
    gate(
      '5 => list\n\nclass C:\n    7 => list\n    list => after\n\nC() => c\nstr(c.after)^0\n',
      [/^\s+list = 7$/m, /after = list/],
      '7',
    );
  });

  it('gate 3: a name the class never binds resolves to the module alias', () => {
    gate(
      '5 => list\n\nclass C:\n    list => copied\n\nC() => c\nstr(c.copied)^0\n',
      [/copied = lst/],
      '5',
    );
  });

  it('gate 4: a method body does not capture the class namespace', () => {
    gate(
      '5 => list\n\nclass C:\n    9 => list\n    def m(self):\n        list => seen\n        return seen\n\nC() => c\nstr(c.m())^0\n',
      [/^\s+list = 9$/m, /seen = lst/],
      '5',
    );
  });

  it('gate 8: the finding itself — a class-bound name is reachable as c.name', () => {
    gate('5 => list\n\nclass C:\n    7 => list\n\nC() => c\nstr(c.list)^0\n', [/^\s+list = 7$/m], '7');
  });
});

describe('EMLP-AUDIT-004 v3 — module-level binders keep the alias policy', () => {
  // These three take the branch. An except handler whose branch never runs is
  // an empty observable and passes any comparison: the first draft of gate 5
  // was green while the binder and its read were spelled DIFFERENTLY.
  it('gate 5: except-as binder and its reads are the same name, branch taken', () => {
    gate(
      '5 => list\ntry:\n    int("x") => z\nexcept ValueError as list:\n    str(list) => z\nstr(z)^0\n',
      [/except ValueError as lst:/, /z = str\(lst\)/],
      "invalid literal for int() with base 10: 'x'",
    );
  });

  it('gate 6: for-in binder and its reads are the same name', () => {
    gate('5 => list\nfor list in [1:2]:\n    list => tmp\nstr(tmp)^0\n', [/for lst in range\(/, /tmp = lst/], '2');
  });

  it('gate 7: a non-colliding binder is untouched', () => {
    gate('for alpha in [1:2]:\n    alpha => tmp\nstr(tmp)^0\n', [/for alpha in range\(/, /tmp = alpha/], '2');
  });
});

describe('EMLP-AUDIT-004 v3 — controls', () => {
  it('control: a builtin callee is not aliased', () => {
    gate('5 => list\nstr(len([1, 2, 3]))^0\n', [/len\(\[1, 2, 3\]\)/], '3');
  });

  it('control: a class body with no colliding name is emitted unchanged', () => {
    gate(
      'class C:\n    7 => alpha\n    alpha => beta\n\nC() => c\nstr(c.beta)^0\n',
      [/alpha = 7/, /beta = alpha/],
      '7',
    );
  });

  it('control: module scope is untouched by the class frame', () => {
    gate(
      '5 => list\n\nclass C:\n    7 => list\n\nstr(list)^0\n',
      [/^lst = 5$/m, /^\s+list = 7$/m, /print\(str\(lst\)\)/],
      '5',
    );
  });

  // Negative: the shapes 0048 removed from the parity column really are
  // refused, so their absence from this file is a measured fact and not an
  // omission.
  it('control: the six shapes v3 does not model are refused by the analyzer', () => {
    const refused = [
      'class C:\n    5 => x\n    x += 1\n\nstr(1)^0\n',
      'class C:\n    class D:\n        1 => y\n\nstr(1)^0\n',
      'class C:\n    for i in [1:3]:\n        i => x\n\nstr(1)^0\n',
      'class C:\n    with open("f") as h:\n        1 => x\n\nstr(1)^0\n',
      'class C:\n    if 1 > 0:\n        1 => x\n\nstr(1)^0\n',
      'class C:\n    1 + 1\n\nstr(1)^0\n',
    ];
    for (const src of refused) {
      const r = transpileEmlToPython(src);
      expect(r.ok, src).toBe(false);
      expect(JSON.stringify(r.diagnostics ?? []), src).toMatch(/E_CLASS_BODY_UNSUPPORTED/);
    }
  });
});
