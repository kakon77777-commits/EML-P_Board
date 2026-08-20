import type { Program, Statement, Expression, DecoratorArg, AssignTarget } from '@eml/types';

/**
 * Identifier aliases to avoid shadowing Python builtins.
 * `list^+[1,2,3]` -> `lst = [1, 2, 3]` (per MVP spec grammar §5 / Appendix A
 * case 14). The alias is applied to variable bindings and reads but NOT to call
 * callees, so a genuine builtin call like `list(1)` is preserved. The semantic
 * analyzer detects and rejects collisions where both `list` and `lst` are
 * declared in the same program. Documented in docs/agent-handoff.md.
 */
export const IDENTIFIER_ALIASES: Record<string, string> = {
  list: 'lst',
};

export function aliasIdentifier(name: string): string {
  return IDENTIFIER_ALIASES[name] ?? name;
}

/** Python expression precedence; higher binds tighter. */
function precedence(expr: Expression): number {
  switch (expr.type) {
    case 'Conditional':
      return 1;
    case 'Logical':
      return expr.op === 'or' ? 2 : 3;
    case 'Not':
      return 4;
    case 'Comparison':
    case 'Membership':
      return 5;
    case 'Binary':
      return expr.op === '+' || expr.op === '-' ? 6 : 7;
    case 'Power':
      return 8;
    default:
      return 9; // atoms, calls, transpose, matrix, sum, list, tuple, range, literals
  }
}

/**
 * Emit `child`, parenthesizing when it binds looser than `parentPrec`.
 * Pass `orEqual` for positions that also require wrapping at EQUAL precedence:
 * the right operand of non-associative `-`/`/`, the base of right-associative
 * `**`, and nested conditionals in test/consequent position.
 */
function child(expr: Expression, parentPrec: number, orEqual = false): string {
  const s = emitExpression(expr);
  const looser = orEqual ? precedence(expr) <= parentPrec : precedence(expr) < parentPrec;
  return looser ? `(${s})` : s;
}

/** Emit a range upper bound, applying the inclusive `+1` adjustment. */
function emitRangeEnd(end: Expression): string {
  if (end.type === 'NumberLiteral') {
    // Do the +1 in BigInt for integer literals so bounds stay exact past 2^53
    // (matches the interpreter's INT(BigInt(raw)) + 1n); floats keep number math.
    return /[.eE]/.test(end.raw) ? String(end.value + 1) : (BigInt(end.raw) + 1n).toString();
  }
  // Inclusive end of the form `X - 1` cancels the +1: range(start, X). This
  // keeps the reverse-transpiled `[1:n-1]` round-tripping to `range(1, n)`.
  if (end.type === 'Binary' && end.op === '-' && end.right.type === 'NumberLiteral' && end.right.value === 1) {
    return emitExpression(end.left);
  }
  const s = emitExpression(end);
  // The `+1` binds at additive precedence; wrap ends that bind looser (<6:
  // conditional, or, and, not, comparison, membership) so the adjustment
  // applies to the whole bound. Tighter ends (identifier, additive,
  // multiplicative, power) stay bare, preserving the canonical `range(1, N+1)` form.
  return precedence(end) < 6 ? `(${s})+1` : `${s}+1`;
}

export function emitExpression(expr: Expression): string {
  switch (expr.type) {
    case 'Identifier':
      return aliasIdentifier(expr.name);
    case 'NumberLiteral':
      return expr.raw;
    case 'StringLiteral':
      return JSON.stringify(expr.value);
    case 'Power':
      // Canonical EML form uses no spaces around `**` (e.g. `i**2`). `**` is
      // right-associative in Python, so a Power base must be parenthesized.
      return `${child(expr.base, 8, true)}**${child(expr.exponent, 8)}`;
    case 'Binary': {
      const prec = expr.op === '+' || expr.op === '-' ? 6 : 7;
      // `-`, `/`, and `%` are non-associative: an equal-precedence right
      // operand must be parenthesized to preserve grouping (a - (b - c) !=
      // a - b - c; a % (b % c) != a % b % c).
      const nonAssoc = expr.op === '-' || expr.op === '/' || expr.op === '%';
      return `${child(expr.left, prec)} ${expr.op} ${child(expr.right, prec, nonAssoc)}`;
    }
    case 'Comparison':
      return `${child(expr.left, 5)} ${expr.op} ${child(expr.right, 5)}`;
    case 'Logical': {
      const prec = expr.op === 'or' ? 2 : 3;
      return `${child(expr.left, prec)} ${expr.op} ${child(expr.right, prec)}`;
    }
    case 'Not':
      // `not` binds looser than comparison but tighter than `and`/`or`,
      // matching Python's own precedence exactly — `not x > 5` stays bare
      // (comparison is tighter), `not (a or b)` keeps its parens (or/and are
      // looser).
      return `not ${child(expr.operand, 4)}`;
    case 'Conditional':
      // Python's `a if t else b`: test and consequent are or_test (cannot hold a
      // bare conditional); the alternate may stay bare (right-associative).
      return `${child(expr.consequent, 1, true)} if ${child(expr.test, 1, true)} else ${emitExpression(expr.alternate)}`;
    case 'Range':
      return `range(${emitExpression(expr.start)}, ${emitRangeEnd(expr.end)})`;
    case 'Sum':
      return `sum(${emitExpression(expr.expr)} for ${aliasIdentifier(expr.iterator.name)} in ${emitExpression(expr.range)})`;
    case 'Membership':
      return `${emitExpression(expr.element)} in ${emitExpression(expr.collection)}`;
    case 'Call': {
      // An Identifier callee is NOT aliased: preserve genuine builtin calls
      // like `list(1)`. An Attribute callee (`math.sqrt(x)`) re-emits through
      // the Attribute case below, which DOES alias its own object identifier
      // (e.g. `list.method()` -> `lst.method()`) — the member name itself is
      // never aliased either way.
      const callee = expr.callee.type === 'Identifier' ? expr.callee.name : emitExpression(expr.callee);
      return `${callee}(${expr.args.map(emitExpression).join(', ')})`;
    }
    case 'Matrix':
      return `np.array(${emitExpression(expr.data)})`;
    case 'Transpose':
      return `np.transpose(${emitExpression(expr.operand)})`;
    case 'List':
      return `[${expr.elements.map(emitExpression).join(', ')}]`;
    case 'Tuple':
      // A single element needs the trailing comma to be a real Python tuple
      // — `(x)` alone is just grouping, not a 1-tuple.
      if (expr.elements.length === 0) return '()';
      if (expr.elements.length === 1) return `(${emitExpression(expr.elements[0]!)},)`;
      return `(${expr.elements.map(emitExpression).join(', ')})`;
    case 'Await':
      // `await` binds at primary/postfix level (tighter than every binary,
      // comparison, conditional, and `**`), so a non-atomic argument MUST be
      // parenthesized: `await (a + b)`, not `await a + b` (= `(await a) + b`).
      return `await ${child(expr.argument, 9)}`;
    case 'Dict':
      return `{${expr.entries.map((e) => `${emitExpression(e.key)}: ${emitExpression(e.value)}`).join(', ')}}`;
    case 'Set':
      return `{${expr.elements.map(emitExpression).join(', ')}}`;
    case 'Subscript':
      // The index is already grouped by `[...]`; the object binds at postfix
      // precedence, so anything looser (e.g. `(a + b)[0]`) needs parens.
      return `${child(expr.object, 9)}[${emitExpression(expr.index)}]`;
    case 'Attribute':
      // Same precedence reasoning as Subscript: the object binds at postfix
      // level, so a looser object (e.g. `(a + b).attr`) needs parens. The
      // attribute name itself is never aliased (it's a member, not a binding).
      return `${child(expr.object, 9)}.${expr.attr}`;
    case 'Slice':
      // Only ever reached via Subscript's `${...}[${emitExpression(expr.index)}]` above —
      // a bare Slice has no Python expression form of its own.
      return `${expr.start ? emitExpression(expr.start) : ''}:${expr.stop ? emitExpression(expr.stop) : ''}`;
    case 'ListComp': {
      const cond = expr.condition ? ` if ${emitExpression(expr.condition)}` : '';
      return `[${emitExpression(expr.expr)} for ${aliasIdentifier(expr.iterator.name)} in ${emitExpression(expr.iterable)}${cond}]`;
    }
  }
}

/** Emit an assignment target (Phase 7b: `AssignTarget` is Identifier | Subscript). */
function emitTarget(target: AssignTarget): string {
  if (target.type === 'Identifier') return aliasIdentifier(target.name);
  return emitExpression(target);
}

/** Emit decorator arguments, e.g. `max_wait=3600, check_interval=60`. */
function emitDecoratorArgs(args?: DecoratorArg[]): string {
  if (!args) return '';
  return args
    .map((a) => (a.name !== undefined ? `${a.name}=${emitExpression(a.value)}` : emitExpression(a.value)))
    .join(', ');
}

/** Indent every line of a (possibly multi-line) block by four spaces. */
function indent(block: string): string {
  return block
    .split('\n')
    .map((l) => (l === '' ? '' : '    ' + l))
    .join('\n');
}

export function emitStatement(stmt: Statement): string {
  switch (stmt.type) {
    case 'Assignment':
      return `${emitTarget(stmt.target)} = ${emitExpression(stmt.value)}`;
    case 'AugmentedAssign':
      return `${emitTarget(stmt.target)} ${stmt.op}= ${emitExpression(stmt.value)}`;
    case 'Output': {
      const endArg = stmt.end !== undefined ? `, end=${emitExpression(stmt.end)}` : '';
      return `print(${emitExpression(stmt.value)}${endArg})`;
    }
    case 'ExpressionStatement':
      return emitExpression(stmt.expression);
    case 'Return':
      return stmt.value ? `return ${emitExpression(stmt.value)}` : 'return';
    case 'Break':
      return 'break';
    case 'Continue':
      return 'continue';
    case 'Pass':
      return 'pass';
    case 'Import':
      return `import ${stmt.module}`;
    case 'Try': {
      const lines: string[] = ['try:'];
      for (const s of stmt.body) lines.push(indent(emitStatement(s)));
      for (const h of stmt.handlers) {
        const header = h.exceptionType
          ? h.name
            ? `except ${h.exceptionType} as ${h.name}:`
            : `except ${h.exceptionType}:`
          : 'except:';
        lines.push(header);
        for (const s of h.body) lines.push(indent(emitStatement(s)));
      }
      if (stmt.finallyBody.length > 0) {
        lines.push('finally:');
        for (const s of stmt.finallyBody) lines.push(indent(emitStatement(s)));
      }
      return lines.join('\n');
    }
    case 'Raise':
      return stmt.exception ? `raise ${emitExpression(stmt.exception)}` : 'raise';
    case 'With': {
      const header = stmt.target
        ? `with ${emitExpression(stmt.contextExpr)} as ${stmt.target.name}:`
        : `with ${emitExpression(stmt.contextExpr)}:`;
      const lines: string[] = [header];
      for (const s of stmt.body) lines.push(indent(emitStatement(s)));
      return lines.join('\n');
    }
    case 'FunctionDef': {
      const lines: string[] = [];
      // Decorators: @cold caches pure logic; @hot is a non-caching marker;
      // @temporal_loop(...) is a real runtime decorator (from the preamble).
      // Never cache an `async def`: functools.cache would memoize the coroutine
      // object, which raises "cannot reuse already awaited coroutine" on reuse.
      if (stmt.temperature === 'cold' && !stmt.isAsync) {
        lines.push('@functools.cache');
      } else if (stmt.temperature === 'hot') {
        lines.push('# @hot: dynamic state — not cached');
      }
      for (const d of stmt.decorators) {
        if (d.name === 'cold' || d.name === 'hot') continue; // handled via temperature
        if (d.name === 'temporal_loop') {
          lines.push(`@temporal_loop(${emitDecoratorArgs(d.args)})`);
        } else {
          // Unknown decorators are preserved as comments (informational only).
          lines.push(`# @${d.name}${d.args ? '(...)' : ''}`);
        }
      }
      const params = stmt.params.map((p) => aliasIdentifier(p.name)).join(', ');
      const kw = stmt.isAsync ? 'async def' : 'def';
      lines.push(`${kw} ${aliasIdentifier(stmt.name)}(${params}):`);
      for (const s of stmt.body) lines.push(indent(emitStatement(s)));
      return lines.join('\n');
    }
    case 'OverlayAssign':
      throw new Error(
        `Internal error: unresolved OverlayAssign for '${stmt.target.name}'. ` +
          'analyzeSemantics() must run before emitStatement().',
      );
    case 'If': {
      const lines: string[] = [`if ${emitExpression(stmt.test)}:`];
      for (const s of stmt.body) lines.push(indent(emitStatement(s)));
      if (stmt.orelse.length === 1 && stmt.orelse[0]!.type === 'If') {
        // emitStatement() on the nested If always starts with "if ..."; prefixing
        // "el" turns it into "elif ..." and recurses correctly through chains.
        lines.push('el' + emitStatement(stmt.orelse[0]!));
      } else if (stmt.orelse.length > 0) {
        lines.push('else:');
        for (const s of stmt.orelse) lines.push(indent(emitStatement(s)));
      }
      return lines.join('\n');
    }
    case 'While': {
      const lines: string[] = [`while ${emitExpression(stmt.test)}:`];
      for (const s of stmt.body) lines.push(indent(emitStatement(s)));
      return lines.join('\n');
    }
    case 'ForIn': {
      const lines: string[] = [
        `for ${aliasIdentifier(stmt.target.name)} in ${emitExpression(stmt.iterable)}:`,
      ];
      for (const s of stmt.body) lines.push(indent(emitStatement(s)));
      return lines.join('\n');
    }
    case 'ClassDef': {
      const lines: string[] = [`class ${aliasIdentifier(stmt.name)}:`];
      for (const s of stmt.body) lines.push(indent(emitStatement(s)));
      return lines.join('\n');
    }
  }
}

export interface EmitProgramOptions {
  /** When true (default), prepend collected imports. */
  emitProgram?: boolean;
  /** Runtime preamble (e.g. the temporal runtime) inserted after imports. */
  preamble?: string;
}

export function emitProgram(
  program: Program,
  imports: string[] = [],
  options: EmitProgramOptions = {},
): string {
  const withImports = options.emitProgram !== false;
  const lines: string[] = [];
  if (withImports && imports.length > 0) {
    lines.push(...imports);
    lines.push('');
  }
  if (withImports && options.preamble) {
    lines.push(options.preamble);
    lines.push('');
  }
  program.body.forEach((stmt, i) => {
    // Set top-level function/class definitions off with a blank line for
    // readability; formatPython() collapses any runs this produces.
    const isBlock = stmt.type === 'FunctionDef' || stmt.type === 'ClassDef';
    if (isBlock && i > 0) lines.push('');
    lines.push(emitStatement(stmt));
    if (isBlock && i < program.body.length - 1) lines.push('');
  });
  return lines.join('\n') + '\n';
}
