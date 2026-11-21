import { describe, expect, it } from 'vitest';
import type { SourceControl } from '../src/adapters/source-control.js';
import { recordMerge, revertMerge, watchRun } from '../src/factory/merge.js';
import { runTicket } from '../src/factory/run-lifecycle.js';
import { advance } from '../src/factory/build-loop.js';
import { parseComment, renderComment } from '../src/record/ticket-record.js';
import { BUILT, PASS, getWorld, reachReview, type WorldOptions } from './fakes/loop-world.js';

const AUTO = 'risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [src/auth/**], shadow: false }';
const WATCHED = `watch: { enabled: true, checks: [./smoke.sh, ./smoke-api.sh], duration: 3m, interval: 1m }\n${AUTO}`;
const MERGE_COMMIT = 'Merge pull request #401 from acme/factory/pay-142\n\nPAY-142 Bulk invoice export';

const getDelivered = async (options?: WorldOptions) => {
  const world = await getWorld(options);
  await reachReview(world);
  await world.step({ verdicts: { reviewer: PASS } });
  world.commits.m1 = MERGE_COMMIT;
  return world;
};

const getMerged = async (options?: WorldOptions, by = 'sam') => {
  const world = await getDelivered(options);
  world.git.merge(401, by);
  await recordMerge(world.deps, { commit: 'm1' });
  return world;
};

const withoutRevertApi = (world: Awaited<ReturnType<typeof getWorld>>) => {
  const sourceControl: SourceControl = {
    ...world.deps.sourceControl,
    openRevertPullRequest: async () => {
      throw new Error('Bitbucket has no API to revert a pull request.');
    },
  };
  return { ...world.deps, sourceControl };
};

describe('recording a merge from CI', () => {
  it('writes who merged, when, and that the change was merged as is, then moves the ticket to Done', async () => {
    const world = await getDelivered();
    world.clock.seconds = 600;
    world.git.merge(401, 'sam');
    world.clock.seconds = 700;

    const result = await recordMerge(world.deps, { commit: 'm1' });

    const record = await world.record();
    expect(result).toEqual({ ok: true, merged: { key: 'PAY-142', by: 'sam', asIs: true } });
    expect(record.runs[0]).toMatchObject({
      status: 'merged',
      merge: { route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode', at: '2026-11-21T08:10:00Z', by: 'sam', asIs: true },
    });
    expect(record.state).toBe('done');
    expect(record.events.at(-1)).toEqual({ at: '2026-11-21T08:11:40Z', by: 'pierre', type: 'merged', detail: 'by sam, merged as is' });
    expect(await world.status()).toBe('Done');
    expect(await world.summary()).toBe('Merged by sam · merged as is');
  });

  it('says the change was changed by a human when a commit was pushed after the factory', async () => {
    const world = await getDelivered();
    world.git.push('factory/pay-142', 'commit-by-hand');
    world.git.merge(401, 'sam');

    const result = await recordMerge(world.deps, { commit: 'm1' });

    expect(result.merged).toEqual({ key: 'PAY-142', by: 'sam', asIs: false });
    expect((await world.record()).runs[0]?.merge).toMatchObject({ asIs: false, wouldAutoMerge: true });
    expect(await world.summary()).toBe('Merged by sam · changed by a human');
  });

  it('still writes the outcome when the provider already moved the ticket to Done, without another transition', async () => {
    const world = await getDelivered();
    world.git.merge(401, 'sam');
    await world.tickets.transition({ key: 'PAY-142', from: 'In review', to: 'Done' });
    const transitions: string[] = [];
    const tickets = { ...world.tickets, transition: async (request: { readonly key: string; readonly from: string; readonly to: string }) => {
      transitions.push(request.to);
      return world.tickets.transition(request);
    } };

    const result = await recordMerge({ ...world.deps, tickets }, { commit: 'm1' });

    expect(result.merged?.key).toBe('PAY-142');
    expect(transitions).toEqual([]);
    expect((await world.record()).runs[0]?.status).toBe('merged');
    expect(await world.status()).toBe('Done');
  });

  it.each([
    ['a squash merge on GitHub', 'PAY-142 Bulk invoice export (#401)\n\n* Added the exporter'],
    ['a merge on Bitbucket', 'Merged in factory/pay-142 (pull request #401)\n\nPAY-142 Bulk invoice export'],
  ])('finds the pull request of %s', async (_case, message) => {
    const world = await getDelivered();
    world.commits.m1 = message;
    world.git.merge(401, 'sam');

    expect((await recordMerge(world.deps, { commit: 'm1' })).merged?.key).toBe('PAY-142');
  });

  it('takes the pull request number it is given when the commit does not name one', async () => {
    const world = await getDelivered();
    world.commits.m1 = 'PAY-142 Bulk invoice export';
    world.git.merge(401, 'sam');

    expect(await recordMerge(world.deps, { commit: 'm1' })).toEqual({ ok: true });
    expect((await recordMerge(world.deps, { commit: 'm1', pullRequest: 401 })).merged?.key).toBe('PAY-142');
  });

  it('writes nothing for a merge that is not a factory pull request', async () => {
    const world = await getDelivered();
    world.git.push('feature/by-hand', 'h1');
    await world.sourceControl.openPullRequest({ branch: 'feature/by-hand', base: 'main', title: 'By hand', body: 'A change made by hand.\nSee Ticket: PAY-142\nTicket: PAY-142 is related' });
    world.git.merge(402, 'sam');
    world.commits.m2 = 'Merge pull request #402 from acme/feature/by-hand';
    world.commits.m3 = 'Merge pull request #999 from acme/gone';
    world.commits.m4 = 'Follow up on (#401) with a typo fix\n\nMerge pull request #401 was the original (#401)';
    const before = await world.tickets.getFactoryComment('PAY-142');

    const results = await Promise.all(['m2', 'm3', 'm4'].map((commit) => recordMerge(world.deps, { commit })));

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(before);
    expect(await world.status()).toBe('In review');
  });

  it('writes nothing while the pull request is still open, and nothing twice', async () => {
    const world = await getDelivered();

    const early = await recordMerge(world.deps, { commit: 'm1' });
    world.git.merge(401, 'sam');
    const first = await recordMerge(world.deps, { commit: 'm1' });
    const again = await recordMerge(world.deps, { commit: 'm1' });

    expect(early).toEqual({ ok: true });
    expect(first.merged?.by).toBe('sam');
    expect(again).toEqual({ ok: true });
    expect((await world.record()).events.filter((event) => event.type === 'merged')).toHaveLength(1);
  });

  it('writes nothing when the ticket is gone or its record was edited by hand', async () => {
    const world = await getDelivered();
    world.git.merge(401, 'sam');
    const comment = (await world.tickets.getFactoryComment('PAY-142')) ?? '';
    const gone = { ...world.tickets, getTicket: async () => undefined };

    const missing = await recordMerge({ ...world.deps, tickets: gone }, { commit: 'm1' });
    await world.tickets.putFactoryComment('PAY-142', comment.replace('"claimant":"pierre"', '"claimant":"someone"'));
    const edited = await recordMerge(world.deps, { commit: 'm1' });

    expect(missing).toEqual({ ok: true });
    expect(edited).toEqual({ ok: true });
    expect(await world.status()).toBe('In review');
  });

  it('writes nothing when no run of the ticket opened that pull request', async () => {
    const world = await getDelivered();
    world.git.push('factory/pay-142-again', 'c9');
    await world.sourceControl.openPullRequest({ branch: 'factory/pay-142-again', base: 'main', title: 'PAY-142 again', body: 'Ticket: PAY-142\nOpened by hand' });
    world.git.merge(402, 'sam');
    world.commits.m2 = 'Merge pull request #402 from acme/factory/pay-142-again';

    expect(await recordMerge(world.deps, { commit: 'm2' })).toEqual({ ok: true });
    expect(await world.status()).toBe('In review');
  });

  it('records the merge on the run that opened the pull request, with defaults when source control says little', async () => {
    const world = await getDelivered();
    const comment = (await world.tickets.getFactoryComment('PAY-142')) ?? '';
    const parsed = parseComment(comment, { trustEdited: false });
    if (parsed.status !== 'ok') throw new Error('invalid test record');
    const [run] = parsed.record.runs;
    if (run === undefined || run.pullRequest === undefined) throw new Error('no run');
    const { merge: _merge, ...bare } = run;
    const older = { ...bare, pullRequest: { number: run.pullRequest.number, url: run.pullRequest.url } };
    const later = { ...bare, pullRequest: { number: 777, url: 'memory://pull/777' } };
    await world.tickets.putFactoryComment('PAY-142', renderComment({ record: { ...parsed.record, runs: [older, later] }, summary: 'x' }));
    const merged = await world.sourceControl.getPullRequest(401);
    if (merged === undefined) throw new Error('no pull request');
    const { mergedAt: _at, mergedBy: _by, ...quiet } = { ...merged, state: 'merged' as const };
    world.clock.seconds = 900;
    const sourceControl: SourceControl = { ...world.deps.sourceControl, getPullRequest: async () => quiet };

    await recordMerge({ ...world.deps, sourceControl }, { commit: 'm1' });

    const record = await world.record();
    expect(record.runs[0]).toMatchObject({
      status: 'merged',
      merge: { route: 'human', wouldAutoMerge: false, reason: 'not recorded when the pull request opened', at: '2026-11-21T08:15:00Z', by: 'unknown', asIs: false },
    });
    expect(record.runs[1]?.status).toBe('in_review');
    expect(record.runs[1]).not.toHaveProperty('merge');
  });
});

describe('detecting a revert on main', () => {
  it('marks the original ticket reverted when a revert pull request is merged', async () => {
    const world = await getMerged();
    await world.sourceControl.openRevertPullRequest(401);
    world.git.merge(402, 'sam');
    world.commits.m2 = 'Merge pull request #402 from acme/revert-401';
    world.clock.seconds = 3000;

    const result = await recordMerge(world.deps, { commit: 'm2' });

    const record = await world.record();
    expect(result).toEqual({ ok: true, reverted: { key: 'PAY-142', by: 'pull request 402' } });
    expect(record.runs[0]?.revert).toStrictEqual({ at: '2026-11-21T08:50:00Z', by: 'pull request 402', merged: true });
    expect(record.runs[0]?.merge).toMatchObject({ by: 'sam', asIs: true });
    expect(record.events.at(-1)).toEqual({ at: '2026-11-21T08:50:00Z', by: 'pierre', type: 'reverted', detail: 'pull request 402' });
    expect(await world.summary()).toBe('Reverted by pull request 402');
  });

  it('recognises a git revert commit that names the merge it undoes', async () => {
    const world = await getMerged();
    world.commits.abc1234 = MERGE_COMMIT;
    world.commits.r1 = 'Revert "Merge pull request #401 from acme/factory/pay-142"\n\nThis reverts commit abc1234.';

    const result = await recordMerge(world.deps, { commit: 'r1' });

    expect(result).toEqual({ ok: true, reverted: { key: 'PAY-142', by: 'commit r1' } });
    expect((await world.record()).runs[0]?.revert).toMatchObject({ by: 'commit r1', merged: true });
  });

  it('writes nothing for a revert of something the factory did not build, or one written by hand', async () => {
    const world = await getMerged();
    world.commits.other = 'Tidy the README';
    world.commits.r1 = 'Revert "Tidy the README"\n\nThis reverts commit other.';
    world.commits.r2 = 'Revert "Tidy the README"\n\nThis reverts commit 0ddba11.';
    world.commits['0ddba11'] = 'Tidy the README (#999)';
    world.commits.r3 = 'Undo the bulk export by hand';
    const before = await world.tickets.getFactoryComment('PAY-142');

    const results = await Promise.all(['r1', 'r2', 'r3'].map((commit) => recordMerge(world.deps, { commit })));

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(before);
  });

  it('records a revert once', async () => {
    const world = await getMerged();
    await world.sourceControl.openRevertPullRequest(401);
    world.git.merge(402, 'sam');
    world.commits.m2 = 'Merge pull request #402 from acme/revert-401';

    await recordMerge(world.deps, { commit: 'm2' });
    const again = await recordMerge(world.deps, { commit: 'm2' });

    expect(again).toEqual({ ok: true });
    expect((await world.record()).events.filter((event) => event.type === 'reverted')).toHaveLength(1);
  });
});

describe('reverting from CI when main fails after an auto-merge', () => {
  it('opens a revert pull request and records it on the ticket', async () => {
    const world = await getMerged({ risk: AUTO }, 'factory-bot');
    world.clock.seconds = 1200;

    const result = await revertMerge(world.deps, { commit: 'm1' });

    const record = await world.record();
    expect(result).toEqual({ ok: true, action: 'opened', key: 'PAY-142', url: 'memory://pull/402' });
    expect(record.runs[0]?.revert).toStrictEqual({ at: '2026-11-21T08:20:00Z', by: 'main failed at m1', pullRequest: 'memory://pull/402' });
    expect(record.events.at(-1)).toEqual({ at: '2026-11-21T08:20:00Z', by: 'pierre', type: 'revert_opened', detail: 'main failed at m1' });
    expect(await world.summary()).toBe('Revert opened: main failed after the auto-merge');
    expect((await world.sourceControl.getPullRequest(402))?.reverts).toBe(401);
  });

  it('keeps the time the revert was opened once the revert pull request is merged', async () => {
    const world = await getMerged({ risk: AUTO }, 'factory-bot');
    world.clock.seconds = 1200;
    await revertMerge(world.deps, { commit: 'm1' });
    world.git.merge(402, 'sam');
    world.commits.m2 = 'Merge pull request #402 from acme/revert-401';
    world.clock.seconds = 2400;

    await recordMerge(world.deps, { commit: 'm2' });

    expect((await world.record()).runs[0]?.revert).toStrictEqual({ at: '2026-11-21T08:20:00Z', by: 'pull request 402', pullRequest: 'memory://pull/402', merged: true });
  });

  it('records that a revert is needed when source control cannot open one', async () => {
    const world = await getMerged({ risk: AUTO }, 'factory-bot');

    const result = await revertMerge(withoutRevertApi(world), { commit: 'm1' });

    const record = await world.record();
    expect(result).toEqual({ ok: true, action: 'needed', key: 'PAY-142', url: 'memory://pull/401' });
    expect(record.runs[0]?.revert).toMatchObject({ by: 'main failed at m1', needed: true });
    expect(record.runs[0]?.revert).not.toHaveProperty('pullRequest');
    expect(record.events.at(-1)?.type).toBe('revert_needed');
    expect(await world.summary()).toBe('Revert needed: main failed after the auto-merge');
  });

  it('drops "needed" once a person merges the revert', async () => {
    const world = await getMerged({ risk: AUTO }, 'factory-bot');
    await revertMerge(withoutRevertApi(world), { commit: 'm1' });
    world.commits.abc1234 = MERGE_COMMIT;
    world.commits.r1 = 'Revert "Bulk invoice export"\n\nThis reverts commit abc1234.';

    await recordMerge(world.deps, { commit: 'r1' });

    const revert = (await world.record()).runs[0]?.revert;
    expect(revert).toMatchObject({ by: 'commit r1', merged: true });
    expect(revert).not.toHaveProperty('needed');
  });

  it('puts the level back in shadow mode for the next ticket', async () => {
    const world = await getMerged({ risk: AUTO }, 'factory-bot');
    await revertMerge(world.deps, { commit: 'm1' });
    await world.tickets.transition({ key: 'PAY-142', from: 'Done', to: 'Ready for Dev' });
    await runTicket(world.deps, 'PAY-142');
    await advance(world.deps, 'PAY-142', {});
    await advance(world.deps, 'PAY-142', BUILT);
    await advance(world.deps, 'PAY-142', { verdicts: { 'openspec-verify': PASS } });

    await advance(world.deps, 'PAY-142', { verdicts: { reviewer: PASS } });

    expect((await world.record()).runs.at(-1)?.merge).toMatchObject({ route: 'human', reason: 'auto-merge for low risk is back in shadow mode after a revert' });
  });

  it.each([
    ['a person merged it', undefined, 'm1'],
    ['the commit is not a factory pull request', AUTO, 'other'],
  ])('does nothing when %s', async (_case, risk, commit) => {
    const world = await getMerged(risk === undefined ? {} : { risk });
    const before = await world.tickets.getFactoryComment('PAY-142');

    const result = await revertMerge(world.deps, { commit });

    expect(result).toEqual({ ok: true, action: 'none' });
    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(before);
    expect(await world.sourceControl.getPullRequest(402)).toBeUndefined();
  });

  it('does nothing before the merge is recorded, and nothing a second time', async () => {
    const world = await getDelivered({ risk: AUTO });

    const early = await revertMerge(world.deps, { commit: 'm1' });
    world.git.merge(401, 'factory-bot');
    await recordMerge(world.deps, { commit: 'm1' });
    const first = await revertMerge(world.deps, { commit: 'm1', pullRequest: 401 });
    const again = await revertMerge(world.deps, { commit: 'm1' });

    expect([early.action, first.action, again.action]).toEqual(['none', 'opened', 'none']);
    expect(await world.sourceControl.getPullRequest(403)).toBeUndefined();
  });
});

describe('watching staging after a deploy', () => {
  it('does nothing when the project has no watch', async () => {
    const world = await getMerged();

    expect(await watchRun(world.deps, { commit: 'm1' })).toEqual({ ok: true, action: 'off' });
    expect(world.commands).not.toContain('./smoke.sh');
  });

  it('runs the smoke checks for the whole duration, then marks the run delivered', async () => {
    const world = await getMerged({ risk: WATCHED });
    const sleeps: number[] = [];
    const deps = { ...world.deps, sleep: async (milliseconds: number) => void sleeps.push(milliseconds) };
    const before = world.commands.length;
    world.clock.seconds = 5000;

    const result = await watchRun(deps, { commit: 'm1' });

    const record = await world.record();
    expect(result).toEqual({ ok: true, action: 'delivered', key: 'PAY-142' });
    expect(world.commands.slice(before)).toEqual(['./smoke.sh', './smoke-api.sh', './smoke.sh', './smoke-api.sh', './smoke.sh', './smoke-api.sh']);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(record.runs[0]?.watch).toStrictEqual({ at: '2026-11-21T09:24:20Z', passed: true });
    expect(record.runs[0]).not.toHaveProperty('revert');
    expect(record.events.at(-1)).toMatchObject({ type: 'delivered', detail: 'the staging watch passed' });
    expect(await world.summary()).toBe('Delivered · the staging watch passed');
  });

  it('opens a revert and stops at the first smoke check that fails', async () => {
    const world = await getMerged({ risk: WATCHED });
    world.scripts['./smoke.sh'] = [{ exitCode: 0, output: 'ok', timedOut: false }, { exitCode: 1, output: `${'x'.repeat(600)}GET /health 500`, timedOut: false }];
    const before = world.commands.length;

    const result = await watchRun(world.deps, { commit: 'm1', pullRequest: 401 });

    const run = (await world.record()).runs[0];
    expect(result).toEqual({ ok: true, action: 'failed', key: 'PAY-142', check: './smoke.sh', revert: 'opened', url: 'memory://pull/402' });
    expect(world.commands.slice(before)).toEqual(['./smoke.sh', './smoke-api.sh', './smoke.sh']);
    expect(run?.watch).toMatchObject({ passed: false });
    expect(run?.watch?.detail).toBe(`./smoke.sh: ${'x'.repeat(485)}GET /health 500`);
    expect(run?.revert).toMatchObject({ by: 'the staging watch failed on ./smoke.sh', pullRequest: 'memory://pull/402' });
    expect(await world.summary()).toBe('Revert opened: the staging watch failed');
  });

  it('counts a smoke check that times out as a failure, and asks for a revert where none can be opened', async () => {
    const world = await getMerged({ risk: WATCHED });
    world.scripts['./smoke-api.sh'] = [{ exitCode: 0, output: 'hung', timedOut: true }];

    const result = await watchRun(withoutRevertApi(world), { commit: 'm1' });

    expect(result).toEqual({ ok: true, action: 'failed', key: 'PAY-142', check: './smoke-api.sh', revert: 'needed', url: 'memory://pull/401' });
    expect((await world.record()).runs[0]?.revert).toMatchObject({ needed: true });
    expect(await world.summary()).toBe('Revert needed: the staging watch failed');
  });

  it.each([
    ['opened', false],
    ['needed', true],
  ] as const)('does not open a second revert when one is already %s', async (revert, noApi) => {
    const world = await getMerged({ risk: WATCHED }, 'factory-bot');
    const deps = noApi ? withoutRevertApi(world) : world.deps;
    const reverted = await revertMerge(deps, { commit: 'm1' });
    world.scripts['./smoke.sh'] = [{ exitCode: 2, output: 'down', timedOut: false }];

    const result = await watchRun(deps, { commit: 'm1' });

    expect(result).toMatchObject({ action: 'failed', revert, url: reverted.action === 'none' ? '' : reverted.url });
    expect((await world.record()).runs[0]?.revert?.by).toBe('main failed at m1');
    expect(await world.sourceControl.getPullRequest(403)).toBeUndefined();
  });

  it('watches a change once, and only a factory change', async () => {
    const world = await getMerged({ risk: WATCHED });
    await watchRun(world.deps, { commit: 'm1' });
    const before = world.commands.length;

    const again = await watchRun(world.deps, { commit: 'm1' });
    const other = await watchRun(world.deps, { commit: 'other' });

    expect([again, other]).toEqual([{ ok: true, action: 'none' }, { ok: true, action: 'none' }]);
    expect(world.commands).toHaveLength(before);
  });

  it('runs the checks once when the duration is shorter than the interval', async () => {
    const world = await getMerged({ risk: `watch: { enabled: true, checks: [./smoke.sh], duration: 30s, interval: 1m }\n${AUTO}` });
    const before = world.commands.length;

    await watchRun(world.deps, { commit: 'm1' });

    expect(world.commands.slice(before)).toEqual(['./smoke.sh']);
  });
});
