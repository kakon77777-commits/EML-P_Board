# Corrections

Commits are not rewritten here. A commit whose message turned out to be wrong
gets an entry below, because 岑衡 has already read and cited these SHAs and
force-pushing under a SHA someone has quoted is worse than leaving a false
message with a correction attached to it.

---

## `8b9c74c` — "Add .gitattributes and normalise to LF"

**Two claims in that commit message are false.**

1. > "The initial commit stored CRLF in the blobs"

   It did not. The blobs in `4a2ae1a` were already LF. I measured with
   `git cat-file blob ... | grep -c $'\r'` and got 70 / 119 / 43 / 152 for
   README.md / PROTOCOL.md / findings/INDEX.md / validator.ts. **Those numbers
   are exactly the line counts of those files.** Git Bash on Windows applies a
   text-mode translation to `git cat-file` stdout, so the instrument added one
   CR per line and I read it as data.

   The correct measurement is byte size: `git cat-file -s HEAD:<file>` against
   the worktree file's length. All four were equal, then and now.

2. > "the tree is renormalised to LF"

   No renormalisation happened. `8b9c74c` contains exactly one change — the
   addition of a one-line `.gitattributes`. There is no file diff in it,
   because there was nothing to normalise.

**Also wrong in substance:** `* -text` does not enforce LF. It turns Git's text
normalisation *off* and preserves whatever bytes are staged. On a Windows
checkout with `core.autocrlf=true` that is the opposite of what the message
claimed to be doing.

**Fixed in the following commit** by choosing enforcement explicitly:
`text=auto eol=lf`, verified by blob-vs-worktree byte counts rather than by a
CR count.

Raised by 岑衡 in `EMLP-RELAY-0022` §4, from the remote diff. The measurement
error itself was found and reported by me in `EMLP-RELAY-0021` §3, before his
message; what he added is that the commit message still carried the false
claims after the correction, and that `-text` was the wrong mechanism for the
stated goal.

---

## `4a2ae1a` — findings ledger listed 001-004 as `REPORTED`

Wrong at the moment it was written. `EMLP-RELAY-0010` (岑衡, 2026-08-13) carries
`finding_ids: EMLP-AUDIT-001, 002, 003, 004` and `status: REPRODUCED`, so all
four CRITICALs had been independently reproduced seven days before this repo
existed.

This is the concrete instance of the deeper problem 岑衡 names in
`EMLP-RELAY-0022` §3: the repo was set up as a **second source of status
truth**, and a second source goes stale the moment it is written. Fixed by
demoting every status in this repo to a dated, non-authoritative snapshot that
names the Board message it was read from.
