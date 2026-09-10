#!/usr/bin/env bash
# Independent reproduction of EMLP-RELAY-0114: `--why` takes the next flag as
# its reason, so an open alert can be accepted with no human reason at all.
#
# $1 = worktree, $2 = out dir, $3 = label, $4 = "product" | "candidate"
#
# A real open alert is needed, or `--accept` refreshing the baseline proves
# nothing. It is made the way the auditor made it: a comment-only edit to a
# semantics-bearing source file, with neither of its conformance tests touched.
#
# Exit codes come from $? directly, never through a pipe.

cd "$1" || exit 9
OUT="$2"; LABEL="$3"; MODE="$4"

B=scripts/semantic-monitor.baseline.json
L=scripts/semantic-monitor.jsonl
SRC=packages/parser/src/parser.ts
TL=scripts/.probe-why-ledger.jsonl
TB=scripts/.probe-why-baseline.json

echo "================ $LABEL ================"
echo "monitor blob : $(git hash-object scripts/semantic-monitor.mjs)"

cleanup() {
  git checkout -- "$SRC" "$B" "$L" 2>/dev/null
  rm -f "$TL" "$TB"
}
trap cleanup EXIT

# --- make a real open alert: a comment on a semantics file, no test touched ---
printf '\n// probe-why: temporary, removed by this script\n' >> "$SRC"
echo "alert source : appended one comment line to $SRC"

if [ "$MODE" = "candidate" ]; then
  # Seed a disposable baseline that matches the tree, then re-introduce the
  # alert, so nothing committed is ever the write target.
  git checkout -- "$SRC"
  node scripts/semantic-monitor.mjs --ledger "$TL" --baseline "$TB" --accept --why "probe seed" > "$OUT/why-seed.out" 2>&1
  echo "seed exit    : $?"
  printf '\n// probe-why: temporary, removed by this script\n' >> "$SRC"
  REDIRECT="--baseline $TB --ledger $TL"
  WATCH="$TB"
else
  REDIRECT="--ledger $TL"
  WATCH="$B"
fi

before=$(git hash-object "$WATCH" 2>/dev/null); bbytes=$(wc -c < "$WATCH" 2>/dev/null | tr -d ' ')
echo "watching     : $WATCH"
echo "  before     : $before  $bbytes bytes"

# --- the defect: --why immediately followed by another flag ---
if [ "$MODE" = "candidate" ]; then
  node scripts/semantic-monitor.mjs --accept --why --baseline "$TB" --ledger "$TL" > "$OUT/why-probe.out" 2> "$OUT/why-probe.err"
else
  node scripts/semantic-monitor.mjs --accept --why --ledger "$TL" > "$OUT/why-probe.out" 2> "$OUT/why-probe.err"
fi
STATUS=$?

after=$(git hash-object "$WATCH" 2>/dev/null); abytes=$(wc -c < "$WATCH" 2>/dev/null | tr -d ' ')
echo "  exit       : $STATUS"
echo "  after      : $after  $abytes bytes"
echo "  moved      : $([ "$before" != "$after" ] && echo YES || echo no)"
echo "  git status : $(git status --porcelain "$B" "$L" | tr '\n' ';')"
echo "  stdout:"; sed 's/^/    /' "$OUT/why-probe.out" | tail -6
echo "  stderr:"; sed 's/^/    /' "$OUT/why-probe.err" | tail -4
echo "  last accept event in the ledger it wrote:"
grep -o '"type":"monitor:accept"[^}]*' "$TL" 2>/dev/null | tail -1 | sed 's/^/    /'
echo
