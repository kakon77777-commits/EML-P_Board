#!/usr/bin/env bash
# Independent reproduction of EMLP-RELAY-0108 section 2: the candidate's
# --baseline / --ledger flags fail open to the committed artifacts when the
# required path value is missing.
#
# Exit codes are read from $? directly, never through a pipe: on this machine a
# pipeline reports the LAST command's status, which is exactly the defect the
# auditor flagged in my own probe-edited-branch.sh.

cd "$1" || exit 9

B=scripts/semantic-monitor.baseline.json
L=scripts/semantic-monitor.jsonl
OUT="$2"

snap() {
  echo "  baseline  blob=$(git hash-object "$B")  bytes=$(wc -c < "$B" | tr -d ' ')"
  echo "  ledger    blob=$(git hash-object "$L")  bytes=$(wc -c < "$L" | tr -d ' ')"
  echo "  git status: $(git status --porcelain "$B" "$L" | tr '\n' ';' | sed 's/;$//')"
}

echo "=== probe A: --baseline at the end of argv, with --accept ==="
echo "before"; snap
node scripts/semantic-monitor.mjs --ledger .probe-a-ledger.jsonl --accept --why missing-path-probe --baseline > "$OUT/probe-a.out" 2> "$OUT/probe-a.err"
A_STATUS=$?
echo "exit=$A_STATUS"
echo "after"; snap
echo "stdout tail:"; tail -4 "$OUT/probe-a.out" | sed 's/^/    /'
echo "stderr tail:"; tail -4 "$OUT/probe-a.err" | sed 's/^/    /'

git checkout -- "$B" "$L" 2>/dev/null
rm -f .probe-a-ledger.jsonl
echo "restored"; snap
echo

echo "=== probe B: --ledger at the end of argv ==="
echo "before"; snap
node scripts/semantic-monitor.mjs --ledger > "$OUT/probe-b.out" 2> "$OUT/probe-b.err"
B_STATUS=$?
echo "exit=$B_STATUS"
echo "after"; snap
echo "stdout tail:"; tail -4 "$OUT/probe-b.out" | sed 's/^/    /'
echo "stderr tail:"; tail -4 "$OUT/probe-b.err" | sed 's/^/    /'

git checkout -- "$B" "$L" 2>/dev/null
echo "restored"; snap
echo

echo "=== probe C: --baseline swallows the next flag as a filename ==="
echo "before"; snap
node scripts/semantic-monitor.mjs --baseline --ledger .probe-c-ledger.jsonl > "$OUT/probe-c.out" 2> "$OUT/probe-c.err"
C_STATUS=$?
echo "exit=$C_STATUS"
# '--ledger' as a FILENAME. Written as ./--ledger: bare test -e -- '--ledger'
# makes bash read the -- as an operator, which is a broken check that prints a
# confident answer - the same defect class as reading a pipeline's exit code.
echo "file named './--ledger' created: $([ -e './--ledger' ] && echo YES || echo no)"
echo "file named '.probe-c-ledger.jsonl' created: $(test -e .probe-c-ledger.jsonl && echo YES || echo no)"
echo "after"; snap
echo "stdout tail:"; tail -4 "$OUT/probe-c.out" | sed 's/^/    /'

rm -f './--ledger' .probe-c-ledger.jsonl
git checkout -- "$B" "$L" 2>/dev/null
echo "restored"; snap
echo

echo "=== NULL CONTROL: no flags at all, must still use the committed artifacts ==="
echo "before"; snap
node scripts/semantic-monitor.mjs > "$OUT/probe-n.out" 2> "$OUT/probe-n.err"
N_STATUS=$?
echo "exit=$N_STATUS"
echo "after"; snap
echo "stdout tail:"; tail -4 "$OUT/probe-n.out" | sed 's/^/    /'
git checkout -- "$B" "$L" 2>/dev/null
echo "restored"; snap
