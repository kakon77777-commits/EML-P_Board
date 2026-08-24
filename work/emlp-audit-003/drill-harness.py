"""Deliberate mutations for EMLP-AUDIT-003/004.

Each drill restores ONE piece of the pre-patch behaviour and records which
tests actually go red. A drill that stays green is a finding about the test,
not a pass.
"""
import io, os, subprocess, sys, re

ROOT = r"D:\Ai\work together\EML"
EMIT = os.path.join(ROOT, "packages", "transpiler-python", "src", "emitter.ts")
TESTS = ["tests/emlp-audit-003-matrix.test.ts", "tests/emlp-audit-004-binder.test.ts"]

DRILLS = [
    ("D1 binary: nonAssoc back to -,/,% only",
     "      const nonAssoc = true;",
     "      const nonAssoc = expr.op === '-' || expr.op === '/' || expr.op === '%';"),
    ("D2 comparison: drop orEqual on the LEFT operand",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5, true)}`;",
     "return `${child(expr.left, 5)} ${expr.op} ${child(expr.right, 5, true)}`;"),
    ("D3 comparison: drop orEqual on the RIGHT operand",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5, true)}`;",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5)}`;"),
    ("D4 comparison: drop orEqual on BOTH operands (the original defect)",
     "return `${child(expr.left, 5, true)} ${expr.op} ${child(expr.right, 5, true)}`;",
     "return `${child(expr.left, 5)} ${expr.op} ${child(expr.right, 5)}`;"),
    ("D5 membership: ELEMENT back to a bare emitExpression",
     "return `${child(expr.element, 5, true)} in ${child(expr.collection, 5, true)}`;",
     "return `${emitExpression(expr.element)} in ${child(expr.collection, 5, true)}`;"),
    ("D6 membership: COLLECTION back to a bare emitExpression",
     "return `${child(expr.element, 5, true)} in ${child(expr.collection, 5, true)}`;",
     "return `${child(expr.element, 5, true)} in ${emitExpression(expr.collection)}`;"),
    ("D7 membership: BOTH back to bare (the original defect)",
     "return `${child(expr.element, 5, true)} in ${child(expr.collection, 5, true)}`;",
     "return `${emitExpression(expr.element)} in ${emitExpression(expr.collection)}`;"),
    ("D8 004: except binder back to raw",
     "? `except ${h.exceptionType} as ${aliasIdentifier(h.name)}:`",
     "? `except ${h.exceptionType} as ${h.name}:`"),
    ("D9 004: with binder back to raw",
     "? `with ${emitExpression(stmt.contextExpr)} as ${aliasIdentifier(stmt.target.name)}:`",
     "? `with ${emitExpression(stmt.contextExpr)} as ${stmt.target.name}:`"),
    ("D10 004: remove class-attribute suppression",
     "return classBodyDepth > 0 ? target.name : aliasIdentifier(target.name);",
     "return aliasIdentifier(target.name);"),
    ("D11 004 OVER-fix: alias the decorator keyword too",
     "(a.name !== undefined ? `${a.name}=${emitExpression(a.value)}`",
     "(a.name !== undefined ? `${aliasIdentifier(a.name)}=${emitExpression(a.value)}`"),
]

pristine = io.open(EMIT, encoding="utf-8").read()
io.open(os.path.join(os.path.dirname(sys.argv[0]), "emitter.pristine.ts"), "w",
        encoding="utf-8", newline="").write(pristine)

def run_tests():
    p = subprocess.run(["npx", "vitest", "run"] + TESTS, cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace", shell=True)
    out = re.sub(r"\x1b\[[0-9;]*m", "", (p.stdout or "") + (p.stderr or ""))
    reds = [l.strip() for l in out.split("\n") if l.strip().startswith("×")]
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    return reds, (m.group(0) if m else "?")

print("=== CONTROL: patched, unmutated ===")
reds, tally = run_tests()
print("   %s   red=%d" % (tally, len(reds)))
print()

for label, old, new in DRILLS:
    s = io.open(EMIT, encoding="utf-8").read()
    if s.count(old) != 1:
        print("%-52s SKIPPED (site count %d)" % (label, s.count(old)))
        continue
    io.open(EMIT, "w", encoding="utf-8", newline="").write(s.replace(old, new))
    reds, tally = run_tests()
    io.open(EMIT, "w", encoding="utf-8", newline="").write(pristine)
    print("%s" % label)
    print("   %s" % tally)
    for r in reds:
        print("     %s" % r[:104])
    print()

final = io.open(EMIT, encoding="utf-8").read()
print("restored byte-identical:", final == pristine)
