import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { interpret } from '@eml/interp';
import { transpileEmlToPython } from '@eml/transpiler-python';

const PYTHON = (() => {
  for (const candidate of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
  }
  return null;
})();

function cpythonOutput(src: string): string {
  const py = transpileEmlToPython(src).python;
  const run = spawnSync(PYTHON!, ['-c', py], { encoding: 'utf8' });
  if (run.status !== 0) {
    const last = (run.stderr ?? '').trim().split(/\r?\n/).pop() ?? '';
    return `!! ${last}`;
  }
  return (run.stdout ?? '').replace(/\r\n/g, '\n').trim();
}

function interpOutput(src: string): string {
  const run = interpret(src);
  if (run.error) return `!! ${run.error.type}: ${run.error.message}`;
  if (!run.ok) return `~~ ${run.unsupported.join(',')}`;
  return (run.output ?? '').trim();
}

const NO_INIT_MESSAGE_ROWS: Array<[string, string]> = [
  [
    'top-level class with one constructor argument',
    'class Slate:\n    def ping(self):\n        return 1\n\ntry:\n    Slate(9) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'top-level class alias with three constructor arguments',
    'class Origin:\n    def ping(self):\n        return 1\n\nOrigin => Alias\ntry:\n    Alias(1, 2, 3) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'class without __init__ returned from a function',
    'def make_slate():\n    class Slate:\n        def ping(self):\n            return 1\n    return Slate\n\nmake_slate() => SlateType\ntry:\n    SlateType(4, 5) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'class without __init__ nested below two functions and then aliased',
    'def outer_scope():\n    def middle_scope():\n        class Cell:\n            def ping(self):\n                return 1\n        return Cell\n    return middle_scope()\n\nouter_scope() => CellType\nCellType => CellAlias\ntry:\n    CellAlias(1, 2, 3) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'class without __init__ defined inside a method of a nested class',
    'def build_factory():\n    class Factory:\n        def make(self):\n            class Payload:\n                def ping(self):\n                    return 1\n            return Payload\n    Factory() => factory\n    return factory\n\nbuild_factory() => factory\nfactory.make() => PayloadType\ntry:\n    PayloadType(7) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
];

const CONTROL_ROWS: Array<[string, string]> = [
  [
    'control: top-level class without __init__ accepts zero arguments',
    'class EmptyTop:\n    def ping(self):\n        return 1\n\nEmptyTop() => value\n"OK"^0\n',
  ],
  [
    'control: nested class without __init__ accepts zero arguments',
    'def make_empty():\n    class EmptyNested:\n        def ping(self):\n            return 1\n    return EmptyNested\n\nmake_empty() => EmptyType\nEmptyType() => value\n"OK"^0\n',
  ],
  [
    'control: the existing no-__init__ guard raises the right exception type',
    'class Guarded:\n    def ping(self):\n        return 1\n\ntry:\n    Guarded(1, 2, 3, 4) => value\n    "NO ERROR"^0\nexcept TypeError:\n    "TypeError"^0\n',
  ],
  [
    'control: explicit __init__ in a nested class uses the full qualifier',
    'def make_record():\n    class Record:\n        def __init__(self, key):\n            key => self.key\n    return Record\n\nmake_record() => RecordType\ntry:\n    RecordType() => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'control: explicit __init__ keeps the definition name through a top-level class alias',
    'class DefinedClass:\n    def __init__(self, key):\n        key => self.key\n\nDefinedClass => RenamedClass\ntry:\n    RenamedClass() => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'control: a regular method on a deeply nested class uses the full qualifier',
    'def outer_builder():\n    def inner_builder():\n        class DeepClass:\n            def method(self, key):\n                return key\n        DeepClass() => value\n        return value\n    return inner_builder()\n\nouter_builder() => value\ntry:\n    value.method() => result\nexcept TypeError as e:\n    str(e)^0\n',
  ],
];

describe('EMLP-AUDIT-005 v3 undisclosed V', () => {
  it('has a real CPython oracle', () => {
    expect(PYTHON).not.toBeNull();
  });

  for (const [label, src] of NO_INIT_MESSAGE_ROWS) {
    it(`V ${label}`, () => {
      expect(interpOutput(src), label).toBe(cpythonOutput(src));
    });
  }

  for (const [label, src] of CONTROL_ROWS) {
    it(label, () => {
      expect(interpOutput(src), label).toBe(cpythonOutput(src));
    });
  }
});
