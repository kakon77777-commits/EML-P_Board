import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * THE PATH FLAGS, AND WHAT HAPPENS WHEN ONE HAS NO PATH.
 *
 * `--ledger <path>` and `--baseline <path>` used to resolve as
 *
 *   index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : COMMITTED
 *
 * which answers "the flag was not given" and "the flag was given without its
 * path" with the same thing: the committed artifact. So a caller who ASKED for
 * the redirect — who typed the flag — got the file the redirect exists to
 * spare. Measured on 2026-09-10 against that code, in an isolated worktree,
 * with exit codes read from $? rather than through a pipe:
 *
 *   --ledger <drill> --accept --why probe --baseline
 *       exit 0, committed baseline rewritten, 3336 -> 3260 bytes, git status M
 *   --ledger
 *       exit 0, committed ledger appended, 232770 -> 232946 bytes, M. This one
 *       reproduces on the shipped product monitor too — the candidate copied
 *       the shape onto --baseline, where it governs --accept.
 *   --baseline --ledger <drill>
 *       exit 0, the baseline path became the literal string "--ledger", so the
 *       run compared against no baseline at all and reported like a fresh
 *       checkout. It writes nothing, so no write-watching gate can see it.
 *
 * A FILE OF ITS OWN, because it is a different concern: what the CLI does with
 * its arguments, rather than whether the drift drill writes the record of what
 * happened. tests/semantic-monitor.test.ts is untouched by v2 - same blob as
 * the candidate the auditor already read.
 *
 * A NOTE ON `pnpm test` ON THIS MACHINE, because these cells were briefly
 * blamed for it. The suite intermittently ends `71 passed | 3498 passed` with
 * `Timeout calling "onTaskUpdate"` and exit 1: every test green, the run red.
 * It is birpc's 60s default firing while the machine is saturated - 70-odd
 * files spawning python and node at ~6x parallelism - and it is the same class
 * the testTimeout note in vitest.config.ts already records: a fixed bound that
 * is really a statement about how busy the machine is.
 *
 * It is NOT caused by these cells. Samples on 2026-09-10, this worktree:
 * candidate 1, with none of this file present, exited 0 once early and then 1
 * three times in a row later the same session; v2 exited 1 three times, then 0
 * twice, then 1. The first four samples looked like a clean split and were
 * read that way; three more samples of the control removed it. Anything this
 * file says about cost is therefore about spawns and seconds, which are
 * measurable, and not about the exit code, which on this machine is not.
 *
 * So the cells below spend one spawn each. Every refusal exits before the
 * corpus is scanned, which makes them the cheapest spawns in the suite; the
 * single positive control is the only full run.
 */
const here = dirname(fileURLToPath(import.meta.url));
const monitor = join(here, '..', 'scripts', 'semantic-monitor.mjs');
const ledger = join(here, '..', 'scripts', 'semantic-monitor.jsonl');
const baselineFile = join(here, '..', 'scripts', 'semantic-monitor.baseline.json');

/** Disposable, and named differently from the other monitor file's scratch
 *  paths so two workers running at once cannot write each other's files. */
const drillLedger = join(here, '..', 'scripts', '.monitor-flags-ledger.jsonl');
const drillBaseline = join(here, '..', 'scripts', '.monitor-flags-baseline.json');

/** Read at module load, in THIS file, independently of the other one's copy. */
const committedLedgerAtLoad = readFileSync(ledger, 'utf8');
const committedBaselineAtLoad = readFileSync(baselineFile, 'utf8');

/** Remove a disposable file, and refuse to remove a committed one. Same guard
 *  as the drill file's, for the same reason: the mutation battery found that an
 *  unguarded rmSync in a teardown deletes the real artifact outright when a
 *  mutation points a drill path at it. */
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

/** Spawn the monitor with EXACTLY these arguments — no redirect added. That is
 *  the point: these are the runs that must not reach a committed artifact. */
const runRaw = (...args: string[]) =>
  spawnSync(process.execPath, [monitor, ...args], { encoding: 'utf8' });

/** Both committed artifacts, unmoved. Every cell asserts this as well as the
 *  status: a refusal that still wrote would pass a status check on its own. */
function bothCommittedUnmoved(why: string) {
  expect(readFileSync(ledger, 'utf8'), `${why}: the committed ledger moved`).toBe(committedLedgerAtLoad);
  expect(readFileSync(baselineFile, 'utf8'), `${why}: the committed baseline moved`).toBe(
    committedBaselineAtLoad,
  );
}

describe('a path flag without a usable path stops the run', () => {
  it('--baseline as the last argument is refused, writes nothing, and records nothing', () => {
    // --accept is here on purpose: without it the fail-open only READ the
    // committed baseline, and with it the fail-open WROTE it. The cell has to
    // exercise the writing form.
    //
    // Three properties on one spawn, because they are one claim from three
    // sides — the run stopped before the recording machinery:
    //   the status says refused, the committed files did not move, and no
    //   ledger gained a line, not even the disposable one this run was given.
    const before = existsSync(drillLedger) ? readFileSync(drillLedger, 'utf8') : '';
    const r = runRaw('--ledger', drillLedger, '--accept', '--why', 'gate probe', '--baseline');

    // Exit 2 rather than 1 is load-bearing. The daily flow reads this code, and
    // 1 already means "the monitor checked and the tree needs looking at". A
    // mistyped flag is not a regression, and a caller that cannot tell them
    // apart will either chase drift that does not exist or learn to ignore the
    // report that matters.
    expect(r.status, 'a flag missing its path must not exit 0').toBe(2);
    expect(r.status, 'and must stay distinguishable from a drift failure').not.toBe(1);
    expect(r.stderr).toContain('--baseline needs a path');

    const after = existsSync(drillLedger) ? readFileSync(drillLedger, 'utf8') : '';
    expect(after, 'a refusal must not append to any ledger, drill or committed').toBe(before);
    bothCommittedUnmoved('--baseline with no path');
  });

  it('--ledger as the last argument is refused', () => {
    const r = runRaw('--ledger');
    expect(r.status, 'a flag missing its path must not exit 0').toBe(2);
    expect(r.stderr).toContain('--ledger needs a path');
    bothCommittedUnmoved('--ledger with no path');
  });

  it('a path flag does not swallow the next flag as its path', () => {
    // The quietest of the three, and the only one no write-watching gate can
    // catch: nothing is written. The run simply finds no baseline where it was
    // pointed, compares against nothing, and reports like a fresh checkout.
    const r = runRaw('--baseline', '--ledger', drillLedger);
    expect(r.status, 'a flag as a path must not exit 0').toBe(2);
    expect(r.stderr).toContain('which is another flag rather than a path');
    expect(r.stdout, 'and it must not have run the comparison at all').not.toContain('no baseline yet');
    bothCommittedUnmoved('--baseline followed by --ledger');
  });

  it('an empty path is refused rather than resolved', () => {
    // '' is falsy, so the old expression answered it with the committed file
    // exactly as it answered undefined. A shell expanding an unset variable
    // produces this without anyone typing it.
    const r = runRaw('--ledger', '', '--baseline', drillBaseline);
    expect(r.status, 'an empty path must not exit 0').toBe(2);
    expect(r.stderr).toContain('empty path');
    bothCommittedUnmoved('--ledger with an empty path');
  });

  it('a flag given twice is refused rather than resolved to one of them', () => {
    // Two paths, one flag: picking either is a guess about which was meant, and
    // the guess is invisible in the output. Refusing is the adjudication, and
    // this cell is what makes it a decision rather than an accident of indexOf
    // returning the first match.
    const other = join(here, '..', 'scripts', '.monitor-flags-duplicate.jsonl');
    try {
      const r = runRaw('--ledger', drillLedger, '--ledger', other);
      expect(r.status, 'an ambiguous flag must not exit 0').toBe(2);
      expect(r.stderr).toContain('ambiguous');
      expect(existsSync(other), 'neither candidate path may be written').toBe(false);
      bothCommittedUnmoved('--ledger given twice');
    } finally {
      discard(other);
    }
  });

  it('the legal forms still work — the positive control', () => {
    // Without this the whole block is satisfied by a monitor that refuses
    // everything. One spawn, both flags legal at once, and it reads rather than
    // accepts: the write side of a legal --baseline is drilled in
    // tests/semantic-monitor.test.ts, which does it already and need not do it
    // twice on a machine this loaded.
    //
    // The other default — NO --ledger at all, writing the committed ledger —
    // cannot be controlled from inside this suite: doing it once would be the
    // very write the gates here exist to catch. It is measured in the handback
    // instead, on the real command, and reported as a null control rather than
    // assumed.
    const r = runRaw('--ledger', drillLedger, '--baseline', drillBaseline);
    expect(r.status, 'two well-formed flags must run').toBe(0);
    expect(r.stdout).toContain('corpus programs');
    bothCommittedUnmoved('the legal form');
  });
});
