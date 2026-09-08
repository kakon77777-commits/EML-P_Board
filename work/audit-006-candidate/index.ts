/**
 * @eml/interp — a deterministic, browser-safe interpreter for the EML supported
 * subset that doubles as an EML `eml-trace-v1` trace producer (a frozen
 * compatibility wire-format id, not an external runtime dependency).
 *
 * WHY THIS EXISTS (the iron rule: "trace is the execution-truth layer, not
 * decorative UI"): the EML Workbench runs in the browser and cannot launch
 * Python, yet the whitepaper's workbench vision (§13.1) is "open → type EML →
 * see Python → EXECUTE → trace → explain". So we compute the program's REAL
 * values here, faithfully to CPython (see `values.ts`), and emit a trace as we
 * go. Faithfulness is not asserted, it is *gated*: `tests/interp.test.ts` runs
 * every runnable example through BOTH this interpreter and a real `python` and
 * fails if stdout differs. The CLI `eml trace` bakes that same equivalence check
 * into each artifact as an `eml:equiv` event. The interpreter never replaces the
 * transpiler — Python remains the execution target; this is a second, validated
 * implementation purely so a trace can exist without a runtime.
 *
 * Constructs a faithful interpreter cannot reproduce — numpy matrices (`<M>` /
 * `^T`) and asyncio temporal loops (`async`/`await`/`@temporal_loop`) — are not
 * executed: the interpreter records an `eml:unsupported` event and stops cleanly
 * (the CLI defers those programs to a real Python run). This module has zero node
 * imports; the only dependency that touches the filesystem (`@eml/trace/node`)
 * is never imported here.
 */
import type {
  Program,
  Statement,
  Expression,
  FunctionDef,
  AssignTarget,
  ExceptHandler,
  ClassDef,
  Diagnostic,
} from '@eml/types';
import { transpileEmlToPython } from '@eml/transpiler-python';
import { createEmitter, findAnomalies, type Emitter, type TraceEvent } from '@eml/trace';
import {
  type PyVal,
  PyError,
  INT,
  FLOAT,
  STR,
  BOOL,
  NONE,
  LIST,
  TUPLE,
  DICT,
  SET,
  canonicalKey,
  arith,
  pySum,
  power,
  compare,
  contains,
  truthy,
  pyStr,
  pyRepr,
  typeName,
  isHashable,
  percentFormat,
  EXC_CLASS,
  EXCEPTION,
  BUILTIN_EXCEPTIONS,
  parsePyInt,
  parsePyFloat,
  iterableItems,
  rendersSetOrder,
} from './values';

export { type PyVal, PyError } from './values';

export interface InterpOptions {
  /** Injectable clock for deterministic traces; defaults to wall-clock ISO-8601. */
  now?: () => string;
  /** Stream id stamped on every event (default 'eml'). */
  stream?: string;
  /** Source file label for the `eml:run:start` event. */
  file?: string;
  /** Hard cap on evaluation steps (loop iterations + calls) to bound the browser. */
  maxSteps?: number;
  /** Reuse an emitter (e.g. to fan trace events to a live sink); created if absent. */
  emitter?: Emitter;
}

export interface InterpResult {
  /** True iff the program ran to completion without a runtime error or an unsupported abort. */
  ok: boolean;
  /** Concatenated stdout, exactly as the transpiled Python's `print()` would produce it. */
  output: string;
  /** stdout split into lines (no trailing empty element). */
  outputLines: string[];
  /** The eml-trace-v1 event stream. */
  events: TraceEvent[];
  /** Runtime error (Python exception class + message), if execution faulted. */
  error?: { type: string; message: string };
  /** Constructs that prevented full execution (numpy / temporal). */
  unsupported: string[];
  /** Error-severity transpile diagnostics, if the program did not compile. */
  diagnostics: Diagnostic[];
}

const DEFAULT_MAX_STEPS = 5_000_000;
const RECURSION_LIMIT = 1000;

/** Signal used to unwind a `return` out of a function body. */
class ReturnSignal {
  constructor(public readonly value: PyVal) {}
}
/** Signal raised when a construct cannot be faithfully interpreted. */
class Unsupported {
  constructor(
    public readonly construct: string,
    public readonly reason: string,
  ) {}
}
/** Signal raised when the step budget is exhausted (browser safety). */
class StepLimit {
  constructor(public readonly steps: number) {}
}
/** Signals used to unwind `break`/`continue` to the nearest enclosing loop
 *  (caught in `execStmt`'s While/ForIn cases, NOT at the function-call boundary
 *  like ReturnSignal — must not escape past the loop). */
class BreakSignal {}
class ContinueSignal {}

interface Scope {
  vars: Map<string, PyVal>;
  parent?: Scope;
  /**
   * Names that are statically local to this (function) frame — assigned somewhere
   * in the body. Reading one before it is bound is an UnboundLocalError, and it
   * must NOT fall through to an enclosing/module binding (Python's rule).
   */
  locals?: Set<string>;
}

/** Interpret EML source: transpile to resolve the AST, then execute. */
export function interpret(source: string, opts: InterpOptions = {}): InterpResult {
  const transpiled = transpileEmlToPython(source);
  const errors = transpiled.diagnostics.filter((d) => d.severity === 'error');
  const emitter = opts.emitter ?? createEmitter({ stream: opts.stream ?? 'eml', now: opts.now });

  if (errors.length > 0) {
    emitter.emit('eml:compile:error', { count: errors.length, codes: errors.map((d) => d.code) });
    return {
      ok: false,
      output: '',
      outputLines: [],
      events: [...emitter.events],
      unsupported: [],
      diagnostics: errors,
    };
  }
  return runProgram(transpiled.ast, emitter, opts, errors);
}

/** Execute an already-resolved program (every OverlayAssign rewritten). */
export function interpretProgram(program: Program, opts: InterpOptions = {}): InterpResult {
  const emitter = opts.emitter ?? createEmitter({ stream: opts.stream ?? 'eml', now: opts.now });
  return runProgram(program, emitter, opts, []);
}

/**
 * CPython's positional-arity TypeError, message and all, or `undefined` when
 * the count is right.
 *
 * `given` is the number of arguments the call actually delivers, which for a
 * bound method INCLUDES the receiver the caller never wrote, and `params` is
 * every declared parameter including the receiver. v1 of this fix instead
 * passed the receiver separately and derived whether there was one from
 * `selfParam ? 1 : 0` — from whether the method DECLARED a first parameter.
 * A bound call always passes the instance, so a method declaring none is
 * exactly the case that should report 0 taken and 1 given, and v1 reported no
 * error at all; the same slip undercounted every method message by one.
 *
 * Five message details were measured against CPython 3.14 rather than
 * recalled: the count and the noun pluralise independently; two missing names
 * join with `and` while three or more take an Oxford comma; the label is the
 * function's own qualified name; and a method's counts include the receiver.
 *
 * An exact length comparison is safe because EML parameters are plain
 * identifiers — the grammar parses `params` as `Identifier[]` with no
 * defaults, no `*args` and no `**kwargs` — so no legal call shape can have a
 * count that differs from its parameter list.
 */
function arityError(
  label: string,
  params: FunctionDef['params'],
  given: number,
): PyError | undefined {
  if (given === params.length) return undefined;
  if (given < params.length) {
    const missing = params.slice(given).map((p) => `'${p.name}'`);
    const names =
      missing.length === 1
        ? missing[0]!
        : missing.length === 2
          ? `${missing[0]} and ${missing[1]}`
          : `${missing.slice(0, -1).join(', ')}, and ${missing[missing.length - 1]}`;
    return new PyError(
      'TypeError',
      `${label}() missing ${missing.length} required positional argument${
        missing.length === 1 ? '' : 's'
      }: ${names}`,
    );
  }
  return new PyError(
    'TypeError',
    `${label}() takes ${params.length} positional argument${params.length === 1 ? '' : 's'} but ${given} ${
      given === 1 ? 'was' : 'were'
    } given`,
  );
}

function runProgram(
  program: Program,
  emitter: Emitter,
  opts: InterpOptions,
  diagnostics: Diagnostic[],
): InterpResult {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const out: string[] = [];
  const unsupported: string[] = [];
  const module: Scope = { vars: new Map() };
  // `True`/`False`/`None` lex as plain identifiers (Python keywords, but EML
  // never reserves them) — the emitter passes them through unchanged since
  // real Python already binds them, but this interpreter has its own scope
  // and never pre-declared them, so a bare literal reference (as opposed to
  // one produced by a comparison/`and`/`or`) threw a spurious NameError.
  module.vars.set('True', BOOL(true));
  module.vars.set('False', BOOL(false));
  module.vars.set('None', NONE);
  // Exception classes are VALUES, so `except ... as e` can hand back something
  // comparable (`exc_type == ValueError`) and `raise e` can re-raise it. They
  // used to exist only as bare names the parser special-cased, which is why
  // `__exit__`'s first argument arrived as a string.
  for (const name of BUILTIN_EXCEPTIONS) module.vars.set(name, EXC_CLASS(name));
  /** functools.cache emulation for @cold (non-async) functions, keyed by repr(args). */
  const coldCache = new Map<string, PyVal>();

  /**
   * FunctionDef node -> the qualified name CPython would put in an error.
   *
   * Filled where the `def` EXECUTES, because that is the only moment the
   * enclosing function is known: `outer.<locals>.inner` is a fact about where
   * the definition ran, not about where the call happens. Keyed by the AST node
   * so re-entering `outer` recomputes the same string, and so no new field has
   * to be added to the func value in values.ts.
   *
   * v1 of this fix used the CALL-SITE identifier instead, which is wrong twice
   * over: `original => alias; alias()` reported `alias()` where CPython reports
   * `original()`, and a nested function reported `inner()` where CPython
   * reports `outer.<locals>.inner()`. Both were published as matching CPython
   * exactly, on the strength of seven message rows that were all top-level
   * direct calls.
   */
  const qualnames = new Map<FunctionDef, string>();
  /**
   * ClassDef node -> its qualified name, recorded the same way and for the
   * same reason.
   *
   * v2 recorded a qualifier only where a `def` executes. A class body's
   * methods never reach that branch — `ClassDef` binds the class and the
   * method nodes are looked up later — so `instance.className` stayed the
   * bare `cls.name` and a nested class lost its enclosing `<locals>` prefix
   * permanently, taking every function defined inside its methods with it.
   *
   * Which is the same shape v1 and v2 were each caught by, one level out: a
   * fact recorded where ONE kind of definition executes, and a second kind
   * that never passes through there. v1 read identity off the call site, v2
   * off the `def`; it has to come from whichever definition actually ran.
   */
  const classQualnames = new Map<ClassDef, string>();
  /** Enclosing function qualnames, innermost last, while a body is running. */
  const qualStack: string[] = [];
  let steps = 0;
  let depth = 0;
  let error: InterpResult['error'];
  /** The exception currently being handled by an `except` block, for a bare
   *  `raise` re-raise (Phase 7d). Saved/restored around each handler so nested
   *  try/except blocks don't clobber an outer one's in-flight exception. */
  let currentException: PyError | undefined;

  /** Rendering a multi-element SET to text exposes an iteration order this
   *  interpreter cannot reproduce (CPython uses hash order, we use insertion
   *  order). Iterating one already defers; printing one is the same hazard
   *  through a different door, so it defers too rather than emitting a line
   *  that differs from the program's own Python projection. */
  const guardSetOrder = (v: PyVal, where: string): void => {
    if (rendersSetOrder(v)) {
      throw new Unsupported(
        `${where} on a set with more than one element`,
        'CPython prints a set in hash order, which this interpreter cannot reproduce - report len(), membership, or build a list in an order your program chooses',
      );
    }
  };

  const tick = (): void => {
    if (++steps > maxSteps) throw new StepLimit(steps);
  };

  const write = (text: string, end = '\n'): void => {
    out.push(text + end);
    // `end` is part of the event, not just of `out`. Without it the trace
    // cannot reconstruct what the program printed: `^0("")` writes one line
    // and a trace carrying only `text` claims two. Every consumer of a trace -
    // the workbench panel, the committed goldens, any replay - reads the
    // reconstruction, so an event that drops it is a record of a different
    // program. Found by tests/trace-completeness.test.ts.
    emitter.emit('eml:output', { text, end });
  };

  // ── Expression evaluation ──────────────────────────────────────────────────
  const evalExpr = (expr: Expression, scope: Scope): PyVal => {
    switch (expr.type) {
      case 'NumberLiteral':
        // A literal is an int unless it carries a '.' / exponent (matches lexer).
        return /[.eE]/.test(expr.raw) ? FLOAT(expr.value) : INT(BigInt(expr.raw));
      case 'StringLiteral':
        return STR(expr.value);
      case 'Identifier': {
        // Functions are first-class values bound in their defining scope (see the
        // FunctionDef case), so a plain name lookup resolves them — including a
        // function passed as an argument (e.g. `run_temporal(wait_ready, …)`).
        const v = readVar(scope, expr.name);
        if (v !== undefined) return v;
        throw new PyError('NameError', `name '${expr.name}' is not defined`);
      }
      case 'Power': {
        const base = evalExpr(expr.base, scope);
        const exp = evalExpr(expr.exponent, scope);
        // CPython returns a COMPLEX for a negative base ** non-integer exponent;
        // we have no complex type, so defer rather than emit a fabricated 'nan'.
        const negBase =
          (base.k === 'int' && base.v < 0n) || (base.k === 'float' && base.v < 0);
        if (negBase && exp.k === 'float' && !Number.isInteger(exp.v)) {
          throw new Unsupported(
            'complex power',
            'negative base ** non-integer exponent yields a complex number (real Python only)',
          );
        }
        return power(base, exp);
      }
      case 'Binary': {
        const left = evalExpr(expr.left, scope);
        const right = evalExpr(expr.right, scope);
        // `%` on a string is Python's printf-style string-formatting operator
        // (`"%s" % (a, b)`), not numeric modulo — a tuple right-hand side
        // supplies multiple substitution values in order; anything else is
        // treated as the single value (verified against real Python: `'%s' %
        // 5` and `'%s' % (5,)` are identical). Phase 9 item 3a.
        if (expr.op === '%' && left.k === 'str') {
          const args = right.k === 'tuple' ? right.v : [right];
          // CPython skips the "not all arguments converted" check whenever the
          // right operand is MAPPING-LIKE — which its `PyMapping_Check` says of
          // a LIST as well as a dict, since a list has `__getitem__`. So
          // `"ab" % [1, 2]` is "ab" while `"ab" % 5` raises, a distinction that
          // looks arbitrary until you see it is about the type's protocol
          // rather than its role. Verified against 3.14, not reasoned out.
          const mappingLike = right.k === 'dict' || right.k === 'list';
          return STR(percentFormat(left.v, args, mappingLike));
        }
        if (expr.op === '%' && right.k === 'str') {
          // Left isn't a string but right is — a genuine cross-type TypeError
          // in real Python (`5 % 'x'`), verified directly, not `arith()`'s own
          // generic (and here, wrong) numeric-only message.
          throw new PyError('TypeError', `unsupported operand type(s) for %: '${typeName(left)}' and 'str'`);
        }
        return arith(expr.op, left, right);
      }
      case 'Comparison':
        return compare(expr.op, evalExpr(expr.left, scope), evalExpr(expr.right, scope));
      case 'Logical': {
        // Short-circuit: Python's `and`/`or` return an OPERAND, not always a
        // bool, and the right side is never evaluated unless needed.
        const left = evalExpr(expr.left, scope);
        if (expr.op === 'and') return truthy(left) ? evalExpr(expr.right, scope) : left;
        return truthy(left) ? left : evalExpr(expr.right, scope);
      }
      case 'Not':
        // Unlike `and`/`or`, `not` always returns a real bool.
        return BOOL(!truthy(evalExpr(expr.operand, scope)));
      case 'Conditional':
        return truthy(evalExpr(expr.test, scope))
          ? evalExpr(expr.consequent, scope)
          : evalExpr(expr.alternate, scope);
      case 'List':
        return LIST(expr.elements.map((e) => evalExpr(e, scope)));
      case 'Tuple':
        return TUPLE(expr.elements.map((e) => evalExpr(e, scope)));
      case 'Membership':
        return contains(evalExpr(expr.element, scope), evalExpr(expr.collection, scope));
      case 'Range':
        return LIST(rangeInts(expr, scope));
      case 'Sum':
        return evalSum(expr, scope);
      case 'ListComp':
        return evalListComp(expr, scope);
      case 'Call':
        return evalCall(expr, scope);
      case 'Matrix':
        throw new Unsupported('<M> matrix', 'numpy arrays run only under a real Python runtime');
      case 'Transpose':
        throw new Unsupported('^T transpose', 'numpy transpose runs only under a real Python runtime');
      case 'Await':
        throw new Unsupported('await', 'asyncio temporal loops run only under a real Python runtime');
      case 'Dict':
        return DICT(expr.entries.map((e) => ({ key: evalExpr(e.key, scope), value: evalExpr(e.value, scope) })));
      case 'Set':
        return SET(expr.elements.map((e) => evalExpr(e, scope)));
      case 'Subscript': {
        const obj = evalExpr(expr.object, scope);
        if (expr.index.type === 'Slice') {
          const start = expr.index.start ? evalExpr(expr.index.start, scope) : undefined;
          const stop = expr.index.stop ? evalExpr(expr.index.stop, scope) : undefined;
          return sliceGet(obj, start, stop);
        }
        return subscriptGet(obj, evalExpr(expr.index, scope));
      }
      case 'Slice':
        // Only ever meaningful as a Subscript's `index` (intercepted above before
        // falling through to a bare evalExpr call) — reaching this case bare would
        // be an EML-internal invariant violation, not a modeled Python error.
        throw new Error('internal error: bare Slice expression outside Subscript');
      case 'Attribute': {
        // A bare Identifier object may be an unbound module name (`math`) —
        // resolve via readVar (never throws) rather than evalExpr, so that
        // case still defers as Unsupported exactly as before Phase 7e. Any
        // other object shape (Subscript, Call, nested Attribute, ...) is
        // evaluated normally; if it turns out to be a real instance
        // (Phase 7e), read from its attrs — otherwise defer.
        const objVal = expr.object.type === 'Identifier' ? readVar(scope, expr.object.name) : evalExpr(expr.object, scope);
        if (objVal !== undefined && objVal.k === 'instance') {
          // Instance dict first, then the class dict — Python's shadowing
          // rule. `a.tag = ...` writes only to the instance, so after it the
          // class-level value is hidden for THAT object and still visible
          // from every other one.
          const v = objVal.attrs.has(expr.attr)
            ? objVal.attrs.get(expr.attr)
            : classAttrs(objVal).get(expr.attr);
          if (v === undefined) {
            throw new PyError('AttributeError', `'${objVal.className}' object has no attribute '${expr.attr}'`);
          }
          return v;
        }
        if (objVal !== undefined && objVal.k === 'class') {
          const v = objVal.attrs.get(expr.attr);
          if (v === undefined) {
            throw new PyError('AttributeError', `type object '${objVal.name}' has no attribute '${expr.attr}'`);
          }
          return v;
        }
        const objLabel = expr.object.type === 'Identifier' ? expr.object.name : 'value';
        throw new Unsupported(
          `read .${expr.attr}`,
          `attribute access on '${objLabel}' runs only under a real Python runtime (not modeled by the interpreter yet)`,
        );
      }
    }
  };

  /** Read an `AssignTarget` for an augmented-assign's current value (Phase 7b/7c). */
  const readTarget = (target: AssignTarget, scope: Scope): PyVal => {
    if (target.type === 'Identifier') {
      const v = readVar(scope, target.name);
      if (v === undefined) throw new PyError('NameError', `name '${target.name}' is not defined`);
      return v;
    }
    if (target.type === 'Subscript') {
      const obj = evalExpr(target.object, scope);
      if (target.index.type === 'Slice') {
        const start = target.index.start ? evalExpr(target.index.start, scope) : undefined;
        const stop = target.index.stop ? evalExpr(target.index.stop, scope) : undefined;
        return sliceGet(obj, start, stop);
      }
      return subscriptGet(obj, evalExpr(target.index, scope));
    }
    // Attribute target read (part of `+=` etc.) — same defer as evalExpr's Attribute case.
    return evalExpr(target, scope);
  };

  /** Write an `AssignTarget` (Phase 7b: Subscript; Phase 7c: Attribute). */
  const writeTarget = (target: AssignTarget, value: PyVal, scope: Scope): void => {
    if (target.type === 'Identifier') {
      assign(scope, target.name, value);
      return;
    }
    if (target.type === 'Subscript') {
      if (target.index.type === 'Slice') {
        // Real Python supports slice assignment (splicing an iterable into a
        // sub-range) — genuinely valid, just not modeled by this interpreter
        // (no corpus evidence needs it). Defer rather than silently misinterpreting
        // the Slice as a plain index.
        throw new Unsupported(
          'slice assignment',
          'obj[a:b] = ... runs only under a real Python runtime (not modeled by the interpreter yet)',
        );
      }
      subscriptSet(evalExpr(target.object, scope), evalExpr(target.index, scope), value);
      return;
    }
    // Attribute target write (`self.x = v` / `obj.x = v`, Phase 7e). Same
    // module-name leniency as evalExpr's Attribute case: a bare Identifier
    // object resolves via readVar (never throws), so an unbound module name
    // still defers as Unsupported rather than crashing with a NameError.
    const objVal = target.object.type === 'Identifier' ? readVar(scope, target.object.name) : evalExpr(target.object, scope);
    if (objVal !== undefined && objVal.k === 'class') {
      // `Thermostat.target = 18` — rebinding the class-level default. Every
      // instance that never shadowed it sees the new value immediately,
      // because instances hold a reference to this same Map rather than a
      // copy. Reading class attributes landed before this did, which meant a
      // program could observe the fallback and not change it; the trace said
      // so honestly ("interp deferred: write .target") instead of guessing,
      // and that deferral is what surfaced the missing half.
      objVal.attrs.set(target.attr, value);
      emitter.emit('eml:assign', { target: `${objVal.name}.${target.attr}`, value: pyRepr(value) });
      return;
    }
    if (objVal !== undefined && objVal.k === 'instance') {
      objVal.attrs.set(target.attr, value);
      return;
    }
    const objLabel = target.object.type === 'Identifier' ? target.object.name : 'value';
    throw new Unsupported(
      `write .${target.attr}`,
      `attribute assignment on '${objLabel}' runs only under a real Python runtime (not modeled by the interpreter yet)`,
    );
  };

  /** Materialize an inclusive/exclusive integer range to a list of ints. */
  const rangeInts = (
    expr: Extract<Expression, { type: 'Range' }>,
    scope: Scope,
  ): PyVal[] => {
    // Python range() accepts int and bool (bool is an int subtype) but not float.
    const toIdx = (v: PyVal): bigint => {
      if (v.k === 'int') return v.v;
      if (v.k === 'bool') return v.v ? 1n : 0n;
      throw new PyError('TypeError', `'${typeName(v)}' object cannot be interpreted as an integer`);
    };
    const start = toIdx(evalExpr(expr.start, scope));
    const endN = toIdx(evalExpr(expr.end, scope));
    const stop = expr.inclusiveEnd ? endN + 1n : endN; // EML [a:b] is inclusive
    const items: PyVal[] = [];
    for (let i = start; i < stop; i++) {
      tick();
      items.push(INT(i));
    }
    return items;
  };

  /**
   * Materialize a `for ... in <iterable>` target into concrete items.
   *
   * Deliberately NOT the shared `iterableItems` from values.ts, because a loop
   * observes ORDER and the order-invariant builtins do not:
   *
   *   dict — Python guarantees insertion order, and our Map preserves it, so
   *          iterating keys is exactly right.
   *   set  — Python iterates in HASH order, not insertion order. `{3, 1, 2}`
   *          yields 1, 2, 3 in CPython and would yield 3, 1, 2 here. Producing
   *          our own order would be a silent wrong answer, so this defers to
   *          real Python instead of inventing a sequence. (`len`/`sum`/`min`/
   *          `max` over a set are still fine — their answers don't depend on
   *          the order.)
   */
  const forInItems = (v: PyVal): PyVal[] => {
    if (v.k === 'set') {
      throw new Unsupported(
        'iterating a set',
        'CPython iterates a set in hash order, which this interpreter cannot reproduce — build the values as a list literal if you need to iterate them in a defined order',
      );
    }
    const items = iterableItems(v);
    if (!items) throw new PyError('TypeError', `'${typeName(v)}' object is not iterable`);
    return items;
  };

  const evalSum = (expr: Extract<Expression, { type: 'Sum' }>, scope: Scope): PyVal => {
    const items = rangeInts(expr.range, scope);
    // Delegated to `pySum` rather than folded with `arith('+')` here: `Σ` projects onto
    // CPython's `sum(...)`, whose float accumulation is compensated. See pySum's comment.
    const summands = function* (): Generator<PyVal> {
      for (const item of items) {
        tick();
        const iterScope: Scope = { vars: new Map([[expr.iterator.name, item]]), parent: scope };
        yield evalExpr(expr.expr, iterScope);
      }
    };
    const acc = pySum(summands(), INT(0n)); // Python sum() starts at int 0
    emitter.emit('eml:sum', {
      iterator: expr.iterator.name,
      count: items.length,
      result: pyRepr(acc),
    });
    return acc;
  };

  /** `[expr for x in iterable if cond]` (Phase 9) — mirrors `evalSum` but reuses
   *  `forInItems()` (the ORDER-observing iterator, since a comprehension builds a
   *  list whose element order is part of the answer) and collects into a list
   *  instead of summing, with an optional filter. */
  const evalListComp = (expr: Extract<Expression, { type: 'ListComp' }>, scope: Scope): PyVal => {
    const items = forInItems(evalExpr(expr.iterable, scope));
    const result: PyVal[] = [];
    for (const item of items) {
      tick();
      const iterScope: Scope = { vars: new Map([[expr.iterator.name, item]]), parent: scope };
      // Record the binding, exactly as the equivalent `for` loop does. Without
      // this a comprehension executes invisibly: `[i for i in [1:1000]] => xs`
      // produced the same trace as `[] => xs`, so rewriting a loop as a
      // comprehension silently deleted the work from the record. Found by
      // tests/trace-completeness.test.ts.
      emitter.emit('eml:assign', { name: expr.iterator.name, value: pyRepr(item), declares: false });
      if (expr.condition && !truthy(evalExpr(expr.condition, iterScope))) continue;
      result.push(evalExpr(expr.expr, iterScope));
    }
    return LIST(result);
  };

  const evalCall = (expr: Extract<Expression, { type: 'Call' }>, scope: Scope): PyVal => {
    if (expr.callee.type === 'Attribute') {
      // Same module-name leniency as evalExpr's Attribute case: resolve a
      // bare Identifier object via readVar (never throws), so an unbound
      // module name (`math.sqrt(x)`) still defers as Unsupported rather than
      // crashing with a NameError. If the object turns out to be a real
      // instance (Phase 7e), dispatch to its method — otherwise defer
      // (module calls / built-in container methods are real, correct Python
      // once emitted; the interpreter just doesn't model those yet).
      const objExpr = expr.callee.object;
      const objVal = objExpr.type === 'Identifier' ? readVar(scope, objExpr.name) : evalExpr(objExpr, scope);
      if (objVal !== undefined && objVal.k === 'instance') {
        return callMethod(objVal, expr.callee.attr, expr.args.map((a) => evalExpr(a, scope)));
      }
      const objLabel = objExpr.type === 'Identifier' ? objExpr.name : 'value';
      throw new Unsupported(
        `call ${objLabel}.${expr.callee.attr}()`,
        'attribute/method calls run only under a real Python runtime (not modeled by the interpreter yet)',
      );
    }
    const name = expr.callee.name;
    const args = expr.args.map((a) => evalExpr(a, scope));
    // Resolve the callee by lexical lookup (functions are values in their defining
    // scope), falling back to a supported builtin when the name is unbound.
    const callee = readVar(scope, name);
    if (callee === undefined) return callBuiltin(name, args);
    if (callee.k === 'class') return instantiateClass(callee, args);
    // `ValueError("boom")` constructs an exception VALUE. It reaches here now
    // that the class names are bound in the root scope; `raise` used to
    // special-case this shape in its own statement handler because there was
    // nothing for the expression to evaluate to.
    if (callee.k === 'exc_class') {
      return EXCEPTION(new PyError(callee.name, args.length > 0 ? pyStr(args[0]!) : ''));
    }
    if (callee.k !== 'func' || callee.def === undefined) {
      throw new PyError('TypeError', `'${typeName(callee)}' object is not callable`);
    }
    const fn = callee.def as FunctionDef;
    if (fn.isAsync) throw new Unsupported('async function', `'${name}' is async (temporal runtime only)`);

    // The label is the function's own qualified name, not the identifier this
    // call site used — see `qualnames` above.
    const arity = arityError(qualnames.get(fn) ?? callee.name, fn.params, args.length);
    // WHERE this is raised depends on @cold, and v1 had it backwards.
    //
    // v1 threw here, above the cache, with a comment asserting that CPython
    // rejects the arity in the call machinery before any cache is consulted.
    // Measured against CPython 3.14: `@cache def f(x)` called `f(1, [2])`
    // raises `unhashable type: 'list'`, because functools builds its key from
    // the arguments FIRST and the wrapped function's signature is only reached
    // on the miss after it. The same function undecorated raises the arity
    // error. v1 turned the first into the second — a defect the baseline did
    // not have, which is why it was caught as a regression rather than a miss.
    //
    // So an undecorated or @hot function rejects here, above `eml:call` and
    // above the body; a @cold one hashes first and rejects below.
    if (arity && fn.temperature !== 'cold') throw arity;

    // @cold non-async functions are emitted with @functools.cache; emulate it so
    // the trace (and any side effects like prints) match Python exactly: a cache
    // hit does NOT re-run the body.
    const cacheable = fn.temperature === 'cold';
    let key = '';
    if (cacheable) {
      // functools.cache requires hashable args; a list arg raises at call time.
      const bad = args.find((a) => !isHashable(a));
      if (bad) throw new PyError('TypeError', `unhashable type: '${typeName(bad)}'`);
      // functools' key, not a repr of the arguments. `pyRepr` was wrong twice:
      //   - Equal-but-differently-typed arguments share one entry, exactly as
      //     dict keys do (1, 1.0 and True are one key). `canonicalKey` already
      //     models that; repr does not, so True missed 1.0's entry here while
      //     CPython hit it.
      //   - `_make_key` has a fast path: a single argument whose type is
      //     exactly int or str becomes the key itself instead of a tuple, and a
      //     bare int never compares equal to a 1-tuple. So with ONE argument
      //     f(1) is a separate entry from f(1.0) and f(True), while with two
      //     arguments all three collide. The '#1:'/'#n:' prefixes below keep
      //     those two key spaces apart, reproducing the split.
      // Verified against CPython 3.14; examples/cold-cache-key-identity exists
      // to pin exactly this, and is what caught the repr version.
      const fastPath = args.length === 1 && (args[0]!.k === 'int' || args[0]!.k === 'str');
      key = `${name}${fastPath ? '#1:' : '#n:'}${args.map(canonicalKey).join(',')}`;
      if (coldCache.has(key)) {
        const cached = coldCache.get(key)!;
        emitter.emit('eml:cache:hit', { fn: name, args: args.map(pyRepr), result: pyRepr(cached) });
        return cached;
      }
      // The @cold arity rejection, in functools' order: the key was built (so
      // an unhashable argument has already raised above) and the lookup missed,
      // which is the point at which the wrapper calls through to the function
      // and its signature is checked. Still above `eml:call` and the body.
      if (arity) throw arity;
    }

    if (++depth > RECURSION_LIMIT) {
      depth--;
      throw new PyError('RecursionError', 'maximum recursion depth exceeded');
    }
    tick();
    emitter.emit('eml:call', { fn: name, args: args.map(pyRepr), temperature: fn.temperature ?? 'neutral' });
    // Lexical scoping: free variables resolve through the function's DEFINING
    // scope (its closure), not the caller's. Python also computes binding scope
    // statically — a name assigned anywhere in the body is local for the WHOLE
    // body, so a read before assignment is an UnboundLocalError (it must not see
    // an enclosing/module binding). Seed `locals` with those names.
    const local: Scope = {
      vars: new Map(),
      parent: callee.closure as Scope,
      locals: localNames(fn.body),
    };
    fn.params.forEach((p, i) => local.vars.set(p.name, args[i] ?? NONE));
    let result: PyVal = NONE;
    try {
      qualStack.push(qualnames.get(fn) ?? callee.name);
      for (const s of fn.body) execStmt(s, local);
      qualStack.pop();
    } catch (e) {
      if (e instanceof ReturnSignal) {
        result = e.value;
        qualStack.pop();
      } else {
        qualStack.pop();
        depth--;
        throw e;
      }
    }
    depth--;
    if (cacheable) {
      emitter.emit('eml:cache:miss', { fn: name, args: args.map(pyRepr) });
      coldCache.set(key, result);
    }
    emitter.emit('eml:return', { fn: name, value: pyRepr(result) });
    return result;
  };

  /** The class-level namespace behind an instance — the fallback for reads
   *  the instance's own dict does not answer. */
  const classAttrs = (v: Extract<PyVal, { k: 'instance' }>): Map<string, PyVal> => v.classAttrs;

  /** Look up a method by name in a class body (Phase 7e) — `undefined` if absent. */
  const findMethod = (def: ClassDef, methodName: string): FunctionDef | undefined =>
    def.body.find((s): s is FunctionDef => s.type === 'FunctionDef' && s.name === methodName);

  /**
   * `ClassName(args)` construction (Phase 7e): look up `__init__`, bind a
   * fresh instance as `self`, run its body, return the instance. No
   * `__init__` at all is a valid zero-arg construction (an empty instance);
   * extra args with no `__init__` to absorb them is a TypeError, mirroring
   * real Python's default `object.__init__`.
   */
  const instantiateClass = (cls: Extract<PyVal, { k: 'class' }>, args: PyVal[]): PyVal => {
    const def = cls.def as ClassDef;
    const instance: Extract<PyVal, { k: 'instance' }> = {
      k: 'instance',
      className: cls.name,
      classDef: def,
      attrs: new Map(),
      classAttrs: cls.attrs,
    };
    const init = findMethod(def, '__init__');
    if (init) {
      runMethodBody(instance, init, args);
    } else if (args.length > 0) {
      // CPython's default `object.__init__` reports no count here and no
      // lexical qualifier, even when the class is nested two functions deep:
      //     Slate() takes no arguments
      // That is a DIFFERENT rule from the one `__init__` follows a few lines
      // above, where the same nested class reports
      //     mk.<locals>.S.__init__() missing 1 required positional argument: 'x'
      // so this branch must not reach for `classQualnames`, and must not go
      // through `arityError` — measured against CPython 3.14 in both
      // directions. This is the one arity site that does not share the
      // composer, which is why every message row written against the
      // composer covered three of the four deciding sites and missed this.
      throw new PyError('TypeError', `${cls.name}() takes no arguments`);
    }
    return instance;
  };

  /** Dispatch `instance.methodName(args)` (Phase 7e) — AttributeError if the
   *  class defines no such method. */
  const callMethod = (instance: Extract<PyVal, { k: 'instance' }>, methodName: string, args: PyVal[]): PyVal => {
    const method = findMethod(instance.classDef as ClassDef, methodName);
    if (!method) {
      throw new PyError('AttributeError', `'${instance.className}' object has no attribute '${methodName}'`);
    }
    return runMethodBody(instance, method, args);
  };

  /**
   * Execute a method body with `self` bound to `instance` and the remaining
   * params bound to `args` — mirrors evalCall's function-call machinery
   * (recursion guard, tick, ReturnSignal) but WITHOUT @cold/@hot caching
   * (methods are excluded from the whole cold/hot analysis stack this round —
   * see semantic.ts's resolveMethod). Methods close over the top-level module
   * scope, not a captured lexical closure: `{k:'class', ...}` carries no
   * `closure` field (unlike `{k:'func', ...}`), a deliberate "minimal viable
   * OOP" simplification — a class nested inside a function whose methods
   * reference that function's locals is not modeled faithfully this round.
   */
  const runMethodBody = (instance: Extract<PyVal, { k: 'instance' }>, method: FunctionDef, args: PyVal[]): PyVal => {
    // A bound call always delivers the instance, whether or not the method
    // declared a parameter to receive it, so `given` counts it and `params` is
    // every declared parameter including the receiver. v1 asked instead whether
    // a first parameter was DECLARED, which made a zero-parameter method the
    // one shape it could not reject and undercounted every message by one.
    // This frame is also how __init__, __enter__ and __exit__ are invoked, so
    // all four are covered by the single comparison.
    // ONE string, computed once, used by the arity label and by everything
    // below. The first attempt at this fix changed only the `qualifiedName`
    // further down — which feeds eml:call, eml:return and qualStack — while the
    // guard here went on building its own label from the bare class name, so
    // four of the five rows stayed red and the fifth passed for a reason that
    // had nothing to do with the label being right.
    const owner = classQualnames.get(instance.classDef as ClassDef) ?? instance.className;
    const qualifiedName = `${owner}.${method.name}`;
    {
      const arity = arityError(qualifiedName, method.params, args.length + 1);
      if (arity) throw arity;
    }
    if (++depth > RECURSION_LIMIT) {
      depth--;
      throw new PyError('RecursionError', 'maximum recursion depth exceeded');
    }
    tick();
    emitter.emit('eml:call', { fn: qualifiedName, args: args.map(pyRepr), temperature: 'neutral' });
    const local: Scope = { vars: new Map(), parent: module, locals: localNames(method.body) };
    const [selfParam, ...restParams] = method.params;
    if (selfParam) local.vars.set(selfParam.name, instance);
    restParams.forEach((p, i) => local.vars.set(p.name, args[i] ?? NONE));
    let result: PyVal = NONE;
    try {
      qualStack.push(qualifiedName);
      for (const s of method.body) execStmt(s, local);
      qualStack.pop();
    } catch (e) {
      if (e instanceof ReturnSignal) {
        result = e.value;
        qualStack.pop();
      } else {
        qualStack.pop();
        depth--;
        throw e;
      }
    }
    depth--;
    emitter.emit('eml:return', { fn: qualifiedName, value: pyRepr(result) });
    return result;
  };

  /**
   * Would CPython iterate this instance? That is NOT the same question as
   * "is this one of the shapes this interpreter models", and conflating the
   * two is the defect EMLP-RELAY-0100 caught in candidate v1: `iterableItems`
   * returns null for every user instance, and v1 read that null as "not
   * iterable" and said so out loud.
   *
   * A user class supplies iteration through `__iter__`/`__next__` or through
   * the sequence protocol's `__getitem__`, and either can arrive as a method
   * in the class body or as a class attribute bound at runtime. This
   * interpreter does not dispatch dunders automatically (EML-LANG-2026 §7e)
   * while the Python it generates does, so wherever such an entry point
   * EXISTS the honest answer is a deferral. Claiming the object is not
   * iterable is a wrong answer where the product's blanket defer was right.
   *
   * Both lookups are needed: searching only the class body misses a runtime
   * `C.__getitem__ = f` binding, and searching only the class attributes
   * misses an ordinary `def __getitem__` in the body.
   */
  const hasIterationProtocol = (v: Extract<PyVal, { k: 'instance' }>): boolean =>
    ['__iter__', '__getitem__'].some(
      (n) => findMethod(v.classDef as ClassDef, n) !== undefined || v.classAttrs.has(n));

  // CPython's argument-count contract, per builtin, in CPython's own wording
  // and carrying the actual N. Harvested from real CPython 3.14.5 rather than
  // recalled, because the sentences differ per builtin AND per direction:
  // `sum()` says "takes at least 1 positional argument" while a surplus sum
  // says "takes at most 2 arguments", and `float` says "expected at most 1
  // argument, got N" where `abs` says "takes exactly one argument (N given)".
  // One shared sentence cannot be right for more than one of them, which is
  // what need() was doing for four callers at once (EMLP-AUDIT-006, N2).
  //
  // This runs BEFORE any per-builtin body, so an arity decision is never
  // reached through a conversion question or a deferral.
  const checkArity = (name: string, n: number): void => {
    switch (name) {
      case 'abs': case 'len': case 'repr':
        if (n !== 1) throw new PyError('TypeError', `${name}() takes exactly one argument (${n} given)`);
        return;
      case 'sum':
        if (n === 0) throw new PyError('TypeError', 'sum() takes at least 1 positional argument (0 given)');
        if (n > 2) throw new PyError('TypeError', `sum() takes at most 2 arguments (${n} given)`);
        return;
      case 'float':
        if (n > 1) throw new PyError('TypeError', `float expected at most 1 argument, got ${n}`);
        return;
      case 'int':
        if (n > 2) throw new PyError('TypeError', `int expected at most 2 arguments, got ${n}`);
        return;
      case 'str':
        if (n > 3) throw new PyError('TypeError', `str expected at most 3 arguments, got ${n}`);
        return;
      case 'set':
        if (n > 1) throw new PyError('TypeError', `set expected at most 1 argument, got ${n}`);
        return;
      case 'min': case 'max':
        // Zero arguments and an empty iterable are different errors of
        // different TYPES, and they used to reach one line inside minmax().
        // Deciding arity here is what splits them.
        if (n === 0) throw new PyError('TypeError', `${name} expected at least 1 argument, got 0`);
        return;
      default:
        return;
    }
  };

  const callBuiltin = (name: string, args: PyVal[]): PyVal => {
    checkArity(name, args.length);
    switch (name) {
      case 'abs': {
        const a = need(args, 0, name);
        if (a.k === 'int') return INT(a.v < 0n ? -a.v : a.v);
        if (a.k === 'bool') return INT(a.v ? 1n : 0n); // bool is an int subtype
        if (a.k === 'float') return FLOAT(Math.abs(a.v));
        throw new PyError('TypeError', `bad operand type for abs(): '${typeName(a)}'`);
      }
      case 'len': {
        const a = need(args, 0, name);
        // Tuples were missing here, so `len((1, 2, 3))` raised TypeError where
        // Python answers 3. Sharing iterableItems keeps the set of "things with
        // a length" from drifting away from the set of "things you can iterate".
        const items = iterableItems(a);
        if (items) return INT(BigInt(items.length));
        throw new PyError('TypeError', `object of type '${typeName(a)}' has no len()`);
      }
      case 'set': {
        // FOUR regions, not two. `{}` is a dict literal (Python parity), so
        // `set()` is the only way to spell an empty set; one iterable argument
        // is a deliberate deferral; one NON-iterable argument is a TypeError
        // CPython raises before any conversion question arises; and two or more
        // is an arity error, already decided in checkArity above.
        //
        // A single `args.length > 0` collapsed all of these into one deferral
        // whose stated reason - "converting an iterable to a set" - was true for
        // exactly one of them and described something that was not happening
        // for the other two.
        // Three-valued, not boolean. v1 asked `iterableItems(sa)` and treated
        // its null as "not iterable"; that answers only whether the shape is
        // directly modeled here. See hasIterationProtocol above.
        if (args.length === 0) return SET([]);
        const sa = args[0]!;
        if (iterableItems(sa)) {
          throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');
        }
        if (sa.k === 'instance' && hasIterationProtocol(sa)) {
          throw new Unsupported('set(iterable)', 'iterating a user-defined object is not modeled yet');
        }
        throw new PyError('TypeError', `'${typeName(sa)}' object is not iterable`);
      }
      case 'int': {
        // Exactly two arguments is the base form, and it is DEFERRED rather
        // than implemented. Measured: 0 of 741 corpus programs reach it, while
        // implementing it means bases 0 and 2-36, prefix inference for base 0,
        // underscore separators, whitespace, sign, and two exact message
        // families - a wider untested message surface than the one this audit
        // is about. Silently dropping the base produced the only wrong VALUE in
        // the census; a stated refusal is the smaller and honest change.
        // Three or more arguments is an arity error, decided in checkArity.
        if (args.length === 2) {
          throw new Unsupported('int(x, base)', 'the base argument is not modeled yet');
        }
        const a = args[0] ?? INT(0n);
        if (a.k === 'int') return a;
        if (a.k === 'bool') return INT(a.v ? 1n : 0n);
        if (a.k === 'float') return INT(BigInt(Math.trunc(a.v)));
        if (a.k === 'str') {
          const n = parsePyInt(a.v);
          if (n === null) throw new PyError('ValueError', `invalid literal for int() with base 10: ${pyRepr(a)}`);
          return INT(n);
        }
        throw new PyError('TypeError', `int() argument must be a string or a number, not '${typeName(a)}'`);
      }
      case 'float': {
        const a = args[0] ?? FLOAT(0);
        if (a.k === 'float') return a;
        if (a.k === 'int') return FLOAT(Number(a.v));
        if (a.k === 'bool') return FLOAT(a.v ? 1 : 0);
        if (a.k === 'str') {
          const n = parsePyFloat(a.v);
          if (n === null) throw new PyError('ValueError', `could not convert string to float: ${pyRepr(a)}`);
          return FLOAT(n);
        }
        throw new PyError('TypeError', `float() argument must be a string or a number, not '${typeName(a)}'`);
      }
      case 'str': {
        if (args.length === 0) return STR('');
        // Two and three arguments are CPython's bytes-DECODING form, not a
        // surplus: `str expected at most 3 arguments` begins at four, and this
        // census originally filed str("a","b") under arity because the answer
        // agreed with that conclusion. The decoding path is deferred rather
        // than implemented, for the same reason as int's base: 0 of 741 corpus
        // programs reach it and it is a message surface, not a value.
        if (args.length >= 2) {
          throw new Unsupported('str(object, encoding[, errors])', 'the bytes decoding path is not modeled yet');
        }
        const sv = need(args, 0, name);
        guardSetOrder(sv, 'str()');
        return STR(pyStr(sv));
      }
      // `repr` exists in every Python program the transpiler emits, so its
      // absence here was a divergence in its own right: a program calling it
      // ran fine as Python and raised NameError in the browser. pyRepr already
      // backed list/dict element formatting; it just was not reachable by name.
      case 'repr': {
        const rv = need(args, 0, name);
        guardSetOrder(rv, 'repr()');
        return STR(pyRepr(rv));
      }
      case 'min':
      case 'max':
        return minmax(name, args);
      case 'sum': {
        const a = need(args, 0, name);
        const items = iterableItems(a);
        if (!items) throw new PyError('TypeError', `'${typeName(a)}' object is not iterable`);
        const start = args[1] ?? INT(0n);
        // Python refuses str explicitly rather than concatenating, to steer you
        // to ''.join() — which is O(n) instead of O(n^2). We used to happily
        // return "ab", quietly endorsing the quadratic idiom.
        if (start.k === 'str') {
          throw new PyError('TypeError', "sum() can't sum strings [use ''.join(seq) instead]");
        }
        // Summing a SET of floats is the one order-sensitive case: our insertion
        // order is not CPython's hash order, and float addition is not
        // associative, so the last bits could differ. Ints are exact and lists
        // and tuples have a defined order, so only this combination defers.
        if (a.k === 'set' && items.some((x) => x.k === 'float')) {
          throw new Unsupported(
            'sum() over a set of floats',
            'set iteration order differs from CPython and float addition is not associative, so the result could differ in the last bits — sum a list literal instead, where the order is defined',
          );
        }
        return pySum(items, start);
      }
      default:
        // The temporal runtime intrinsics are "known but unsupported" — defer to
        // real Python. Any other unbound callee is a NameError, like CPython.
        if (name === 'run_temporal' || name === 'temporal_wait') {
          throw new Unsupported(`call ${name}()`, 'temporal runtime intrinsic — real Python only');
        }
        throw new PyError('NameError', `name '${name}' is not defined`);
    }
  };

  // ── Statement execution ────────────────────────────────────────────────────
  const execStmt = (stmt: Statement, scope: Scope): void => {
    switch (stmt.type) {
      case 'FunctionDef':
        // Bind a first-class function value capturing the DEFINING scope, so it
        // closes over enclosing locals (nested defs) and is callable by name.
        {
          const enclosing = qualStack[qualStack.length - 1];
          qualnames.set(stmt, enclosing === undefined ? stmt.name : `${enclosing}.<locals>.${stmt.name}`);
        }
        assign(scope, stmt.name, { k: 'func', name: stmt.name, def: stmt, closure: scope });
        emitter.emit('eml:def', {
          fn: stmt.name,
          params: stmt.params.map((p) => p.name),
          temperature: stmt.temperature ?? 'neutral',
          async: !!stmt.isAsync,
        });
        return;
      case 'Assignment': {
        const v = evalExpr(stmt.value, scope);
        writeTarget(stmt.target, v, scope);
        emitter.emit('eml:assign', { name: targetLabel(stmt.target), value: pyRepr(v), declares: stmt.declares });
        return;
      }
      case 'AugmentedAssign': {
        const cur = readTarget(stmt.target, scope);
        const v = arith(stmt.op, cur, evalExpr(stmt.value, scope));
        writeTarget(stmt.target, v, scope);
        emitter.emit('eml:augment', { name: targetLabel(stmt.target), op: stmt.op, value: pyRepr(v) });
        return;
      }
      case 'Output': {
        const end = stmt.end !== undefined ? pyStr(evalExpr(stmt.end, scope)) : '\n';
        write(pyStr(evalExpr(stmt.value, scope)), end);
        return;
      }
      case 'ExpressionStatement':
        evalExpr(stmt.expression, scope);
        return;
      case 'Return':
        throw new ReturnSignal(stmt.value ? evalExpr(stmt.value, scope) : NONE);
      case 'OverlayAssign':
        // Should never reach the interpreter — the semantic pass resolves these.
        throw new Unsupported('OverlayAssign', 'unresolved overlay assignment (internal)');
      case 'If': {
        if (truthy(evalExpr(stmt.test, scope))) {
          for (const s of stmt.body) execStmt(s, scope);
        } else {
          for (const s of stmt.orelse) execStmt(s, scope);
        }
        return;
      }
      case 'While': {
        while (truthy(evalExpr(stmt.test, scope))) {
          tick(); // bounds runaway loops against maxSteps — same role as rangeInts/evalSum
          try {
            for (const s of stmt.body) execStmt(s, scope);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'ForIn': {
        const items = forInItems(evalExpr(stmt.iterable, scope));
        for (const item of items) {
          tick();
          assign(scope, stmt.target.name, item);
          try {
            for (const s of stmt.body) execStmt(s, scope);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'Break':
        throw new BreakSignal();
      case 'Continue':
        throw new ContinueSignal();
      case 'Pass':
        // Deliberately nothing. It exists so a block that must stay empty can
        // still satisfy the "blocks are non-empty" rule.
        return;
      case 'Import':
        // No-op: the interpreter doesn't model real module objects, but a
        // program that imports something and never actually calls into it
        // should still run cleanly — only USE of the module defers (see
        // evalCall's/evalExpr's Attribute handling), not the import itself.
        return;
      case 'Try': {
        // Lean entirely on native JS try/finally: it already runs `finally`
        // exactly once regardless of success / matched-throw / unmatched-throw
        // / break-continue-return inside the body, and before a rethrown
        // exception continues propagating — a direct match for Python's own
        // `finally` guarantee, with zero manual pending-exception bookkeeping.
        try {
          try {
            for (const s of stmt.body) execStmt(s, scope);
          } catch (e) {
            if (e instanceof PyError) {
              const handler = stmt.handlers.find((h) => matchesHandler(h, e));
              if (handler) {
                const prevException = currentException;
                currentException = e;
                try {
                  // `except E as NAME` binds NAME in the CURRENT scope — it does
                  // NOT open a new one. Running the body in a child scope (which
                  // is what this used to do, purely so it had somewhere to put
                  // NAME) silently discarded every assignment the handler made:
                  // `count + 1 => count` created a local in the throwaway scope
                  // and the enclosing `count` never moved. Handlers without an
                  // `as` clause were unaffected, which is why it survived so long
                  // — examples/retry-until-success is what finally caught it.
                  //
                  // Python then DELETES the name when the handler ends, even if
                  // it existed beforehand, so the delete below is unconditional
                  // rather than a save/restore.
                  // Binds the EXCEPTION OBJECT, not its message string.
                  // `str(e)` still yields the message (pyStr of an exception is
                  // its message, as in Python), so existing corpus cases are
                  // unaffected — but `repr(e)`, `raise e` and type comparison
                  // now work too.
                  if (handler.name) scope.vars.set(handler.name, EXCEPTION(e));
                  try {
                    for (const s of handler.body) execStmt(s, scope);
                  } finally {
                    if (handler.name) scope.vars.delete(handler.name);
                  }
                } finally {
                  currentException = prevException;
                }
                return;
              }
            }
            // Wrong exception type, or a non-PyError signal (Break/Continue/
            // Return/Unsupported/StepLimit) — passes through untouched; the
            // outer `finally` below still runs before it keeps propagating.
            throw e;
          }
        } finally {
          for (const s of stmt.finallyBody) execStmt(s, scope);
        }
        return;
      }
      case 'Raise': {
        if (!stmt.exception) {
          if (!currentException) throw new PyError('RuntimeError', 'No active exception to re-raise');
          throw currentException;
        }
        const exc = stmt.exception;
        if (exc.type === 'Call' && exc.callee.type === 'Identifier') {
          const args = exc.args.map((a) => evalExpr(a, scope));
          throw new PyError(exc.callee.name, args.length > 0 ? pyStr(args[0]!) : '');
        }
        // Now that exceptions are real values, the general path works: evaluate
        // the operand and raise whatever it denotes. `raise e` (re-raising a
        // caught exception) used to defer as Unsupported purely because there
        // was no exception object to re-raise.
        const raised = evalExpr(exc, scope);
        if (raised.k === 'exception') throw raised.err;
        if (raised.k === 'exc_class') throw new PyError(raised.name, '');
        throw new PyError(
          'TypeError',
          'exceptions must derive from BaseException',
        );
      }
      case 'With': {
        // Real __enter__/__exit__ protocol dispatch (Phase 9 item 6), reusing
        // the existing findMethod/runMethodBody machinery (Phase 7e) rather
        // than building new dispatch — no built-in context manager (like a
        // real `open()` file handle) is modeled, so this only works for a
        // user-defined class instance with both methods defined, matching
        // real Python's own protocol exactly (including its check ORDER —
        // verified directly: a value missing both methods reports "missed
        // __exit__ method" first, not __enter__).
        const ctxVal = evalExpr(stmt.contextExpr, scope);
        const exitMethod = ctxVal.k === 'instance' ? findMethod(ctxVal.classDef as ClassDef, '__exit__') : undefined;
        if (!exitMethod) {
          throw new PyError(
            'TypeError',
            `'${typeName(ctxVal)}' object does not support the context manager protocol (missed __exit__ method)`,
          );
        }
        const enterMethod = findMethod((ctxVal as Extract<PyVal, { k: 'instance' }>).classDef as ClassDef, '__enter__');
        if (!enterMethod) {
          throw new PyError(
            'TypeError',
            `'${typeName(ctxVal)}' object does not support the context manager protocol (missed __enter__ method)`,
          );
        }
        const instance = ctxVal as Extract<PyVal, { k: 'instance' }>;
        const entered = runMethodBody(instance, enterMethod, []);
        if (stmt.target) assign(scope, stmt.target.name, entered);
        try {
          for (const s of stmt.body) execStmt(s, scope);
          runMethodBody(instance, exitMethod, [NONE, NONE, NONE]);
        } catch (e) {
          if (e instanceof PyError) {
            // exc_type is the CLASS and exc_value the INSTANCE, matching
            // CPython, so `exc_type == ValueError` and `str(exc_value)` both
            // behave. (These were plain strings until exceptions became real
            // values.) exc_tb stays NONE: a real traceback's only observable
            // form is `<traceback object at 0x...>`, whose address differs
            // between runs of CPython itself, so there is no reproducible
            // value to supply — documented rather than faked.
            const suppressed = truthy(
              runMethodBody(instance, exitMethod, [EXC_CLASS(e.pyType), EXCEPTION(e), NONE]),
            );
            if (!suppressed) throw e;
          } else {
            // Break/Continue/Return/Unsupported/StepLimit — with is an
            // implicit finally, so __exit__ still runs before this
            // propagates, matching real Python's guarantee for non-exception
            // exits too.
            runMethodBody(instance, exitMethod, [NONE, NONE, NONE]);
            throw e;
          }
        }
        return;
      }
      case 'ClassDef': {
        // Bind a first-class class value, parallel to how FunctionDef binds
        // {k:'func',...}. Methods are looked up from `def.body` by name at
        // call time (instantiateClass/callMethod), not pre-materialized —
        // see docs for why (no per-method closure is modeled this round).
        //
        // Everything in the body that ISN'T a method runs now, exactly once,
        // in a namespace of its own — that namespace becomes the class dict.
        // Python does the same thing, and skipping it used to make
        // `class C: tag = "x"` silently lose `tag` altogether: the class was
        // bound, the assignment never ran, and reading `self.tag` raised
        // AttributeError as if the line had never been written.
        const classScope: Scope = { vars: new Map(), parent: scope };
        for (const s of stmt.body) {
          if (s.type !== 'FunctionDef') execStmt(s, classScope);
        }
        {
          const enclosing = qualStack[qualStack.length - 1];
          classQualnames.set(stmt, enclosing === undefined ? stmt.name : `${enclosing}.<locals>.${stmt.name}`);
        }
        assign(scope, stmt.name, { k: 'class', name: stmt.name, def: stmt, attrs: classScope.vars });
        emitter.emit('eml:classdef', {
          name: stmt.name,
          methods: stmt.body.filter((s): s is FunctionDef => s.type === 'FunctionDef').map((s) => s.name),
        });
        return;
      }
    }
  };

  // ── Run ────────────────────────────────────────────────────────────────────
  emitter.emit('eml:run:start', { ...(opts.file ? { file: opts.file } : {}), statements: program.body.length });
  try {
    for (const s of program.body) execStmt(s, module);
    emitter.emit('eml:run:done', {
      ok: true,
      outputs: out.length,
      anomalies: findAnomalies(emitter.events).length,
    });
    return finalize(true);
  } catch (e) {
    if (e instanceof Unsupported) {
      unsupported.push(e.construct);
      emitter.emit('eml:unsupported', { construct: e.construct, reason: e.reason });
      emitter.emit('eml:run:incomplete', { reason: 'unsupported', construct: e.construct });
      return finalize(false);
    }
    if (e instanceof StepLimit) {
      error = { type: 'StepLimitExceeded', message: `evaluation exceeded ${maxSteps} steps` };
      emitter.emit('eml:run:error', { error: error.type, message: error.message });
      return finalize(false);
    }
    if (e instanceof PyError) {
      error = { type: e.pyType, message: e.message };
      emitter.emit('eml:run:error', { error: e.pyType, message: e.message });
      return finalize(false);
    }
    if (e instanceof ReturnSignal) {
      // `return` at module scope: Python raises SyntaxError at compile, but our
      // grammar lets it parse; treat as a clean stop rather than crashing the host.
      emitter.emit('eml:run:incomplete', { reason: 'return-at-module-scope' });
      return finalize(false);
    }
    if (e instanceof BreakSignal || e instanceof ContinueSignal) {
      // A break/continue outside a loop is normally caught by the semantic
      // pass (E_BREAK_OUTSIDE_LOOP/E_CONTINUE_OUTSIDE_LOOP) before the
      // interpreter ever sees it; `interpretProgram()` skips that gate for an
      // already-resolved AST, so defend the same way ReturnSignal does above.
      emitter.emit('eml:run:incomplete', {
        reason: e instanceof BreakSignal ? 'break-outside-loop' : 'continue-outside-loop',
      });
      return finalize(false);
    }
    throw e;
  }

  function finalize(ok: boolean): InterpResult {
    // Each `write()` already embeds its own terminator (default '\n', or a
    // custom one from Output.end) — just join.
    const output = out.join('');
    return {
      ok,
      output,
      outputLines: output === '' ? [] : output.replace(/\n$/, '').split('\n'),
      events: [...emitter.events],
      ...(error ? { error } : {}),
      unsupported,
      diagnostics,
    };
  }
}

// ── Scope helpers ──────────────────────────────────────────────────────────────
/**
 * Resolve a name up the scope chain. Throws UnboundLocalError if the name is a
 * static local of a frame but not yet bound (Python semantics: a function-local
 * name must NOT fall through to an enclosing/module binding). Returns undefined
 * only if the name is unknown everywhere (caller decides function-ref / NameError).
 */
function readVar(scope: Scope, name: string): PyVal | undefined {
  for (let s: Scope | undefined = scope; s; s = s.parent) {
    const v = s.vars.get(name);
    if (v !== undefined) return v;
    if (s.locals?.has(name)) {
      throw new PyError(
        'UnboundLocalError',
        `cannot access local variable '${name}' where it is not associated with a value`,
      );
    }
  }
  return undefined;
}
function assign(scope: Scope, name: string, value: PyVal): void {
  scope.vars.set(name, value);
}

/** Whether `handler` catches `e` — exact `pyType` string match; `except:`
 *  (no type) and `except Exception:` both act as catch-all. No hierarchical
 *  matching (Phase 7d fidelity gap: `except ArithmeticError:` will not catch
 *  a `ZeroDivisionError` here, though it would in real transpiled Python). */
function matchesHandler(handler: ExceptHandler, e: PyError): boolean {
  if (!handler.exceptionType || handler.exceptionType === 'Exception') return true;
  return handler.exceptionType === e.pyType;
}

/** Human-readable trace label for an assignment target (Phase 7b: Identifier or Subscript). */
function targetLabel(target: AssignTarget): string {
  if (target.type === 'Identifier') return target.name;
  const objLabel = target.object.type === 'Identifier' ? target.object.name : '…';
  return `${objLabel}[…]`;
}

/**
 * Resolve a list/str index, supporting Python negative indices; IndexError if
 * out of range.
 *
 * `use` matters: CPython words the same failure differently depending on which
 * side of the assignment the subscript is on — `xs[9]` says "list index out of
 * range", `xs[9] = 1` says "list ASSIGNMENT index out of range". One message
 * served both here, which is invisible until a program prints `str(e)`.
 */
function normalizeIndex(
  idx: PyVal,
  length: number,
  containerType: string,
  use: 'read' | 'assign' = 'read',
): number {
  if (idx.k !== 'int' && idx.k !== 'bool') {
    throw new PyError('TypeError', `${containerType} indices must be integers, not ${typeName(idx)}`);
  }
  const raw = idx.k === 'bool' ? (idx.v ? 1 : 0) : Number(idx.v);
  const resolved = raw < 0 ? raw + length : raw;
  if (resolved < 0 || resolved >= length) {
    const what = use === 'assign' ? `${containerType} assignment index` : `${containerType} index`;
    throw new PyError('IndexError', `${what} out of range`);
  }
  return resolved;
}

/** `obj[index]` read (Phase 7b) — list/str (negative indices) + dict (KeyError). */
function subscriptGet(obj: PyVal, index: PyVal): PyVal {
  if (obj.k === 'list') return obj.v[normalizeIndex(index, obj.v.length, 'list')]!;
  // Read-only — `subscriptSet` intentionally has no 'tuple' case, so writing
  // through a tuple subscript still falls through to its existing "does not
  // support item assignment" error, which is already the correct Python
  // message for an immutable tuple.
  if (obj.k === 'tuple') return obj.v[normalizeIndex(index, obj.v.length, 'tuple')]!;
  if (obj.k === 'str') return STR(obj.v[normalizeIndex(index, obj.v.length, 'string')]!);
  if (obj.k === 'dict') {
    if (!isHashable(index)) throw new PyError('TypeError', `unhashable type: '${typeName(index)}'`);
    const entry = obj.v.get(canonicalKey(index));
    if (!entry) throw new PyError('KeyError', pyRepr(index));
    return entry.value;
  }
  throw new PyError('TypeError', `'${typeName(obj)}' object is not subscriptable`);
}

/** Resolve a slice bound's PyVal to a plain number (Phase 9) — int/bool only, like `normalizeIndex`. */
function sliceIndexNumber(v: PyVal): number {
  if (v.k === 'int') return Number(v.v);
  if (v.k === 'bool') return v.v ? 1 : 0;
  throw new PyError('TypeError', `slice indices must be integers, not ${typeName(v)}`);
}

/** Clamp a slice bound into `[0, length]`, resolving a negative index and defaulting to
 *  `fallback` when the bound is omitted — Python slicing never raises `IndexError` for an
 *  out-of-range bound, unlike a plain `obj[i]` subscript. */
function clampSliceBound(v: PyVal | undefined, length: number, fallback: number): number {
  if (v === undefined) return fallback;
  const raw = sliceIndexNumber(v);
  const resolved = raw < 0 ? raw + length : raw;
  return Math.max(0, Math.min(length, resolved));
}

/** `obj[start:stop]` read (Phase 9) — list/tuple/str only, no step form (see `SliceExpression`). */
function sliceGet(obj: PyVal, startVal: PyVal | undefined, stopVal: PyVal | undefined): PyVal {
  let length: number;
  if (obj.k === 'list' || obj.k === 'tuple') length = obj.v.length;
  else if (obj.k === 'str') length = [...obj.v].length;
  else throw new PyError('TypeError', `'${typeName(obj)}' object is not subscriptable`);
  const start = clampSliceBound(startVal, length, 0);
  const stop = clampSliceBound(stopVal, length, length);
  if (obj.k === 'str') return STR([...obj.v].slice(start, stop).join(''));
  if (obj.k === 'list') return LIST(obj.v.slice(start, stop));
  return TUPLE(obj.v.slice(start, stop));
}

/** `obj[index] = value` write (Phase 7b) — list (in place) + dict (insert-or-update). */
function subscriptSet(obj: PyVal, index: PyVal, value: PyVal): void {
  if (obj.k === 'list') {
    obj.v[normalizeIndex(index, obj.v.length, 'list', 'assign')] = value;
    return;
  }
  if (obj.k === 'str') throw new PyError('TypeError', "'str' object does not support item assignment");
  if (obj.k === 'dict') {
    if (!isHashable(index)) throw new PyError('TypeError', `unhashable type: '${typeName(index)}'`);
    const ck = canonicalKey(index);
    const existing = obj.v.get(ck);
    obj.v.set(ck, { key: existing ? existing.key : index, value });
    return;
  }
  throw new PyError('TypeError', `'${typeName(obj)}' object does not support item assignment`);
}


/**
 * Names bound anywhere in a function body — Python's static locals. Recurses
 * into if/while/for bodies (they don't introduce a new scope in real Python),
 * including a for-loop's own target, which stays bound after the loop ends.
 */
function localNames(body: Statement[]): Set<string> {
  const out = new Set<string>();
  const visit = (stmts: Statement[]): void => {
    for (const s of stmts) {
      // A Subscript target (Phase 7b: `d[k] = v`) mutates an existing object —
      // it does not bind a new Python-function-local name, unlike a bare name.
      if ((s.type === 'Assignment' || s.type === 'AugmentedAssign') && s.target.type === 'Identifier') {
        out.add(s.target.name);
      } else if (s.type === 'FunctionDef') out.add(s.name); // a nested def binds a local
      else if (s.type === 'ClassDef') out.add(s.name); // a nested class binds a local too
      else if (s.type === 'If') {
        visit(s.body);
        visit(s.orelse);
      } else if (s.type === 'While') visit(s.body);
      else if (s.type === 'ForIn') {
        out.add(s.target.name);
        visit(s.body);
      }
    }
  };
  visit(body);
  return out;
}

function need(args: PyVal[], i: number, name: string): PyVal {
  const a = args[i];
  if (a === undefined) throw new PyError('TypeError', `${name}() missing required argument`);
  return a;
}

function minmax(name: 'min' | 'max', args: PyVal[]): PyVal {
  let items: PyVal[];
  if (args.length === 1) {
    // ONE argument means "iterate this", for every iterable — not just list.
    // The old code special-cased list and fell through to `items = args` for
    // anything else, so `max("hello")` returned "hello" instead of 'o', and
    // `max(5)` returned 5 where Python raises TypeError. A single argument that
    // is not iterable is an error, never a one-element sequence.
    const it = iterableItems(args[0]!);
    if (!it) throw new PyError('TypeError', `'${typeName(args[0]!)}' object is not iterable`);
    items = it;
  } else {
    items = args;
  }
  // CPython's wording, verified against the local interpreter rather than
  // recalled: 3.12 reworded this from "arg is an empty sequence" to the text
  // below. A program that prints str(e) can tell the difference, and one in
  // the corpus does.
  if (items.length === 0) throw new PyError('ValueError', `${name}() iterable argument is empty`);
  let best = items[0]!;
  // Replace only on a STRICT change (max: x > best, min: x < best) so a tie keeps
  // the first occurrence — exactly as Python's min()/max() do.
  for (const x of items.slice(1)) {
    const c = compare(name === 'max' ? '>' : '<', x, best);
    if (c.k === 'bool' && c.v) best = x;
  }
  return best;
}
