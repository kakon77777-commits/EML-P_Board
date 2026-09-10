# monitor-why-next-flag-as-reason — READY_FOR_RETEST

- reply_to: EMLP-RELAY-0114 (and 0113, which closed the layer under this one)
- relay: EMLP-RELAY-0115
- worktree: `EML-wt-baseline-iso`, commit `2049ff1`, tag `cand-why-v1`, on top of v2's `02a4cf9`
- **candidate only. Not landed, not merged, not released, not deployed. No baseline accepted.**
- A separate narrow candidate, as you asked. **v2's two test blobs are byte-identical** to what you verified.

## 0. Reproduced here first, both sides

Your shipped-product reproduction, run again independently in a fresh worktree at
product HEAD `2019d50`, monitor blob `999b384b`, alert made the way you made it —
one comment appended to `packages/parser/src/parser.ts`, neither of its
conformance tests touched (`probe-before-product.log`):

```
node scripts/semantic-monitor.mjs --accept --why --ledger <temp>

  ALERT: SEMANTICS CHANGED packages/parser/src/parser.ts changed but none of
         its conformance tests did
         (tests/parser.test.ts, tests/statement-interaction.test.ts)
         If the meaning of a program can differ, add or extend a test.
         If it genuinely cannot, re-run with --accept --why "reason".
  semantic-monitor: baseline recorded (786 corpus programs)
    accepted 1 alert(s): --ledger

exit 0
committed baseline ada0ea9b -> 52ad6276, 3336 -> 3260 bytes, git status M
ledger: {"type":"monitor:accept","programs":786,"alertsAccepted":1,"why":"--ledger"}
```

The alert asks for a reason four lines before it accepts the name of a flag as
one. And on the v2 stack, with disposable artifacts:

```
--accept --why --baseline <tmp-baseline> --ledger <tmp-ledger>
  accepted 1 alert(s): --baseline
  exit 0, drill baseline a2b2aa6c -> 84ae59ac
  ledger: {"type":"monitor:accept","alertsAccepted":1,"why":"--baseline"}
```

**Why v2's strict path parser cannot see this, stated plainly:** in
`--why --baseline <p>`, the `--baseline` is *well formed* — it has its path and
resolves correctly. Nothing is wrong with the path flag. The malformation is
entirely inside `--why`, one argument earlier.

**I under-rated this at 0112 §9 and you were right to drill it.** I wrote that it
"is not a fail-open to a committed artifact — `--why` names a reason, not a path,
and an empty one is already refused whenever alerts are open". The second clause
is what I got wrong: `"--ledger"` is not empty, so `why.trim() === ''` is false,
so the refusal never fires and the committed baseline moves. I reasoned about the
guard I remembered instead of running the case I had just named.

## 1. The fix

```
scripts/semantic-monitor.mjs         8652e046 -> 8446fe2a   (modified)
tests/semantic-monitor-why.test.ts            -> 52cc887c   (new)
tests/semantic-monitor.test.ts       fe2094d9 -> fe2094d9   (UNCHANGED)
tests/semantic-monitor-flags.test.ts 1f753b81 -> 1f753b81   (UNCHANGED)
```

`--why` is resolved at the top of the script with the path flags — above
`nextSeq()`, which is the first thing that opens the ledger — so a malformed one
has read nothing and written nothing:

```js
const KNOWN_FLAGS = ['--accept', '--why', '--ledger', '--baseline'];

function reasonFlag(flag) {
  const at = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === flag) at.push(i);
  if (at.length === 0) return '';
  if (at.length > 1) refuse(`${flag} was given ${at.length} times; which reason is meant is ambiguous`, REASON_DETAIL);
  const value = process.argv[at[0] + 1];
  if (value === undefined) refuse(`${flag} needs a reason, and is the last argument`, REASON_DETAIL);
  if (value.trim() === '')  refuse(`${flag} was given an empty reason`, REASON_DETAIL);
  if (KNOWN_FLAGS.includes(value)) refuse(`${flag} was followed by ${value}, which is one of this script's own flags rather than a reason`, REASON_DETAIL);
  return value;
}
```

Two decisions, both stated so you can overrule them:

**A reason may begin with a dash; a path may not.** `pathFlag` rejects anything
starting with `--`, because a filename that starts with two dashes is a mistake
essentially always. A reason is free text — `--why "--accept was agreed in
review"` is a sentence. So this guard names *this script's own flags* rather than
matching a prefix, and `KNOWN_FLAGS` is derived in one place so a flag added
later extends the guard without anyone remembering to. W6 mutates that set to
prove the derivation is load-bearing, and there is a cell for the dashed
sentence.

**Your §8: exit 2 vs the existing accept-refused exit 1 — the difference, written
down before choosing.** It is in the source as a table and it is this:

| | exit | ledger | baseline | what it means |
|---|---|---|---|---|
| open alert, no `--why` at all | **1** | `monitor:accept-refused` | unmoved | the monitor checked; a person declined to give a reason. That is a judgement about the tree and worth keeping. |
| `--why` malformed | **2** | **nothing** | unmoved | the invocation is not well formed, so nothing was checked and there is no judgement to record. Writing an `accept-refused` here would put a statement about the tree into the record on the strength of a typo. |
| open alert, real reason | 0 | `monitor:accept` | moved | |

Exit 2 also keeps the whole script consistent: every value-taking flag now
answers a malformed invocation the same way. The existing exit-1 path is
untouched and is cell 1 below.

`refuse()` gained a second argument so the reason flag does not print the path
flags' explanation. The path-flag text is byte-identical to what you verified.

## 2. The gate — your eight cells

`tests/semantic-monitor-why.test.ts`, 8 cells. Monitor gate 17 → **25**.

Every cell runs against a drill baseline **holding a real open alert** (seeded to
match the tree, then one hash doctored), because without an open alert `--accept`
moves the baseline anyway and a refusal proves nothing. A `beforeAll` asserts the
alert is actually open — and that assertion is what W8 breaks.

| you asked for | cell |
|---|---|
| 1. open alert + no `--why`: keep the refusal / no-write contract | `no --why at all is still refused with exit 1 and a recorded refusal` — asserts exit **1**, `monitor:accept-refused` count went up by one, baseline unmoved |
| 2. `--why` at argv end: must not accept | `--why as the last argument is refused, and records nothing` — exit 2, `not.toBe(1)`, and the drill ledger gained **no line at all** |
| 3. `--why --ledger <p>`: `--ledger` is not a reason | `--why does not take --ledger as the reason` |
| 4. on the v2 stack, `--why --baseline <p>` | `--why does not take --baseline as the reason either` |
| 5. empty / whitespace reason | `an empty or blank reason is refused` — both, and both land on exit 2 rather than one of them reading as a reason |
| 6. duplicate `--why` | `--why given twice is refused rather than resolved to one of them` |
| 7. legal reason + legal redirects still accept (over-strict control) | `a real reason still accepts, and the record carries it` — exit 0, baseline moves, `alertsAccepted: 1`, and the recorded `why` is the exact sentence a person wrote. Plus `a reason may begin with a dash without being a flag`. |
| 8. every cell asserts no wrong baseline write and no `monitor:accept` | `nothingAccepted()` — drill baseline byte-identical to the doctored text, the last `monitor:accept` in the ledger has `alertsAccepted: 0`, and both committed artifacts unmoved |

## 3. Mutations — 8 of 8, and one of them caught my own instrument

```
control (unmutated candidate)   0 failed | 25 passed | exit 0

W1 the known-flag guard is dropped, --why eats the next flag   4 failed   exit 1  CAUGHT
W2 a --why with no value silently becomes "no reason given"    1 failed   exit 1  CAUGHT
W3 a duplicate --why resolves to the first                     1 failed   exit 1  CAUGHT
W4 the reason is validated and the raw argv value used anyway  7 failed   exit 1  CAUGHT
W5 the guard is over-strict and refuses a legitimate reason    2 failed   exit 1  CAUGHT
W6 one flag dropped from the derived set                       3 failed   exit 1  CAUGHT
W7 a blank reason stops being distinguished from a missing one 1 failed   exit 1  CAUGHT
W8 the drill baseline holds no open alert                      8 skipped  exit 1  CAUGHT

both sources restored IDENTICAL
post-restore gate   0 failed | 25 passed | exit 0
committed artifacts clean
caught 8 of 8
```

**W8 was NOT CAUGHT on the first run, and the gate was not the problem — my
battery was.** W8 removes the doctoring, the file's own guard-the-guard assertion
fires inside `beforeAll`, and vitest reports

```
Test Files  1 failed (1)
     Tests  8 skipped (8)
```

There is no failed COUNT anywhere, because a file that dies in `beforeAll` runs
no tests. The battery read only the failed-count and scored a red gate as a pass.
A skipped file is not a passing file, and the process exit code already knew. The
battery now scores on `returncode` and prints the skipped count; that is the M2
lesson in a new place — the instrument agreed with itself and disagreed with
reality.

**The v2 battery has the same old regex.** I checked whether it mattered there:
every one of its fifteen rows reported a positive failed-count (2,2,3,2,2,3,8,1,
4,1,5,5,9,7,2), so no v2 result was misreported and 15/15 stands. I have not
retroactively edited the v2 board directory you verified against; the fixed
scoring ships here.

## 4. Everything else measured

```
targeted gate     0 failed | 25 passed | exit 0   (11 + 6 + 8)
typecheck         exit 0
abrupt kill       real kill, committed baseline unchanged, git status clean
--why probes      malformed forms exit 2, drill baseline unmoved,
                  last accept in the ledger still the seed's real reason
path-flag probes  the v2 layer unchanged: three refusals exit 2, null control exit 0
full suite        72 files / 3506 tests ALL PASSED
product tree      no tracked file modified
```

Suite exit code: 1 again on this machine, from the `onTaskUpdate` timeout in
§7 of 0112. **Your 0113 is the best evidence yet that it is this machine**: you
ran 71 files / 3543 tests at exit 0 on the same candidate stack. I am reporting
the counts, not the exit code, for the same reason as last time.

Newline: both changed blobs are **LF in the index**, CRLF on disk under
`core.autocrlf=true`; the final battery, kill and probe runs were made against
the CRLF bytes a fresh checkout produces. Quote the git blob.

## 5. NotMeasured, and raised not fixed

- Whether any OTHER value-taking flag exists that I have not found. `--accept` is
  a boolean; `--ledger`, `--baseline`, `--why` are the three that take values and
  all three are now strict. I read the argv handling in this file and found no
  fourth; I did not audit callers outside it (`package.json` scripts pass
  `--accept` and forward `--`-args).
- Whether `monitor:accept-refused` should also carry which alerts were open. It
  records the count and `reason: 'no --why given'`, not the file names. Raised,
  not changed — it is the existing contract and outside this fix.
- The `unseen` branch's own `record('monitor:alert', …)` still has no assertion.
  Third relay running. Still not folded in.
- Whether a reason that is *exactly* a future flag name would be wrongly refused
  once that flag is added. It would — that is the cost of the derived set, and it
  fails loud rather than silently recording a flag as a reason.

## 6. Boundary and sequence

Candidate only, stacked on v2 (`02a4cf9`) which you marked VERIFIED_FIXED. No
product landing, merge, release, deploy, and **no baseline accept** — which is
also your own precondition: this bypass has to be closed before any committed
baseline is accepted, and it is not closed until you have retested it.

`monitor-stale-baseline-edited-branch` (tag `cand2-edited-stale-v1`, `fd1ef55`)
is still not restacked. Your 0113 unblocked it and this candidate does not touch
it; the restack is the next piece of work, after your verdict here, because its
landing sequence contains exactly the baseline accept this finding is about.
