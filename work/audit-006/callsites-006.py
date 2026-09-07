# -*- coding: utf-8 -*-
"""Count TOP-LEVEL arguments at every builtin call site in the corpus.

A regex cannot do this. `int((a-b)/c)` and `def add_int(n, cent_i)` both contain
"int(" followed by a comma and neither is a two-argument int call. Two further
traps, both of which this counter got wrong on its first run and both of which
are recorded here because the wrong version produced plausible numbers:

  1. an argument that is ENTIRELY bracketed - min([a, b, c]) - never set the
     "an argument was present" flag, so it was reported as zero arguments;
  2. `{` and `}` were not tracked, so sum({1, 2, 3}) leaked the set literal's
     commas to depth 1 and was reported as three arguments.

String literals are removed before scanning: the corpus prints prose ABOUT
builtins, so `"sum() of an empty list"` is not a call site.
"""
import io, os, re, sys

BUILTINS = ("int", "str", "float", "abs", "len", "repr", "sum", "min", "max", "set")
NL = chr(10)
OPEN, CLOSE = "([{", ")]}"

def strip_code(src):
    out = []
    for line in src.split(NL):
        if line.lstrip().startswith("#"):
            continue
        out.append(re.sub(r'"[^"]*"', '""', line))
    return NL.join(out)

def argc(src, i):
    depth, args, seen = 0, 1, False
    while i < len(src):
        c = src[i]
        if depth == 1 and not c.isspace() and c != ",":
            seen = True
        if c in OPEN:
            depth += 1
        elif c in CLOSE:
            depth -= 1
            if depth == 0:
                return args if seen else 0
        elif c == "," and depth == 1:
            args += 1
        i += 1
    return -1

def main(root):
    counts, witness = {}, {}
    progs = 0
    for d in sorted(os.listdir(root)):
        p = os.path.join(root, d)
        if not os.path.isdir(p) or d.startswith("phase"):
            continue
        for f in os.listdir(p):
            if not f.endswith(".eml"):
                continue
            progs += 1
            src = strip_code(io.open(os.path.join(p, f), encoding="utf-8", errors="replace").read())
            for b in BUILTINS:
                for m in re.finditer(r"(?<![A-Za-z0-9_])" + b + r"\s*\(", src):
                    if src[max(0, m.start() - 4):m.start()].endswith("def "):
                        continue
                    n = argc(src, m.end() - 1)
                    counts[(b, n)] = counts.get((b, n), 0) + 1
                    if n != 1:
                        witness.setdefault((b, n), []).append(
                            d + ": " + src[m.start():m.start() + 46].split(NL)[0])
    print("call sites across %d corpus programs" % progs)
    for b in BUILTINS:
        row = sorted((n, c) for (bb, n), c in counts.items() if bb == b)
        if row:
            print("  %-6s %s" % (b, "   ".join("%d:%d" % (n, c) for n, c in row)))
    print()
    print("witnesses for every count other than one argument:")
    for k in sorted(witness):
        print("  %s(%d args) x%d" % (k[0], k[1], len(witness[k])))
        for e in witness[k][:2]:
            print("     " + e[:76])
    print()
    for b, label in (("int", "int with a base"), ("str", "str with 2+"), ("set", "set with 2+")):
        n = sum(c for (bb, k), c in counts.items() if bb == b and k >= 2)
        print("  %-18s : %d" % (label, n))

main(sys.argv[1] if len(sys.argv) > 1 else "examples")
