"""Deliberate mutations for EMLP-AUDIT-003 and 004 v2.

Each drill restores ONE piece of the pre-patch behaviour, or applies one
tempting over-fix, and records which tests actually go red. A drill that stays
green is a finding about the test, not a pass.

Per EMLP-RELAY-0044 the class-namespace gates must be SEPARABLY drillable: D10
"single assignment target" can no longer stand for the whole namespace.
"""
import io, os, re, subprocess, sys

ROOT = r"D:\Ai\work together\EML"
EMIT = os.path.join(ROOT, "packages", "transpiler-python", "src", "emitter.ts")
TESTS = ["tests/emlp-audit-003-matrix.test.ts", "tests/emlp-audit-004-binder.test.ts"]

DRILLS = [
    # ---- 003, seven mutations (unchanged from the VERIFIED_FIXED round) ----
    ("D1  binary: nonAssoc back to -,/,% only",
     "      const nonAssoc = true;",
     "      const nonAssoc = expr.op === '-' || expr.op === '/' || expr.op === '%';"),
    ("D2  comparison: drop orEqual on the LEFT operand",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5, true)}`;",
     "return `${child(expr.left, 5)} ${expr.op} ${child(expr.right, 5, true)}`;"),
    ("D3  comparison: drop orEqual on the RIGHT operand",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5, true)}`;",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5)}`;"),
    ("D4  comparison: drop orEqual on BOTH (the original defect)",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5, true)}`;",
     "return `${child(expr.left, 5)} ${expr.op} ${child(expr.right, 5)}`;"),
    ("D5  membership: ELEMENT back to bare emitExpression",
     "return `${child(expr.element, 5, true)} in ${child(expr.collection, 5, true)}`;",
     "return `${emitExpression(expr.element)} in ${child(expr.collection, 5, true)}`;"),
    ("D6  membership: COLLECTION back to bare emitExpression",
     "return `${child(expr.element, 5, true)} in ${child(expr.collection, 5, true)}`;",
     "return `${child(expr.element, 5, true)} in ${emitExpression(expr.collection)}`;"),
    ("D7  membership: BOTH back to bare (the original defect)",
     "return `${child(expr.element, 5, true)} in ${child(expr.collection, 5, true)}`;",
     "return `${emitExpression(expr.element)} in ${emitExpression(expr.collection)}`;"),

    # ---- 004 v2, one mutation per binder kind ----
    ("D8  004: class ASSIGNMENT target back to unconditional alias",
     "  if (target.type === 'Identifier') return emitName(target.name);",
     "  if (target.type === 'Identifier') return aliasIdentifier(target.name);"),
    ("D9  004: bare Identifier READ back to unconditional alias  (the v1 regression)",
     "    case 'Identifier':\n      return emitName(expr.name);",
     "    case 'Identifier':\n      return aliasIdentifier(expr.name);"),
    ("D10 004: class FOR binder back to unconditional alias",
     "`for ${emitName(stmt.target.name)} in ${emitExpression(stmt.iterable)}:`,",
     "`for ${aliasIdentifier(stmt.target.name)} in ${emitExpression(stmt.iterable)}:`,"),
    ("D11 004: class WITH binder back to unconditional alias",
     "? `with ${emitExpression(stmt.contextExpr)} as ${emitName(stmt.target.name)}:`",
     "? `with ${emitExpression(stmt.contextExpr)} as ${stmt.target.name}:`"),
    ("D12 004: EXCEPT binder back to raw",
     "? `except ${h.exceptionType} as ${emitName(h.name)}:`",
     "? `except ${h.exceptionType} as ${h.name}:`"),
    ("D13 004: method/class NAME back to unconditional alias",
     "lines.push(`${kw} ${emitName(stmt.name)}(${params}):`);",
     "lines.push(`${kw} ${aliasIdentifier(stmt.name)}(${params}):`);"),
    ("D14 004: never open a class scope at all",
     "      scopeStack.push({ kind: 'class', names });",
     "      scopeStack.push({ kind: 'function' });"),
    ("D15 004 OVER-fix: suppress aliasing for EVERY name in a class body",
     "  return top !== undefined && top.kind === 'class' && top.names.has(name);",
     "  return top !== undefined && top.kind === 'class';"),
    ("D16 004 OVER-fix: alias the decorator keyword too",
     "(a.name !== undefined ? `${a.name}=${emitExpression(a.value)}`",
     "(a.name !== undefined ? `${aliasIdentifier(a.name)}=${emitExpression(a.value)}`"),
    ("D17 004: drop the method-body scope reset",
     "      scopeStack.push({ kind: 'function' });\n      try {\n        for (const s of stmt.body) lines.push(indent(emitStatement(s)));",
     "      try {\n        for (const s of stmt.body) lines.push(indent(emitStatement(s)));"),
]

pristine = io.open(EMIT, encoding="utf-8").read()


def run_tests():
    p = subprocess.run(["npx", "vitest", "run"] + TESTS, cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", shell=True)
    out = re.sub(r"\x1b\[[0-9;]*m", "", (p.stdout or "") + (p.stderr or ""))
    reds = [l.strip() for l in out.split("\n") if l.strip().startswith("x ") or l.strip().startswith("\u00d7")]
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if not m:
        m2 = re.search(r"(Failed Suites|Transform failed|no tests)", out)
        return ["BROKEN: " + (m2.group(0) if m2 else "unparsed")], "?"
    return reds, m.group(0)


print("=== CONTROL: patched v2, unmutated ===")
reds, tally = run_tests()
print("   %s   red=%d" % (tally, len(reds)))
print()

for label, old, new in DRILLS:
    s = io.open(EMIT, encoding="utf-8").read()
    if s.count(old) != 1:
        print("%s\n   SKIPPED (site count %d)\n" % (label, s.count(old)))
        continue
    io.open(EMIT, "w", encoding="utf-8", newline="").write(s.replace(old, new))
    reds, tally = run_tests()
    io.open(EMIT, "w", encoding="utf-8", newline="").write(pristine)
    print(label)
    print("   %s" % tally)
    for r in reds:
        print("     %s" % r[:100])
    print()

print("restored byte-identical:", io.open(EMIT, encoding="utf-8").read() == pristine)
