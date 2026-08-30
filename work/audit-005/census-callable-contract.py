# -*- coding: utf-8 -*-
"""EMLP-AUDIT-005 — callable-contract census, per EMLP-RELAY-0078 §6.

Read-only with respect to the product: this script mutates the worktree copy to
produce deliberate reds and restores it byte-for-byte, and no candidate fix is
proposed here. v4 waits until this table is reviewed.

What it answers, and what it cannot:

    it enumerates every non-comment site in the interpreter matching the
    patterns 0078 §3 names, maps each to a branch or to an explicit exclusion,
    and then BREAKS each observable on purpose to show which cells notice.

    a break that reds nothing is a cell claiming coverage it does not have.
    That is the whole point of the exercise: 0076 exists because a row named
    CONTROL proved the guard rejects and threw the message away, so three
    rounds of message rows never reached the second constructor path.

Every number the handback quotes is printed by this run. 0070 §5.
"""
import hashlib, io, json, os, re, shutil, subprocess, sys
NEWLINE = chr(10)

ROOT = r"D:\Ai\work together\EML-wt-audit005"
SRC = os.path.join(ROOT, "packages", "interp", "src", "index.ts")
OUT = r"D:\Ai\work together\EML-P_Board\work\audit-005"
PRISTINE = os.path.join(OUT, "_pristine-census.ts")
os.chdir(ROOT)
JSONOUT = os.path.join(OUT, "_census-vitest.json")
KW = dict(capture_output=True, text=True, shell=True, encoding="utf-8", errors="replace")

# The four gates. GATES_OLD is the population BEFORE 0076's file existed; it is
# run alongside so a break can be shown to be invisible to it.
GATES_OLD = ["tests/user-function-arity.test.ts",
             "tests/user-function-arity-identity.test.ts",
             "tests/user-function-arity-nesting.test.ts"]
GATES_ALL = GATES_OLD + ["tests/user-function-arity-constructor.test.ts"]

# 0078 §3's list, plus `missing` which only appears inside the composer.
# EMLP-RELAY-0078 section 3's nine, verbatim. An earlier run of this script
# carried eight: the comment claimed `missing` was included and the list did
# not have it. `missing` is the word the composer is built out of, and it is
# also the only pattern that reaches `need()` at 1439.
PATTERNS = ["params.length", "args.length", "arityError", "takes no arguments",
            "positional argument", "missing", "instantiateClass", "runMethodBody",
            "callMethod"]

# site -> (branch id, what it decides). Every non-comment hit must land in here
# or in EXCLUDED, or the closure claim fails.
SITES = {
    193: ("S4", "composer: the missing-parameter NAMES"),
    195: ("S4", "composer: one missing name"),
    196: ("S4", "composer: one missing name"),
    197: ("S4", "composer: two names"),
    198: ("S4", "composer: two names joined with `and`"),
    199: ("S4", "composer: three or more, Oxford comma"),
    203: ("S4", "composer: the noun pluralises independently of the count"),
    186: ("S4", "arityError composer — the shared message for S1 and S3"),
    191: ("S4", "composer: equal-count fast path"),
    192: ("S4", "composer: missing branch"),
    202: ("S4", "composer: missing message text"),
    209: ("S4", "composer: surplus message text"),
    663: ("S1", "plain / @hot / @cold FunctionDef frame — arity decision"),
    783: ("S2", "no-__init__ constructor — the arity DECISION itself"),
    784: ("S2", "no-__init__ constructor guard — its OWN hand-written message"),
    827: ("S3", "runMethodBody frame — arity decision, receiver counted"),
    633: ("B1", "dispatch: attribute call -> callMethod"),
    647: ("B2", "dispatch: class value -> instantiateClass"),
    771: ("B2", "instantiateClass definition"),
    782: ("B3", "dispatch: explicit __init__ -> runMethodBody"),
    791: ("B1", "callMethod definition"),
    796: ("B1", "callMethod -> runMethodBody"),
    810: ("B4", "runMethodBody definition"),
    701: ("S1", "@cold cache key — uses args.length, decides nothing about arity"),
    1156: ("B5", "with protocol: __enter__ -> runMethodBody"),
    1160: ("B6", "with protocol: __exit__ normal -> runMethodBody"),
    1171: ("B7", "with protocol: __exit__ exception -> runMethodBody"),
    1179: ("B6", "with protocol: __exit__ normal (second site) -> runMethodBody"),
}
EXCLUDED = {
    653: ("exception construction", "ValueError(1,2,3) is legal in CPython — BaseException "
          "takes *args, measured: .args == (1, 2, 3). No arity check is correct here."),
    1117: ("exception construction", "same path reached from `raise`; same measurement."),
    882: ("builtin", "set() — inside callBuiltin; builtins are EMLP-AUDIT-006, per 0078 §3."),
    910: ("builtin", "str() — inside callBuiltin; 006."),
    1439: ("builtin", "need() — a module-level arity helper composing its own message; "
           "all 5 call sites (863, 870, 911, 920, 928) are inside callBuiltin, so 006."),
    1441: ("builtin", "need()'s message itself; same 5 callers."),
    1447: ("builtin", "min/max — inside callBuiltin; 006."),
}

_NL = chr(10)
_G = ['    {', '      const arity = arityError(qualifiedName, method.params, args.length + 1);', '      if (arity) throw arity;', '    }']
_P = ['    if (++depth > RECURSION_LIMIT) {', '      depth--;', "      throw new PyError('RecursionError', 'maximum recursion depth exceeded');", '    }', '    tick();', "    emitter.emit('eml:call', { fn: qualifiedName, args: args.map(pyRepr), temperature: 'neutral' });"]
_G2 = ['    {', '      const arity = arityError(qualifiedName, method.params, args.length + 1);', '      if (arity) { depth--; throw arity; }', '    }']

_S1G = "    if (arity && fn.temperature !== 'cold') throw arity;\n"
_EMIT = "    emitter.emit('eml:call', { fn: name, args: args.map(pyRepr), temperature: fn.temperature ?? 'neutral' });\n"
# (id, observable, site, find, replace) — each break must red at least one cell.
BREAKS = [
 ("K1", "acceptance/type", "S1",
  "    if (arity && fn.temperature !== 'cold') throw arity;\n", ""),
 ("K2", "identity", "S1",
  "arityError(qualnames.get(fn) ?? callee.name, fn.params, args.length)",
  "arityError(name, fn.params, args.length)"),
 ("K3", "order", "S1",
  "    if (arity && fn.temperature !== 'cold') throw arity;\n",
  "    if (arity) throw arity;\n"),
 ("K4", "exact message", "S2",
  "`${cls.name}() takes no arguments (${args.length} given)`",
  "`BROKEN-NO-INIT-MESSAGE`"),
 ("K5", "identity", "S2",
  "`${cls.name}() takes no arguments (${args.length} given)`",
  "`${classQualnames.get(def) ?? cls.name}() takes no arguments`"),
 ("K6", "acceptance/type", "S3",
  "      const arity = arityError(qualifiedName, method.params, args.length + 1);\n"
  "      if (arity) throw arity;\n", ""),
 ("K7", "protocol counts", "S3",
  "arityError(qualifiedName, method.params, args.length + 1)",
  "arityError(qualifiedName, method.params, args.length)"),
 ("K8", "identity", "S3",
  "    const qualifiedName = `${owner}.${method.name}`;",
  "    const qualifiedName = `${instance.className}.${method.name}`;"),
 ("K9", "exact message", "S4",
  "missing.length === 1 ? '' : 's'", "'s'"),
 ("K10", "exact message", "S4",
  "`${missing.slice(0, -1).join(', ')}, and ${missing[missing.length - 1]}`",
  "`${missing.join(' and ')}`"),
 # S2's acceptance decision, which the site table first omitted: 783 is the
 # predicate, 784 only its message. Mapping the message and not the predicate
 # is the same half-a-population mistake 0078 is about.
 ("K11", "acceptance/type", "S2",
  "} else if (args.length > 0) {", "} else if (false) {"),
 # S3's ordering IS observable: the guard sits above depth++, tick() and the
 # eml:call emission. `depth--` is carried into the moved block so the only
 # difference is WHEN the guard fires, not a leaked counter.
 # S3 order IS observable: the guard sits above depth++, tick() and the
 # eml:call emission. `depth--` rides along into the moved block so the only
 # difference is WHEN the guard fires, not a leaked counter.
 # K13 isolates ONE order sub-observable 0078 section 4 names separately from
 # the @cold hash that K3 covers: whether the plain/@hot guard fires before
 # eml:call. Only the non-cold throw moves; the @cold one at the cache miss
 # stays put, so a red here can only be about this ordering.
 ("K13", "order", "S1", [_S1G, _EMIT],
  ["", _EMIT + "    if (arity && fn.temperature !== 'cold') { depth--; throw arity; }" + _NL]),
 ("K12", "order", "S3", _NL.join(_G + _P) + _NL, _NL.join(_P + _G2) + _NL),
]


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def run(gates):
    """(failed, passed, {fullName of every failing cell}).

    Counts alone cannot answer this census. The 62-cell control is already
    5 red — 0076's defect is live — so a break that reports "5 red" may be
    reddening the SAME five and proving nothing. Only the set difference
    against the control says whether a break discriminates.
    """
    subprocess.run(["npx", "vitest", "run"] + gates +
                   ["--reporter=json", "--outputFile=" + JSONOUT], **KW)
    try:
        d = json.load(io.open(JSONOUT, encoding="utf-8"))
    except Exception:
        return -1, -1, set()
    bad, good = set(), 0
    for f in d.get("testResults", []):
        for a in f.get("assertionResults", []):
            if a.get("status") == "failed":
                bad.add(a.get("fullName") or a.get("title"))
            elif a.get("status") == "passed":
                good += 1
    return len(bad), good, bad


# ---- 1. the full-text census -------------------------------------------------
lines = io.open(SRC, encoding="utf-8").read().split("\n")
hits = {}
for i, l in enumerate(lines, 1):
    s = l.strip()
    if s.startswith("//") or s.startswith("*"):
        continue
    for pat in PATTERNS:
        if pat in l:
            hits.setdefault(i, []).append(pat)

mapped = [i for i in hits if i in SITES]
excluded = [i for i in hits if i in EXCLUDED]
unmapped = [i for i in hits if i not in SITES and i not in EXCLUDED]

print("=" * 74)
print("CENSUS — every non-comment site matching 0078 section 3's patterns")
print("=" * 74)
print("  hits           %d" % len(hits))
print("  mapped         %d" % len(mapped))
print("  excluded       %d  (with a measured reason, listed below)" % len(excluded))
print("  UNMAPPED       %d  %s" % (len(unmapped), sorted(unmapped) if unmapped else ""))
print()
for i in sorted(mapped):
    b, what = SITES[i]
    print("  %-5s line %-5d %s" % (b, i, what))
print()
for i in sorted(excluded):
    kind, why = EXCLUDED[i]
    print("  EXCL  line %-5d %-22s %s" % (i, kind, why[:60]))
print()

# ---- 2. deliberate breaks -----------------------------------------------------
#
# S2's message and identity cannot be shown red by breaking them: 0076's defect
# is live, so those five cells are ALREADY red and a break cannot make a failing
# cell fail harder. To measure them at all, the run below first applies the
# one-string CPython value as a PROBE — a temporary mutation, restored with the
# rest, proposed as nothing. Under that probe the whole 62 go green, and only
# then does breaking the string produce a red that means something.
#
# This is not v4. No candidate, no patch, no product edit; the worktree is
# restored byte-for-byte and the hash is printed.
S2_LIVE = "`${cls.name}() takes no arguments (${args.length} given)`"
S2_CPY = "`${cls.name}() takes no arguments`"

shutil.copyfile(SRC, PRISTINE)
base = sha(SRC)
c50f, c50p, c50 = run(GATES_OLD)
c62f, c62p, c62 = run(GATES_ALL)
print("=" * 74)
print("BREAKS — measured against the control SET, not against zero")
print("=" * 74)
print("  control, gates before 0076 (50 cells)   %d failed | %d passed" % (c50f, c50p))
print("  control, all four gates    (62 cells)   %d failed | %d passed" % (c62f, c62p))
print()
if (c50f, c62f) != (0, 5):
    print("  control is not 0/5; the table below would be unreadable")
    shutil.copyfile(PRISTINE, SRC); sys.exit(2)

# the probe: S2 message set to the measured CPython string
probe = io.open(PRISTINE, encoding="utf-8").read()
assert probe.count(S2_LIVE) == 1
io.open(SRC, "w", encoding="utf-8", newline=NEWLINE).write(probe.replace(S2_LIVE, S2_CPY, 1))
p62f, p62p, p62 = run(GATES_ALL)
print("  PROBE — S2 message set to the measured CPython string, so S2's cells")
print("          start green and a break on them can mean something")
print("          all four gates: %d failed | %d passed" % (p62f, p62p))
print()
if p62f != 0:
    print("  probe did not reach 62/62; S2 breaks below are unreadable")

rows = []
for kid, obs, site, find, repl in BREAKS:
    on_probe = site == "S2" and obs in ("exact message", "identity")
    src0 = probe.replace(S2_LIVE, S2_CPY, 1) if on_probe else probe
    ctrl_all, ctrl_old = (p62, c50) if on_probe else (c62, c50)
    hay = src0
    look = find.replace(S2_LIVE, S2_CPY) if on_probe else find
    put = repl.replace(S2_LIVE, S2_CPY) if on_probe else repl
    pairs = list(zip(look, put)) if isinstance(look, list) else [(look, put)]
    bad = [f for f, _ in pairs if hay.count(f) != 1]
    if bad:
        print("  !! %-4s anchor not unique (%d parts)" % (kid, len(bad)))
        rows.append((kid, obs, site, on_probe, -1, -1, [])); continue
    for f, r_ in pairs:
        hay = hay.replace(f, r_, 1)
    io.open(SRC, "w", encoding="utf-8", newline=NEWLINE).write(hay)
    of, _, oset = run(GATES_OLD)
    af, _, aset = run(GATES_ALL)
    new_all = sorted(aset - ctrl_all)
    new_old = sorted(oset - ctrl_old)
    rows.append((kid, obs, site, on_probe, len(new_old), len(new_all), new_all))
    print("  %-4s %-16s %-4s %-7s NEW red: 50-cell %2d   62-cell %2d %s"
          % (kid, obs, site, "probe" if on_probe else "", len(new_old), len(new_all),
             "  <-- DISCRIMINATES NOTHING" if not new_all else ""))

shutil.copyfile(PRISTINE, SRC)
after = sha(SRC)
pf, pp, _ = run(GATES_ALL)
print()
print("  pristine sha256 %s -> restored %s  %s"
      % (base[:16], after[:16], "IDENTICAL" if after == base else "DIFFERS"))
print("  post-restore, 62 cells: %d failed | %d passed" % (pf, pp))

blind = [r for r in rows if r[5] == 0]
print("  breaks that add NO new red (the observable is NotMeasured): %s"
      % (", ".join("%s %s/%s" % (r[0], r[1], r[2]) for r in blind) if blind else "none"))
inv = [r for r in rows if r[4] == 0 and r[5] > 0]
print("  breaks the 50-cell gate could NOT see: %s"
      % (", ".join("%s %s/%s" % (r[0], r[1], r[2]) for r in inv) if inv else "none"))

io.open(os.path.join(OUT, "census-callable-contract.json"), "w", encoding="utf-8", newline=NEWLINE).write(
    json.dumps({"hits": {str(k): v for k, v in hits.items()},
                "mapped": sorted(mapped), "excluded": sorted(excluded), "unmapped": sorted(unmapped),
                "control_50": [c50f, c50p], "control_62": [c62f, c62p],
                "control_62_failing": sorted(c62), "probe_62": [p62f, p62p],
                "breaks": [{"id": a, "observable": b, "site": c, "on_probe": d,
                            "new_red_50": e, "new_red_62": f, "new_cells": g}
                           for a, b, c, d, e, f, g in rows],
                "pristine_sha256": base, "restored_sha256": after,
                "post_restore": [pf, pp]}, ensure_ascii=False, indent=2))
os.remove(PRISTINE)
print(NEWLINE + "census-callable-contract.json")
