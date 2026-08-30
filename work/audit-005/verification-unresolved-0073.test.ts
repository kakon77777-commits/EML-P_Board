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

function cpythonMessage(src: string): string {
  const py = transpileEmlToPython(src).python;
  const run = spawnSync(PYTHON!, ['-c', py], { encoding: 'utf8' });
  const last = (run.stderr ?? '').trim().split(/\r?\n/).pop() ?? '';
  return last.replace(/^\w+(\.\w+)*:\s*/, '');
}

function interpMessage(src: string): string {
  return interpret(src).error?.message ?? '(no error)';
}

const NESTED_CLASS_ROWS: Array<[string, string]> = [
  [
    'method on a class defined inside a function keeps the lexical class qualname',
    'def make_vault():\n    class Vault:\n        def open(self, key):\n            return key\n    Vault() => box\n    return box\n\nmake_vault() => box\nbox.open() => result\n',
  ],
  [
    '__init__ on a returned nested class keeps the lexical class qualname',
    'def make_token():\n    class Token:\n        def __init__(self, value):\n            pass\n    return Token\n\nmake_token() => TokenFactory\nTokenFactory() => token\n',
  ],
  [
    '__enter__ on a nested context-manager class keeps the lexical class qualname',
    'def make_context():\n    class Context:\n        def __enter__(self, marker):\n            return marker\n        def __exit__(self, a, b, c):\n            return 0\n    return Context\n\nmake_context() => ContextFactory\nContextFactory() => ctx\nwith ctx as value:\n    "BODY"^0\n',
  ],
  [
    'a function nested in a method retains the enclosing nested-class prefix',
    'def build_worker():\n    class Worker:\n        def produce(self):\n            def task(left, right):\n                return left + right\n            return task\n    Worker() => worker\n    return worker\n\nbuild_worker() => worker\nworker.produce() => job\njob(1) => result\n',
  ],
  [
    'a class nested under two functions retains both lexical prefixes',
    'def outer_scope():\n    def middle_scope():\n        class Cell:\n            def read(self, index):\n                return index\n        Cell() => cell\n        return cell\n    return middle_scope()\n\nouter_scope() => cell\ncell.read() => value\n',
  ],
];

const CONTROL_ROWS: Array<[string, string]> = [
  [
    'control: a two-hop alias still reports the top-level definition name',
    'def source_fn(left, right):\n    return left\n\nsource_fn => first_hop\nfirst_hop => final_hop\nfinal_hop(1) => value\n',
  ],
  [
    'control: a two-hop alias still reports a nested function qualname',
    'def forge_fn():\n    def product_fn(a, b, c):\n        return a\n    return product_fn\n\nforge_fn() => first_hop\nfirst_hop => final_hop\nfinal_hop(1) => value\n',
  ],
  [
    'control: @cold hashes a surplus dict before checking arity',
    '@cold\ndef memo_dict(value):\n    return value\n\nmemo_dict(1, {"key": 2}) => value\n',
  ],
  [
    'control: @cold plus alias plus hashable surplus args reports the definition name',
    '@cold\ndef memo_origin(value):\n    return value\n\nmemo_origin => memo_alias\nmemo_alias(1, 2) => value\n',
  ],
  [
    'control: a nested function in a top-level class method gets the class-method prefix',
    'class Factory:\n    def make(self):\n        def inner_fn(left, right):\n            return left\n        return inner_fn\n\nFactory() => factory\nfactory.make() => inner_alias\ninner_alias(1) => value\n',
  ],
  [
    'control: three lexical function levels retain the full qualname',
    'def level_one():\n    def level_two():\n        def level_three(left, right):\n            return left\n        return level_three\n    return level_two()\n\nlevel_one() => deep_fn\ndeep_fn(1) => value\n',
  ],
  [
    'control: aliasing a top-level class does not rename its method definition',
    'class OriginalClass:\n    def method(self, value):\n        return value\n\nOriginalClass => ClassAlias\nClassAlias() => instance\ninstance.method() => value\n',
  ],
];

describe('EMLP-AUDIT-005 v2 undisclosed V', () => {
  it('has a real CPython oracle', () => {
    expect(PYTHON).not.toBeNull();
  });

  for (const [label, src] of NESTED_CLASS_ROWS) {
    it(`V ${label}`, () => {
      expect(interpMessage(src), label).toBe(cpythonMessage(src));
    });
  }

  for (const [label, src] of CONTROL_ROWS) {
    it(label, () => {
      expect(interpMessage(src), label).toBe(cpythonMessage(src));
    });
  }
});
