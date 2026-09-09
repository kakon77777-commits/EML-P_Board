# monitor drift check, `edited` branch — READY_FOR_RETEST

- reply_to: EMLP-RELAY-0107 §5
- status: **READY_FOR_RETEST**
- authorized: Neo, 2026-09-09 — 「就按他做的」, i.e. give this branch the treatment
  its twin was already given. Candidate only. **Not landed.**
- **stacked on the monitor-baseline-isolation candidate.** It has to be: testing
  this safely requires the disposable baseline that candidate introduces.
- product tree: 0 modified tracked files; monitor still `999b384b…`, gate still
  `5ef12e32…`, baseline still `ada0ea9b…`

## Blob chain, in landing order

```
product d2c2a0d       monitor  999b384bdaf098cb32e1cfe4ebbe029bc4d624b7
                      gate     5ef12e320286bb437de44cdebc27d44f3df69ae7
                      baseline ada0ea9b0de1bdf6dfbf6440448fa8dc411bdc45

+ candidate 1         monitor  a193c7e864c5f702efd5005a24480d7aac55a40c
  (baseline-iso)      gate     fe2094d9f0db11647ccb47b5a85124e464108a37

+ candidate 2         monitor  4045ee2b8dfee7ad393352dbacb0786f94022ff6
  (this one)          gate     8cf9b0ec655d172e0c0f0375e3916a31919f568e
                      baseline a2b2aa6c73efe82307f0c81f80bd3c60fd9d5cef
```

`patch-2-source.diff` is the two source files. `patch-2-full.diff` also carries
the accepted baseline and its ledger line — see §4 for why those are part of it
and not an accident.

## 1. What changed, and why in this shape

`edited` asks whether a conformance test differs **from the baseline**. It asks
nothing about the change being looked at. So once the baseline is stale for that
test — the ordinary state right after a landing that moved a semantics file and
its test together — `edited` is true on every run and every LATER change to the
paired source file is excused by it.

The `unseen` branch has the identical property and was given an alert for it on
2026-08-09. Its own comment states the reason:

> "Brand new" was read off the baseline, so a test file stayed brand new for as
> long as the baseline went unaccepted — and the excuse it grants is not about
> the file that changed…

That sentence is true of `edited` word for word. This is the twin getting the
same thing: the excuse still stands, and it now says so out loud, so it expires
at the next accept instead of standing forever.

## 2. Red-first, and the payoff, on the same probe

The probe is a **real semantics change** — `abs()` of a negative float stops
taking the absolute value — with **no conformance test touched at all**.

```
BEFORE (product d2c2a0d, baseline at its pre-006 entries)
  builtin gate      1 failed | 85 passed
  semantic-monitor  note: changed, and so did its conformance test — reviewed
                    no drift against the recorded baseline
                    exit 0

AFTER (this candidate, baseline accepted)
  semantic-monitor  ALERT: SEMANTICS CHANGED packages/interp/src/index.ts
                    changed but none of its conformance tests did
                    exit 1
```

The builtin gate catches that particular change because a test for `abs` happens
to exist. The monitor is the backstop for the changes no test covers, and the
backstop was off.

**The excuse expires.** Measured as a cycle: alert + exit 1 → `--accept --why` →
exit 0 → next run, no drift, exit 0.

## 3. Eleven mutations, all red

The battery now covers both stacked candidates.

```
control (unmutated)                                          0 failed | 12 passed

M1  runDrill stops redirecting the baseline                  3 failed  CAUGHT
M2  the drill baseline IS the committed baseline             2 failed  CAUGHT
M3  --baseline is accepted and ignored                       4 failed  CAUGHT
M4  --ledger silently implies --baseline                     2 failed  CAUGHT
M5  the drill doctors the committed baseline directly again  1 failed  CAUGHT
M6  --accept writes the committed baseline whatever the flag 4 failed  CAUGHT
M7  the edited branch goes back to a bare note               1 failed  CAUGHT
M8  the alert stops naming what is doing the excusing        1 failed  CAUGHT
M9  editedTests lists every test, not the differing ones     1 failed  CAUGHT
M10 the stale finding is a note, so the exit code stays 0    1 failed  CAUGHT
M11 the stale finding is printed but never recorded          1 failed  CAUGHT

sources restored IDENTICAL; post-restore control 0 failed | 12 passed
committed artifacts clean; caught 11 of 11
```

**Two of these were NOT CAUGHT on the first run, and both were real gaps in my
own tests rather than bad mutations:**

- **M9.** The test asserted the alert *contains* `tests/percent-format.test.ts`.
  A list of every conformance test also contains it, so a version that named six
  tests when one had changed passed the assertion while saying something false.
  Fixed by naming what must NOT appear: `tests/operator-matrix.test.ts` did not
  change and must not be offered as the excuse.
- **M11.** The alert reached the console and nothing asserted it reached the
  record. Removing `record('monitor:alert', …)` left every assertion green.
  Fixed by asserting the drill ledger carries a `monitor:alert` of kind
  `stale-baseline`. Worth noting the `unseen` branch's own record has never had
  such an assertion either.

M7 as first written removed the record rather than the alert, which is how M11
was found; it now removes the alert, and M11 keeps the other property.

## 4. Landing this changes the daily flow, deliberately

**Say this out loud before it lands.** With the guard live, `pnpm monitor` exits
**1** after any landing that moves a semantics file and its conformance test
together, until the baseline is accepted with a reason. That is the point — the
guard is only live while the baseline is current — but it is a real change to
the daily corpus round, which runs `pnpm monitor` and reads its exit code.

The remedy is one command and the alert prints it.

`patch-2-full.diff` therefore includes the accepted baseline and the ledger line
that records why:

```
--why "AUDIT-006 landed at d2c2a0d: the interpreter and tests/builtin-shapes.test.ts
       moved together and were independently verified by the auditor at
       EMLP-RELAY-0102 and re-verified post-landing at 0105. Accepting so the
       drift guard for that pair is live again."
```

**The accepted baseline is determined by the tree, not by the candidate.** The
baseline hashes 42 files; the set of files either candidate changes has **zero
overlap** with those 42 (measured, not assumed). So accepting in this worktree
produces the same bytes as accepting in the product at `d2c2a0d`.

If you would rather the accept be a separate deliberate act at landing time,
take `patch-2-source.diff` and run the command — the result is the same file.

## 5. Full verification

```
targeted gate     0 failed | 12 passed        (11 after candidate 1, 8 before both)
full suite        70 files / 3493 tests, exit 0   (3492 + 1)
typecheck         exit 0
monitor           771 programs / 27 constructs / no drift, no note, no alert
committed baseline across a full suite run   b30079045a573b70, unchanged
committed ledger  across a full suite run    719642a30c322e24, unchanged
product tree      0 modified tracked files
```

`pnpm monitor` is now clean with no note at all, because the baseline is
current — which is the state the whole change exists to make observable.

## 6. One amendment to candidate 1, stated rather than slipped in

Candidate 1's `the two redirects are independent of each other` asserted
`status === 0` on a `--ledger`-only run. That measures whether the repo is
drift-clean, not whether the flags are independent, and it went red the moment
the new alert existed. Patch 2 replaces that assertion with `error` being
undefined plus the file-existence checks it actually cares about.

I am flagging this because candidate 1 is already handed back at board
`32154da`: if you verify them in order, the amendment is visible inside patch 2
rather than having quietly changed underneath you.

## 7. NotMeasured

- Whether the same staleness property affects checks other than the
  source/conformance-test drift pair. Coverage-to-zero and the corpus
  equivalence checks do not read the baseline's `hashes` map, so they are
  unaffected — but I have not gone looking beyond that.
- The `unseen` branch's `record('monitor:alert', …)` still has no assertion of
  its own. M11 guards the `edited` one only. Raising it, not fixing it here.
- Whether a project would rather have this as a note plus a non-zero exit only
  in CI. That is a policy question about the daily flow, not a measurement.

## 8. Boundaries

Candidate only, stacked on candidate 1, and **neither is landed**. No merge, no
release, no deploy. 005 is not reopened; 006 is closed; 007-022, the registry,
the trace error outcome contract and PR #3 / #4 are untouched.
