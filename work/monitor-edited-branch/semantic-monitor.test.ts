import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The monitor runs as part of the suite, not only as a command someone
 * remembers to type. There is no CI workflow in this repo, so `pnpm test` is
 * the only thing guaranteed to run before a commit — a monitor that has to be
 * invoked by hand is a monitor that reports to nobody.
 *
 * What it can fail on:
 *   - a semantics-bearing file changed without its conformance test
 *   - an EML construct stopped being exercised by any corpus program
 *
 * Neither is automatically a bug. The failure means "look at this", and
 * `pnpm monitor:accept` records the new state once it has been looked at.
 *
 * WHERE THESE RUNS ARE RECORDED. Drilling the monitor for real is the point of
 * this file — a mocked monitor would prove nothing about the one that runs.
 * But the monitor's ledger is the committed record of what actually happened,
 * and until this was fixed every suite run appended eleven lines of rehearsal
 * to it: two runs, an accept, a refusal, an accept, and the runs those imply.
 * Measured on the tree at 6d5d394, one `vitest run` of this file added 2295
 * bytes and 11 lines to `scripts/semantic-monitor.jsonl`.
 *
 * So every spawn below passes `--ledger` and writes to a disposable file. Two
 * things are deliberately NOT redirected:
 *
 *   - the two integrity tests read the COMMITTED ledger, because what they
 *     check is that artifact's well-formedness and sequence monotonicity, and
 *     pointing them at a file this test just created would test nothing;
 *   - the product default is untouched, which the null control in the
 *     handback measures rather than assumes.
 */
const here = dirname(fileURLToPath(import.meta.url));
const monitor = join(here, '..', 'scripts', 'semantic-monitor.mjs');
const ledger = join(here, '..', 'scripts', 'semantic-monitor.jsonl');

/** Disposable. Every spawn in this file writes here instead of the ledger. */
const drillLedger = join(here, '..', 'scripts', '.monitor-test-ledger.jsonl');

/** The committed baseline, and a disposable one for the accept drill.
 *
 *  The drill has to run `--accept` against a baseline it has doctored. It used
 *  to doctor THIS file and restore it in a `finally`, which is a live-state
 *  mutation that holds only while the process survives. Measured on 2026-09-09
 *  by killing the suite mid-drill: the file left on disk carried a fabricated
 *  hash for packages/interp/src/values.ts and `git status` showed it modified.
 *  The drill now writes a file of its own and the committed one is never
 *  opened for writing, so there is nothing for an interruption to leave. */
const baselineFile = join(here, '..', 'scripts', 'semantic-monitor.baseline.json');
const drillBaseline = join(here, '..', 'scripts', '.monitor-test-baseline.json');

/**
 * Read once, at module load, before any test in this file has run. The last
 * test compares against it. Without this the isolation is a convention: a
 * future edit that spawns the monitor directly, or drops the flag from
 * `runMonitor`, would put rehearsal back into the committed record and every
 * test here would still be green.
 */
const committedLedgerAtLoad = readFileSync(ledger, 'utf8');
const committedBaselineAtLoad = readFileSync(baselineFile, 'utf8');

/** Spawn the monitor with the ledger redirected. There is no overload that
 *  forgets the flag: a test that wants to run the monitor calls this. */
function runMonitor(...args: string[]) {
  return spawnSync(process.execPath, [monitor, '--ledger', drillLedger, ...args], { encoding: 'utf8' });
}

/** Spawn with BOTH records redirected. Used by anything that writes a baseline.
 *
 *  runMonitor is deliberately still available and still reads the committed
 *  baseline: the drift check is only meaningful against the real one, and it
 *  never writes. What must not happen is a WRITE to the committed baseline,
 *  and that is what the gate at the bottom of this file measures — on the file,
 *  not on the arguments, so it catches such a write however it arrives. */
function runDrill(...args: string[]) {
  return spawnSync(
    process.execPath,
    [monitor, '--ledger', drillLedger, '--baseline', drillBaseline, ...args],
    { encoding: 'utf8' },
  );
}

function drillEvents(): Array<Record<string, unknown>> {
  if (!existsSync(drillLedger)) return [];
  return readFileSync(drillLedger, 'utf8')
    .trimEnd()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Remove a disposable file, and refuse to remove a committed one.
 *
 *  Found by the mutation battery rather than by review: pointing `drillBaseline`
 *  at the committed path makes the guard-the-guard assertion fail, but `afterAll`
 *  still runs — and an unguarded rmSync then DELETED the committed baseline
 *  outright. A red gate beside a destroyed artifact is not a caught mutation.
 *  The same shape applies to the ledger, which had it too. */
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

describe('semantic drift monitor', () => {
  it('reports no drift against the committed baseline', () => {
    const r = runMonitor();
    expect(r.error).toBeUndefined();
    expect(r.stdout + r.stderr, 'run `pnpm monitor` for detail, `pnpm monitor:accept` once reviewed').toContain(
      'no drift against the recorded baseline',
    );
    expect(r.status).toBe(0);
  });

  it('the baseline covers every construct the monitor tracks', () => {
    // Guards the guard: adding a construct to CONSTRUCTS without re-accepting
    // would leave it unmonitored (an undefined baseline entry is skipped).
    const r = runMonitor();
    const tracked = Number(/(\d+) constructs tracked/.exec(r.stdout)?.[1] ?? 0);
    expect(tracked).toBeGreaterThan(20);
  });

  it('appends to the ledger on every run', () => {
    const before = drillEvents().length;
    runMonitor();
    const after = drillEvents();
    expect(after.length, 'a run that records nothing leaves no evidence it happened').toBeGreaterThan(before);
    // Redirecting the ledger must not turn this file into a no-op: the run has
    // to still be recorded, and recorded as a run.
    expect(after.map((e) => e.type)).toContain('monitor:run');
  });

  it('every ledger line is one well-formed EML-native event', () => {
    // The COMMITTED ledger, read only. This is a property of the artifact in
    // the repository, not of anything this file produces.
    const lines = readFileSync(ledger, 'utf8').trimEnd().split('\n');
    for (const line of lines) {
      const e = JSON.parse(line);
      expect(e.stream).toBe('eml');
      // EML's own protocol id. This project was deliberately separated from
      // PHOSPHOR; the ledger borrows the append-only SHAPE and none of the
      // naming, and this assertion is what keeps that true under later edits.
      expect(e.proto).toBe('eml-monitor-v1');
      expect(e.proto).not.toMatch(/phosphor/i);
      expect(typeof e.seq).toBe('number');
      expect(typeof e.ts).toBe('string');
      expect(e.type).toMatch(/^monitor:/);
    }
  });

  it('sequence numbers are strictly increasing across the whole ledger', () => {
    // Also the committed ledger, and also read only. A counter that resets
    // makes two runs indistinguishable in the record.
    const seqs = readFileSync(ledger, 'utf8')
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l).seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });
});

describe('accepting an open alert requires a stated reason', () => {
  /**
   * The baseline stores a snapshot, so accepting an alert USED TO overwrite the
   * only evidence it existed: the alert fired, the baseline moved, and nothing
   * in the repo remembered. Since `--accept` is precisely the thing one reaches
   * for when one should be looking harder, a silent accept was the weakest
   * point in the design.
   *
   * The drill runs against a baseline of its own. It used to doctor the
   * COMMITTED baseline and restore it in a `finally` — a live-state mutation
   * guarded by the process surviving long enough to undo it. That guard was
   * measured on 2026-09-09 rather than argued about: the suite was killed
   * mid-drill and the committed baseline left on disk carried a fabricated hash
   * (0000000000000000 against packages/interp/src/values.ts), with `git status`
   * reporting it modified. There is now nothing to restore, so there is nothing
   * an interruption can leave behind.
   */
  it('refuses --accept without --why when alerts are open, and does not write', () => {
    // Start from a baseline that matches the working tree EXACTLY, then doctor
    // one entry. Seeding rather than copying the committed file is what keeps
    // this drill independent of the rest of the tree: on a day when the
    // conformance tests had genuinely been edited, a doctored copy of the real
    // baseline made the monitor see "source changed AND its test changed",
    // report a note rather than an alert, and accept — so the drill failed for
    // a reason that had nothing to do with the refusal it exists to check.
    const seeded = runDrill('--accept', '--why', 'drill setup');
    expect(seeded.status, 'seeding a matching baseline must succeed').toBe(0);
    expect(existsSync(drillBaseline), 'the seed must land in the drill baseline').toBe(true);

    // A baseline claiming a different hash for a real semantics file now
    // produces exactly the "changed without its test" alert, and it is the
    // ONLY thing that differs — no source file is touched.
    const doctored = JSON.parse(readFileSync(drillBaseline, 'utf8'));
    doctored.hashes['packages/interp/src/values.ts'] = '0000000000000000';
    const doctoredText = JSON.stringify(doctored, null, 2) + '\n';
    writeFileSync(drillBaseline, doctoredText, 'utf8');

    const refused = runDrill('--accept');
    expect(refused.status, 'must refuse').toBe(1);
    expect(refused.stdout).toContain('without a reason');
    expect(readFileSync(drillBaseline, 'utf8'), 'a refusal must not move the baseline').toBe(doctoredText);

    const accepted = runDrill('--accept', '--why', 'drill');
    expect(accepted.status, 'must accept once a reason is given').toBe(0);
    expect(readFileSync(drillBaseline, 'utf8'), 'accepting DOES move the baseline').not.toBe(doctoredText);

    // The redirect must not have cost the drill its evidence. Both outcomes
    // this block exists to distinguish have to be in the record, or the
    // isolation has turned a real drill into a pair of exit codes.
    const types = drillEvents().map((e) => e.type);
    expect(types, 'the refusal must be recorded').toContain('monitor:accept-refused');
    expect(types, 'the acceptance must be recorded').toContain('monitor:accept');
  });

  it('the two redirects are independent of each other', () => {
    // Neither flag may imply the other. If --ledger quietly moved the baseline
    // too, or --baseline the ledger, the drill would appear isolated while one
    // committed artifact was still being written.
    const onlyLedger = join(here, '..', 'scripts', '.monitor-test-only-ledger.jsonl');
    const onlyBaseline = join(here, '..', 'scripts', '.monitor-test-only-baseline.json');
    try {
      // --ledger alone: writes that ledger, reads the committed baseline, and
      // creates no baseline of its own.
      const l = spawnSync(process.execPath, [monitor, '--ledger', onlyLedger], { encoding: 'utf8' });
      // Deliberately NOT an assertion on the exit code. What this test is about
      // is which FILES a flag touches; the exit code is about whether the tree
      // currently drifts from the baseline, which is a different question and
      // not this test's to answer. The first version asserted status 0 and so
      // would go red whenever the repo had an open alert — measuring the repo's
      // state under the name of flag independence.
      expect(l.error, '--ledger alone must run').toBeUndefined();
      expect(existsSync(onlyLedger), '--ledger alone must write its ledger').toBe(true);
      expect(existsSync(onlyBaseline), '--ledger must not invent a baseline').toBe(false);

      // --baseline alone, with --accept, writes that baseline and nothing else.
      const b = spawnSync(
        process.execPath,
        [monitor, '--ledger', drillLedger, '--baseline', onlyBaseline, '--accept', '--why', 'independence drill'],
        { encoding: 'utf8' },
      );
      expect(b.status, '--baseline alone must accept into that file').toBe(0);
      expect(existsSync(onlyBaseline), '--baseline must write where it was pointed').toBe(true);
    } finally {
      if (existsSync(onlyLedger)) rmSync(onlyLedger);
      if (existsSync(onlyBaseline)) rmSync(onlyBaseline);
    }
  });
});

describe('a stale baseline says so, whichever branch excuses the change', () => {
  /**
   * `edited` — a conformance test differs from the baseline — used to excuse a
   * semantics change with a note and nothing else. But it is a fact about the
   * BASELINE being unaccepted, not about the change being looked at, so once it
   * is true it stays true and every later change to the paired source file is
   * excused by it.
   *
   * Measured on product d2c2a0d with the baseline still at its pre-006 entries:
   * a real semantics change to the interpreter, with no conformance test
   * touched at all, produced "changed, and so did its conformance test —
   * reviewed" and exit 0.
   *
   * The `unseen` branch was given exactly this treatment in 2026-08-09 and its
   * own comment states the reason in words that apply here unchanged. This is
   * the twin getting the same thing.
   */
  it('an edited-conformance-test excuse raises STALE BASELINE, not just a note', () => {
    const seeded = runDrill('--accept', '--why', 'stale-branch drill setup');
    expect(seeded.status, 'seeding a matching baseline must succeed').toBe(0);

    // Move a semantics file AND one of its conformance tests away from the
    // baseline, which is the state a landing leaves behind before an accept.
    const doctored = JSON.parse(readFileSync(drillBaseline, 'utf8'));
    doctored.hashes['packages/interp/src/values.ts'] = '1111111111111111';
    doctored.hashes['tests/percent-format.test.ts'] = '2222222222222222';
    writeFileSync(drillBaseline, JSON.stringify(doctored, null, 2) + '\n', 'utf8');

    const r = runDrill();
    expect(r.stdout, 'the excuse must be stated, not left as a bare note').toContain('STALE BASELINE');
    expect(r.stdout, 'and it must name what is doing the excusing').toContain('tests/percent-format.test.ts');
    // A superset satisfies "contains", so name what must NOT appear. Found by
    // the mutation battery: listing every conformance test rather than the ones
    // that actually differ passed the assertion above and said something false.
    expect(
      r.stdout,
      'only the tests that actually differ are doing the excusing',
    ).not.toContain('tests/operator-matrix.test.ts');
    expect(r.status, 'an open alert exits non-zero').toBe(1);
    // The alert must reach the record, not only the console. Also found by the
    // battery: removing the record() call left every assertion above green.
    const stale = drillEvents().filter(
      (e) => e.type === 'monitor:alert' && (e as { kind?: string }).kind === 'stale-baseline',
    );
    expect(stale.length, 'the stale finding must be recorded, not only printed').toBeGreaterThan(0);

    // And it must expire: accepting clears it rather than leaving it standing.
    const accepted = runDrill('--accept', '--why', 'stale-branch drill');
    expect(accepted.status).toBe(0);
    const after = runDrill();
    expect(after.stdout, 'the excuse expires at the next accept').not.toContain('STALE BASELINE');
    expect(after.status).toBe(0);
  });
});

describe('the drill does not write the record of what happened', () => {
  /**
   * Declared last so every spawn above has already run. This is the gate: it
   * is what turns the redirect from a convention into something a later edit
   * cannot quietly undo, and it fails on exactly one mistake — a monitor
   * invocation in this file that does not go through `runMonitor`.
   */
  it('the committed ledger is byte-for-byte what it was at module load', () => {
    expect(
      readFileSync(ledger, 'utf8'),
      'a monitor spawn in this file wrote the committed ledger; use runMonitor, which passes --ledger',
    ).toBe(committedLedgerAtLoad);
  });

  it('the drill ledger is a different file from the committed one', () => {
    // Guards the guard. Pointing --ledger at the committed path would satisfy
    // every assertion above and none of the point.
    expect(drillLedger).not.toBe(ledger);
  });

  it('the committed baseline is byte-for-byte what it was at module load', () => {
    // The same gate, for the other committed artifact. It is deliberately a
    // check on the FILE rather than on the arguments of each spawn: a write
    // that arrives some other way — a direct spawnSync, a writeFileSync in a
    // future drill, a flag dropped from runDrill — is caught just the same.
    // Before 2026-09-09 this assertion did not exist and the accept drill wrote
    // this file four times per suite run, restoring it in a `finally`.
    expect(
      readFileSync(baselineFile, 'utf8'),
      'something in this file wrote the committed baseline; use runDrill, which passes --baseline',
    ).toBe(committedBaselineAtLoad);
  });

  it('the drill baseline is a different file from the committed one', () => {
    // Guards that guard. Pointing --baseline at the committed path would
    // satisfy every assertion above and none of the point.
    expect(drillBaseline).not.toBe(baselineFile);
  });
});
