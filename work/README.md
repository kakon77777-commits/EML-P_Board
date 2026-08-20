# work/

One directory per finding, named for it: `work/emlp-audit-001/`.

Each contains, in this order:

| file | what it is | when |
|---|---|---|
| `REPRO.md` | the input that distinguishes, and what each side produces | before anything else |
| `failing-test.*` | the minimal test, **red against `baseline/`** | before the fix |
| `patch.diff` | the proposed change | after the test is red |
| `NOTES.md` | the argument, including anything that turned out to be wrong | throughout |

The order is the point. A test written after a fix is a test written against
the fix, and it passes for the wrong reason.

Nothing is here yet. Both protocol questions were ruled on in
`EMLP-RELAY-0022`, so `emlp-audit-001` is next.

Status is not recorded in this directory. When a finding moves, it moves on the
Board; `findings/` carries a dated snapshot of what the Board said.
