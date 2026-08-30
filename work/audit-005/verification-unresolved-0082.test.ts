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

function callNames(src: string): string[] {
  const run = interpret(src);
  expect(run.error, src).toBeUndefined();
  expect(run.unsupported, src).toEqual([]);
  return run.events
    .filter((event) => event.type === 'eml:call')
    .map((event) => (typeof event.fn === 'string' ? event.fn : `<missing fn: ${JSON.stringify(event)}>`));
}

const DIFFERENTIAL_ROWS: Array<[string, string]> = [
  [
    'S1 neutral nested function through an alias reports four missing names',
    'def forge_callable():\n    def compute(first, second, third, fourth, fifth):\n        return first\n    return compute\n\nforge_callable() => original_callable\noriginal_callable => routed_callable\ntry:\n    routed_callable(11) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S1 @hot surplus arguments evaluate before the definition-name error and not the body',
    'def hot_probe(value):\n    str(value)^0\n    return value\n\n@hot\ndef hot_origin(item):\n    "BODY"^0\n    return item\n\nhot_origin => hot_route\ntry:\n    hot_route(hot_probe(21), hot_probe(22), hot_probe(23)) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S1 @cold hashable surplus arguments preserve the definition name',
    '@cold\ndef cold_origin(left, right):\n    return left + right\n\ncold_origin => cold_route\ntry:\n    cold_route(1, 2, 3, 4) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S1 @cold hashes an unhashable set before checking surplus arity',
    '@cold\ndef frozen_value(item):\n    return item\n\ntry:\n    frozen_value(1, {2, 3}) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S2 no-__init__ class defined in a method ignores four-argument count in its message',
    'class ParcelFactory:\n    def make(self):\n        class Parcel:\n            def ping(self):\n                return 1\n        return Parcel\n\nParcelFactory() => factory\nfactory.make() => ParcelType\ntry:\n    ParcelType(1, 2, 3, 4) => parcel\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S2 constructor arguments run before the no-__init__ guard',
    'def constructor_probe(value):\n    str(value)^0\n    return value\n\nclass BareEnvelope:\n    def ping(self):\n        return 1\n\ntry:\n    BareEnvelope(constructor_probe(31), constructor_probe(32)) => envelope\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S2 nested no-__init__ class still accepts the correct zero-argument call',
    'def make_empty_type():\n    class EmptyType:\n        def ping(self):\n            return 1\n    return EmptyType\n\nmake_empty_type() => EmptyAlias\nEmptyAlias() => value\n"ZERO-OK"^0\n',
  ],
  [
    'S3 nested method with a receiver named this reports three missing names',
    'def build_engine():\n    class Engine:\n        def run(this, first, second, third, fourth):\n            return first\n    Engine() => engine\n    return engine\n\nbuild_engine() => engine\ntry:\n    engine.run(41) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S3 top-level method surplus count includes its implicit receiver',
    'class Mixer:\n    def mix(owner, item):\n        return item\n\nMixer() => mixer\ntry:\n    mixer.mix(1, 2, 3, 4) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S3 explicit __init__ through a returned nested class and alias keeps qualifier and receiver count',
    'def make_record_type():\n    class Record:\n        def __init__(this, key):\n            key => this.key\n    return Record\n\nmake_record_type() => RecordType\nRecordType => RecordAlias\ntry:\n    RecordAlias(1, 2, 3) => value\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S3 nested __enter__ reports two missing protocol parameters',
    'def make_portal():\n    class Portal:\n        def __enter__(this, token, mode):\n            return token\n        def __exit__(this, kind, value, trace):\n            return 0\n    Portal() => portal\n    return portal\n\nmake_portal() => portal\ntry:\n    with portal as entered:\n        str(entered)^0\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'S3 normal __exit__ reports two missing protocol parameters',
    'class ExitGate:\n    def __enter__(self):\n        return 51\n    def __exit__(self, kind, value, trace, extra, tail):\n        return 0\n\ntry:\n    with ExitGate() as entered:\n        str(entered)^0\nexcept TypeError as e:\n    str(e)^0\n',
  ],
  [
    'right-arity representatives still execute normally',
    'def add_pair(left, right):\n    return left + right\n\nclass RightClass:\n    def __init__(self, value):\n        value => self.value\n    def read(self):\n        return self.value\n\nstr(add_pair(2, 3))^0\nRightClass(7) => item\nstr(item.read())^0\n',
  ],
];

describe('EMLP-AUDIT-005 v4 undisclosed equivalence-class sample', () => {
  it('has a real CPython oracle', () => {
    expect(PYTHON).not.toBeNull();
  });

  for (const [label, src] of DIFFERENTIAL_ROWS) {
    it(label, () => {
      expect(interpOutput(src), label).toBe(cpythonOutput(src));
    });
  }

  it('wrong-arity bound method emits no eml:call', () => {
    const src = 'class QuietMethod:\n    def act(self, value):\n        return value\n\nQuietMethod() => item\ntry:\n    item.act() => value\nexcept TypeError:\n    "T"^0\n';
    expect(callNames(src)).toEqual([]);
  });

  it('wrong-arity explicit __init__ emits no eml:call', () => {
    const src = 'class QuietInit:\n    def __init__(self, value):\n        value => self.value\n\ntry:\n    QuietInit() => item\nexcept TypeError:\n    "T"^0\n';
    expect(callNames(src)).toEqual([]);
  });

  it('wrong-arity nested __enter__ emits no eml:call', () => {
    const src = 'def make_quiet_context():\n    class QuietContext:\n        def __enter__(self, value):\n            return value\n        def __exit__(self, kind, value, trace):\n            return 0\n    QuietContext() => context\n    return context\n\nmake_quiet_context() => context\ntry:\n    with context as value:\n        str(value)^0\nexcept TypeError:\n    "T"^0\n';
    expect(callNames(src)).toEqual(['make_quiet_context']);
  });

  it('wrong-arity __exit__ records only the preceding __enter__', () => {
    const src = 'class QuietExit:\n    def __enter__(self):\n        return 1\n    def __exit__(self, kind, value, trace, extra):\n        return 0\n\ntry:\n    with QuietExit() as value:\n        str(value)^0\nexcept TypeError:\n    "T"^0\n';
    expect(callNames(src)).toEqual(['QuietExit.__enter__']);
  });

  it('wrong-arity @cold hashable call emits no eml:call', () => {
    const src = '@cold\ndef quiet_cold(left, right):\n    return left + right\n\ntry:\n    quiet_cold(1) => value\nexcept TypeError:\n    "T"^0\n';
    expect(callNames(src)).toEqual([]);
  });

  it('right-arity method emits its qualified call exactly once', () => {
    const src = 'class LoudMethod:\n    def act(self, value):\n        return value\n\nLoudMethod() => item\nstr(item.act(61))^0\n';
    expect(callNames(src)).toEqual(['LoudMethod.act']);
  });

  it('right-arity with emits enter then exit', () => {
    const src = 'class LoudContext:\n    def __enter__(self):\n        return 1\n    def __exit__(self, kind, value, trace):\n        return 0\n\nwith LoudContext() as value:\n    str(value)^0\n';
    expect(callNames(src)).toEqual(['LoudContext.__enter__', 'LoudContext.__exit__']);
  });
});
