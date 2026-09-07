# -*- coding: utf-8 -*-
"""EMLP-AUDIT-006 candidate — the 19 census mutations re-anchored, per 0097 §3.5.

Every mutation from the census battery is carried over BY SEMANTICS, not by
anchor text. Where the candidate removed or rewrote the line a mutation used to
attach to, the row is marked RE-ANCHORED and an equivalent break is supplied
against the new code. An anchor that no longer applies is not a pass: it is a
mutation that was not measured, and the run exits non-zero if any is skipped.

The candidate's gate must go RED for all nineteen. On the pre-candidate tree,
thirteen of them were NOT CAUGHT.
"""
import hashlib, io, json, os, re, subprocess, sys

NL = chr(10)
ROOT = r"D:\Ai\work together\EML-wt-audit006"
SRC = os.path.join(ROOT, "packages", "interp", "src", "index.ts")
OUT = r"D:\Ai\work together\EML-P_Board\work\audit-006"
GATE = "tests/builtin-shapes.test.ts"
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace", cwd=ROOT)

# (id, whether the census anchor survived, label, find, replace)
MUTATIONS = [
    # ---- anchors unchanged by the candidate -------------------------------
    ("C1", "same", "abs of a float loses its sign handling",
     "if (a.k === 'float') return FLOAT(Math.abs(a.v));",
     "if (a.k === 'float') return FLOAT(a.v);"),
    ("C2", "same", "int stops truncating toward zero",
     "if (a.k === 'float') return INT(BigInt(Math.trunc(a.v)));",
     "if (a.k === 'float') return INT(BigInt(Math.round(a.v)));"),
    ("C3", "same", "min/max of one argument stops iterating it",
     "    const it = iterableItems(args[0]!);\n    if (!it) throw new PyError('TypeError', `'${typeName(args[0]!)}' object is not iterable`);\n    items = it;",
     "    items = args;"),
    ("C4", "same", "sum stops refusing a string start",
     "          throw new PyError('TypeError', \"sum() can't sum strings [use ''.join(seq) instead]\");",
     "          return start;"),
    ("C5", "same", "len stops sharing iterableItems",
     "        const items = iterableItems(a);\n        if (items) return INT(BigInt(items.length));",
     "        const items = a.k === 'list' ? a.v : null;\n        if (items) return INT(BigInt(items.length));"),
    ("N3", "same", "min/max empty-iterable raises the other exception type",
     "  if (items.length === 0) throw new PyError('ValueError', `${name}() iterable argument is empty`);",
     "  if (items.length === 0) throw new PyError('TypeError', `${name}() iterable argument is empty`);"),
    ("N5", "same", "float's zero-argument default changes",
     "        const a = args[0] ?? FLOAT(0);",
     "        const a = args[0] ?? FLOAT(1);"),
    ("N10", "same", "str's zero-argument default stops being the empty string",
     "        if (args.length === 0) return STR('');",
     "        if (args.length === 0) return STR('x');"),

    # ---- RE-ANCHORED: the census anchor is gone from the candidate ---------
    # N1/N2 attacked need(), which four builtins shared for their zero-argument
    # rejection. checkArity now decides arity before any body runs, so need()'s
    # undefined branch is unreachable for them. The SEMANTICS - "the shared
    # rejection stops rejecting" and "the shared message becomes a literal" -
    # move to checkArity, which is where the sharing now lives.
    ("N1", "re-anchored", "the shared arity rejection stops rejecting",
     "        if (n !== 1) throw new PyError('TypeError', `${name}() takes exactly one argument (${n} given)`);",
     "        if (false) throw new PyError('TypeError', `${name}() takes exactly one argument (${n} given)`);"),
    ("N2", "re-anchored", "the shared arity message becomes a literal",
     "`${name}() takes exactly one argument (${n} given)`",
     "'bad arity'"),
    # N4 attacked int's silently-ignored second argument. The candidate defers
    # on exactly two arguments, so the equivalent break is dropping that defer -
    # which restores the old wrong VALUE.
    ("N4", "re-anchored", "int stops deferring on a base and silently ignores it again",
     "        if (args.length === 2) {\n          throw new Unsupported('int(x, base)', 'the base argument is not modeled yet');\n        }",
     "        if (false) {\n          throw new Unsupported('int(x, base)', 'the base argument is not modeled yet');\n        }"),
    # N4b attacked the three-argument surplus, which is now decided in checkArity.
    ("N4b", "re-anchored", "int's three-argument surplus stops being rejected",
     "        if (n > 2) throw new PyError('TypeError', `int expected at most 2 arguments, got ${n}`);",
     "        if (n > 3) throw new PyError('TypeError', `int expected at most 2 arguments, got ${n}`);"),
    # N6/N7/N8/N11 attacked the single `args.length > 0` line that used to serve
    # all of set's contracts. The candidate splits it into four regions, so each
    # mutation re-anchors onto the region it was really about.
    ("N6", "re-anchored", "set stops declining an iterable and answers instead",
     "        throw new Unsupported('set(iterable)', 'converting an iterable to a set is not modeled yet');",
     "        return SET([]);"),
    ("N7", "re-anchored", "set's non-iterable check disappears",
     "        if (!iterableItems(sa)) throw new PyError('TypeError', `'${typeName(sa)}' object is not iterable`);",
     "        if (false) throw new PyError('TypeError', `'${typeName(sa)}' object is not iterable`);"),
    ("N8", "re-anchored", "set's designed defer becomes an arity TypeError",
     "        if (args.length === 0) return SET([]);",
     "        if (args.length === 0) return SET([]);\n        throw new PyError('TypeError', 'set expected at most 1 argument');"),
    ("N11", "re-anchored", "set returns empty for a NON-iterable instead of refusing",
     "        if (!iterableItems(sa)) throw new PyError('TypeError', `'${typeName(sa)}' object is not iterable`);",
     "        if (!iterableItems(sa)) return SET([]);"),
    # N13 is the property 0097 §3.3 names: the arity decision must not be
    # swallowed by the conversion path. Moving set's arity threshold by one lets
    # set(1,2) fall into the body and be answered as a conversion question.
    ("N13", "re-anchored", "set's arity decision is swallowed by the conversion path",
     "        if (n > 1) throw new PyError('TypeError', `set expected at most 1 argument, got ${n}`);",
     "        if (n > 2) throw new PyError('TypeError', `set expected at most 1 argument, got ${n}`);"),
    # N9 attacked str reading its second argument. The candidate defers on 2-3,
    # so the equivalent break is dropping that defer - which restores the old
    # behaviour of answering with the first argument.
    ("N9", "re-anchored", "str stops deferring the decoding path and answers with arg 0",
     "        if (args.length >= 2) {\n          throw new Unsupported('str(object, encoding[, errors])', 'the bytes decoding path is not modeled yet');\n        }",
     "        if (false) {\n          throw new Unsupported('str(object, encoding[, errors])', 'the bytes decoding path is not modeled yet');\n        }"),
    # N12 is the bad-fix mutation that makes repr(42) load-bearing.
    ("N12", "re-anchored", "a repr arity fix also rejects the legal single argument",
     "      case 'abs': case 'len': case 'repr':",
     "      case 'abs': case 'len':\n      case 'repr':\n        throw new PyError('TypeError', `${name}() takes exactly one argument (${n} given)`);\n      case '__never__':"),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run_gate():
    r = subprocess.run(["npx", "vitest", "run", GATE, "--reporter=basic"], **KW)
    o = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", o)
    if not m:
        return -1, -1
    return int(m.group(1) or 0), int(m.group(2))


pristine_bytes = io.open(SRC, "rb").read()
pristine = pristine_bytes.decode("utf-8")
h0 = sha(SRC)
LF = chr(10)
CRLF = chr(13) + chr(10)
FILE_NL = CRLF if pristine_bytes.count(CRLF.encode()) else LF


def anchor(t):
    return t.replace(LF, FILE_NL) if FILE_NL != LF else t


cf, cp = run_gate()
print("=" * 88)
print("EMLP-AUDIT-006 CANDIDATE - all 19 census mutations must now go RED")
print("=" * 88)
print("  control (unmutated candidate)   %d failed | %d passed" % (cf, cp))
print()

rows, skipped, still_green = [], [], []
for mid, kind, label, find, repl in MUTATIONS:
    find, repl = anchor(find), anchor(repl)
    if pristine.count(find) != 1:
        print("  !! %-4s ANCHOR DID NOT MATCH (%d) - NOT MEASURED" % (mid, pristine.count(find)))
        rows.append({"id": mid, "kind": kind, "label": label, "failed": -1, "status": "NOT MEASURED"})
        skipped.append(mid)
        continue
    io.open(SRC, "wb").write(pristine.replace(find, repl, 1).encode("utf-8"))
    f, p = run_gate()
    caught = f > 0
    if not caught:
        still_green.append(mid)
    rows.append({"id": mid, "kind": kind, "label": label, "failed": f, "passed": p,
                 "status": "CAUGHT" if caught else "NOT CAUGHT"})
    print("  %-4s %-9s %-52s %3d failed  %s" % (mid, kind, label[:52], f,
                                                "CAUGHT" if caught else "NOT CAUGHT"))

io.open(SRC, "wb").write(pristine_bytes)
h1 = sha(SRC)
pf, pp = run_gate()
print()
print("  pristine sha256 %s -> restored %s  %s" % (h0[:16], h1[:16], "IDENTICAL" if h0 == h1 else "DIFFERS"))
print("  post-restore gate     %d failed | %d passed" % (pf, pp))
print("  caught %d of %d" % (len(rows) - len(skipped) - len(still_green), len(MUTATIONS)))
io.open(os.path.join(OUT, "mutations-006-candidate.json"), "w", encoding="utf-8", newline=NL).write(
    json.dumps(rows, ensure_ascii=False, indent=2))
print()
print("mutations-006-candidate.json")

if skipped or still_green:
    print()
    if skipped:
        print("  !! NOT MEASURED: %s - re-anchor these, they are not passes" % ", ".join(skipped))
    if still_green:
        print("  !! STILL GREEN: %s - the candidate does not guard these" % ", ".join(still_green))
    sys.exit(1)
