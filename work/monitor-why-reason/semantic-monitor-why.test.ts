import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * THE REASON ATTACHED TO AN ACCEPTANCE, AND HOW IT STOPPED BEING ONE.
 *
 * The whole point of the ledger is that an acceptance cannot be silent: when
 * alerts are open, `--accept` requires `--why "<reason>"`, and the reason is
 * appended to the record so a later reader can see what was waved through and
 * on what grounds. The check for "a reason was given" was
 *
 *   const why = whyIndex !== -1 ? (process.argv[whyIndex + 1] ?? '') : '';
 *   if (alerts.length > 0 && why.trim() === '') { refuse }
 *
 * which takes THE NEXT ARGUMENT whatever it is. Put another flag there and the
 * flag becomes the reason: non-empty, so the refusal never fires.
 *
 * Reproduced on the SHIPPED PRODUCT at 2019d50 on 2026-09-10, against a real
 * open alert made the honest way — one comment appended to
 * packages/parser/src/parser.ts, neither of its conformance tests touched:
 *
 *   node scripts/semantic-monitor.mjs --accept --why --ledger <temp>
 *     ALERT: SEMANTICS CHANGED packages/parser/src/parser.ts changed but none
 *            of its conformance tests did
 *            ... re-run with --accept --why "reason".
 *     semantic-monitor: baseline recorded (786 corpus programs)
 *       accepted 1 alert(s): --ledger
 *     exit 0, committed baseline ada0ea9b -> 52ad6276, git status M
 *     ledger: {"type":"monitor:accept","alertsAccepted":1,"why":"--ledger"}
 *
 * The alert asked for a reason and then accepted the name of a flag as one. The
 * same shape reproduces on the path-flag candidate — `--why --baseline <p>`
 * records `"why":"--baseline"` — because there is nothing wrong with that
 * `--baseline`: the malformation is entirely in `--why`, so a strict path
 * parser cannot see it.
 *
 * A SEPARATE FILE from semantic-monitor-flags.test.ts, deliberately: that one
 * belongs to a layer the auditor has verified, and keeping this candidate out
 * of it leaves those blobs byte-identical to what she read.
 *
 * WHAT EVERY CELL BELOW ASSERTS. Not just the exit code — a refusal that still
 * moved the baseline, or still wrote a `monitor:accept`, would pass a status
 * check while doing the exact damage this is about. So each cell checks the
 * status, the baseline bytes, and the absence of an accept event, against a
 * drill baseline that is holding a REAL open alert. Without the open alert
 * `--accept` would move the baseline anyway and the cells would prove nothing.
 */
const here = dirname(fileURLToPath(import.meta.url));
const monitor = join(here, '..', 'scripts', 'semantic-monitor.mjs');
const ledger = join(here, '..', 'scripts', 'semantic-monitor.jsonl');
const baselineFile = join(here, '..', 'scripts', 'semantic-monitor.baseline.json');

/** Disposable, and named apart from both other monitor files' scratch paths so
 *  three workers running at once cannot write each other's. */
const drillLedger = join(here, '..', 'scripts', '.monitor-why-ledger.jsonl');
const drillBaseline = join(here, '..', 'scripts', '.monitor-why-baseline.json');

const committedLedgerAtLoad = readFileSync(ledger, 'utf8');
const committedBaselineAtLoad = readFileSync(baselineFile, 'utf8');

function discard(path: string) {
  if (path === ledger || path === baselineFile) {
    throw new Error(`refusing to delete a committed artifact: ${path}`);
  }
  if (existsSync(path)) rmSync(path);
}

afterAll(() => {
  discard(drillLedger);
  discard(drillBaseline);
});

const run = (...args: string[]) =>
  spawnSync(process.execPath, [monitor, '--ledger', drillLedger, '--baseline', drillBaseline, ...args], {
    encoding: 'utf8',
  });

/** Spawn with EXACTLY these arguments, so a cell can put --why last. */
const runRaw = (...args: string[]) =>
  spawnSync(process.execPath, [monitor, ...args], { encoding: 'utf8' });

function drillEvents(): Array<Record<string, unknown>> {
  if (!existsSync(drillLedger)) return [];
  return readFileSync(drillLedger, 'utf8')
    .trimEnd()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** The text of the drill baseline while an alert is open against it. */
let doctoredText = '';

/** Seed a baseline that matches the tree, then doctor one entry so a real
 *  "changed without its test" alert is open. Seeding rather than copying the
 *  committed baseline keeps this independent of the rest of the tree. */
function doctor() {
  const seeded = run('--accept', '--why', 'why-drill setup');
  expect(seeded.status, 'seeding a matching baseline must succeed').toBe(0);
  const b = JSON.parse(readFileSync(drillBaseline, 'utf8'));
  b.hashes['packages/interp/src/values.ts'] = '0000000000000000';
  doctoredText = JSON.stringify(b, null, 2) + '\n';
  writeFileSync(drillBaseline, doctoredText, 'utf8');
}

beforeAll(() => {
  doctor();
  // Guard the guard: if this does not actually produce an alert, every refusal
  // below would be measuring an ordinary clean-state accept.
  const check = run();
  expect(check.stdout, 'the drill must have a real open alert to accept').toContain('SEMANTICS CHANGED');
  expect(check.status, 'and the run must be failing because of it').toBe(1);
});

/** Nothing was accepted, and the expectation did not move. */
function nothingAccepted(why: string) {
  expect(readFileSync(drillBaseline, 'utf8'), `${why}: the drill baseline moved`).toBe(doctoredText);
  const accepts = drillEvents().filter((e) => e.type === 'monitor:accept');
  const last = accepts[accepts.length - 1];
  expect(last?.why, `${why}: an acceptance was recorded`).not.toBe(undefined);
  expect(last?.alertsAccepted, `${why}: an OPEN ALERT was accepted`).toBe(0);
  expect(readFileSync(ledger, 'utf8'), `${why}: the committed ledger moved`).toBe(committedLedgerAtLoad);
  expect(readFileSync(baselineFile, 'utf8'), `${why}: the committed baseline moved`).toBe(
    committedBaselineAtLoad,
  );
}

describe('an acceptance cannot borrow a flag for its reason', () => {
  it('no --why at all is still refused with exit 1 and a recorded refusal', () => {
    // The pre-existing contract, kept as the positive control for the OTHER
    // branch. A malformed --why and a missing --why are different events and
    // the ledger has to distinguish them: this one is a person declining to
    // give a reason, which is a judgement about the tree and worth recording.
    const before = drillEvents().filter((e) => e.type === 'monitor:accept-refused').length;
    const r = run('--accept');
    expect(r.status, 'a missing reason is exit 1, not the CLI-usage 2').toBe(1);
    expect(r.stdout).toContain('without a reason');
    const after = drillEvents().filter((e) => e.type === 'monitor:accept-refused').length;
    expect(after, 'the refusal must reach the record').toBe(before + 1);
    nothingAccepted('no --why');
  });

  it('--why as the last argument is refused, and records nothing', () => {
    // Exit 2 and NO ledger event, unlike the cell above: the invocation is not
    // well formed, so nothing was checked and there is no judgement to keep.
    // Writing an accept-refused here would put a statement about the tree into
    // the record on the strength of a typo.
    const before = drillEvents().length;
    const r = runRaw('--ledger', drillLedger, '--baseline', drillBaseline, '--accept', '--why');
    expect(r.status, 'a flag missing its value must not exit 0').toBe(2);
    expect(r.status, 'and is a usage failure, not the missing-reason refusal').not.toBe(1);
    expect(r.stderr).toContain('--why needs a reason');
    expect(drillEvents().length, 'a usage failure records nothing at all').toBe(before);
    nothingAccepted('--why with no reason');
  });

  it('--why does not take --ledger as the reason', () => {
    // The auditor's shipped-product reproduction, as a cell.
    const r = runRaw('--baseline', drillBaseline, '--accept', '--why', '--ledger', drillLedger);
    expect(r.status, 'a flag is not a reason').toBe(2);
    expect(r.stderr).toContain("one of this script's own flags rather than a reason");
    nothingAccepted('--why --ledger');
  });

  it('--why does not take --baseline as the reason either', () => {
    // On this stack --baseline is well formed, so the strict path parser sees
    // nothing wrong. The malformation is entirely in --why, which is why this
    // needs its own guard rather than riding on the path flags'.
    const r = runRaw('--ledger', drillLedger, '--accept', '--why', '--baseline', drillBaseline);
    expect(r.status, 'a flag is not a reason').toBe(2);
    expect(r.stderr).toContain('--baseline');
    nothingAccepted('--why --baseline');
  });

  it('an empty or blank reason is refused', () => {
    // '' already fell to the missing-reason refusal, so this is not the fix's
    // novelty — but whitespace did not, and both must land in the same place
    // rather than one of them silently reading as a reason.
    const empty = run('--accept', '--why', '');
    expect(empty.status, 'an empty reason must not accept').toBe(2);
    expect(empty.stderr).toContain('empty reason');

    const blank = run('--accept', '--why', '   ');
    expect(blank.status, 'whitespace is not a reason either').toBe(2);
    nothingAccepted('an empty reason');
  });

  it('--why given twice is refused rather than resolved to one of them', () => {
    // Two reasons, one record: picking either is a guess about which the caller
    // meant, and the record would then assert something nobody wrote.
    const r = run('--accept', '--why', 'first reason', '--why', 'second reason');
    expect(r.status, 'an ambiguous reason must not accept').toBe(2);
    expect(r.stderr).toContain('ambiguous');
    nothingAccepted('--why twice');
  });

  it('a reason may begin with a dash without being a flag', () => {
    // The guard names this script's flags rather than rejecting anything that
    // starts with `--`, because a reason is free text and a sentence may open
    // with a dash. A path may not: that asymmetry is deliberate.
    const r = run('--accept', '--why', '--accept was agreed in review, see EMLP-RELAY-0114');
    expect(r.status, 'a dashed sentence is still a reason').toBe(0);
  });

  it('a real reason still accepts, and the record carries it — the positive control', () => {
    // Without this the whole file is satisfied by a monitor that refuses every
    // acceptance. Declared last because it MOVES the drill baseline.
    doctor();
    const r = run('--accept', '--why', 'reviewed at EMLP-RELAY-0114 and safe');
    expect(r.status, 'a real reason must accept').toBe(0);
    expect(readFileSync(drillBaseline, 'utf8'), 'accepting DOES move the baseline').not.toBe(doctoredText);

    const accepts = drillEvents().filter((e) => e.type === 'monitor:accept');
    const last = accepts[accepts.length - 1];
    expect(last?.alertsAccepted, 'and it accepted the open alert').toBe(1);
    expect(last?.why, 'and the record carries what a person actually wrote').toBe(
      'reviewed at EMLP-RELAY-0114 and safe',
    );

    expect(readFileSync(ledger, 'utf8'), 'the committed ledger moved').toBe(committedLedgerAtLoad);
    expect(readFileSync(baselineFile, 'utf8'), 'the committed baseline moved').toBe(committedBaselineAtLoad);
  });
});
