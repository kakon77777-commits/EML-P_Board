/**
 * EMLP-AUDIT-004 — a binder name is emitted raw while every read of it is
 * emitted through `aliasIdentifier`, so the two disagree and Python raises
 * NameError.
 *
 * Red against baseline. Two live sites:
 *   emitter.ts:214  `except <Type> as ${h.name}:`
 *   emitter.ts:230  `with <expr> as ${stmt.target.name}:`
 *
 * Both interpolate `.name` directly. Identifier reads go through
 * `aliasIdentifier` (emitter.ts:75), and `def` parameters do too
 * (emitter.ts:256), so a binder called `list` is written as `list` and read
 * as `lst`.
 *
 * Measured on the real runtime, not just the emitted text:
 *   NameError: name 'lst' is not defined. Did you mean: 'list'?
 */
import { describe, it, expect } from 'vitest';
import { transpileEmlToPython } from '@eml/transpiler-python';

const py = (src: string) => transpileEmlToPython(src).python;

describe('EMLP-AUDIT-004 — binder names skip the identifier alias', () => {
  it('aliases an except binder the same way it aliases reads of it', () => {
    const out = py(
      'def risky():\n    raise ValueError("boom")\n\ntry:\n    risky()\nexcept ValueError as list:\n    "caught: " + str(list) ^0\n',
    );
    expect(out, out).toMatch(/except ValueError as lst:/);
    expect(out, out).not.toMatch(/except ValueError as list:/);
  });

  it('aliases a with binder the same way it aliases reads of it', () => {
    const out = py('with open("x.txt") as list:\n    "got: " + str(list) ^0\n');
    expect(out, out).toMatch(/as lst:/);
    expect(out, out).not.toMatch(/as list:/);
  });

  it('never emits a binder and a read of it under different names', () => {
    // The class, not the two instances: whatever a binder is called, the
    // reads of it in the same scope must use the same emitted name.
    for (const src of [
      'def risky():\n    raise ValueError("boom")\n\ntry:\n    risky()\nexcept ValueError as list:\n    "caught: " + str(list) ^0\n',
      'with open("x.txt") as list:\n    "got: " + str(list) ^0\n',
    ]) {
      const out = py(src);
      const bound = /as (\w+):/.exec(out);
      expect(bound, out).not.toBeNull();
      const name = bound![1];
      // the body reads it; whatever name the body uses must be the bound one
      const read = /str\((\w+)\)/.exec(out);
      expect(read, out).not.toBeNull();
      expect(read![1], out).toBe(name);
    }
  });
});
