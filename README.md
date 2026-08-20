# EML-P_Board

A working space for two AIs building and checking **EML-P**.

- **墨繩 (Mo Sheng)** — Claude, lead engineer on EML-P
- **岑衡 (Cen Heng)** — Codex, the dedicated checker

Set up by Neo.K on 2026-08-20.

## What this repo is for

Code, tests and discussion **in progress**. Candidate fixes, minimal failing
tests, repros, drills and the argument about whether a thing is a defect all
live here and get revised in place.

The finished version goes back to
[efficientnewlanguage](https://github.com/kakon77777-commits/efficientnewlanguage).
Nothing here is shipped from here.

## The two channels

| channel | carries | property |
|---|---|---|
| [AI Board](https://aiboard.evemisslab.com) topic `eml-p-relay` | the conversation, rulings, status transitions | append-only ledger; a message is never edited |
| this repo | code, tests, patches, repros | revised in place; history is in git |

They are not alternatives. **A claim made in code here should have a
corresponding entry on the board**, because the board is what records *when* a
thing was said and by whom, and this repo is what records *what the code does*.

## Layout

```
findings/     one file per EMLP-AUDIT-NNN, append-only status log
              INDEX.md is the full 22-finding table
baseline/     the exact source under audit, vendored at commit f77a43f
work/         one directory per finding: repro, failing test, proposed patch
PROTOCOL.md   status vocabulary, evidence tiers, handback format, open questions
```

## Baseline

Everything here is against **`f77a43f`** of the language repo
(`Corpus 346 -> 351: what the decision becomes`).

As of 2026-08-20 the product code has not moved since that commit. Verified two
ways: `git diff --stat f77a43f HEAD -- packages/` is empty, and the files in
`baseline/` are byte-identical to the current HEAD of the language repo. The 22
findings therefore describe the code as it stands today, not as it stood in
August.

## Working rules

1. **`VERIFIED_FIXED` is 岑衡's mark alone.** The highest 墨繩 sets is
   `READY_FOR_RETEST`.
2. **A minimal failing test comes before a fix**, and it must be red against
   `baseline/`.
3. **Re-verification inputs are not disclosed before the ruling.** 岑衡
   generates his own `V`; the overlap `|R∩V|/|V|` is published afterwards.
4. **Status log entries are appended, never rewritten.** A correction is a new
   line that references the old one.
5. **The four CRITICALs first**, and 005-022 are not opened until they are
   handed back, so re-verification is never reading a tree with several
   unrelated changes in it.

## Current state

Nothing is started. The two protocol patches in `PROTOCOL.md` are `OPEN` and
waiting on 岑衡's ruling, because they decide the handback format and it is
cheaper to settle them before writing than after.
