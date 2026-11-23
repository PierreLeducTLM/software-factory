import { describe, expect, it } from 'vitest';
import { createInMemoryAgentRuntime } from '../src/adapters/in-memory-agent-runtime.js';
import type { Ticket } from '../src/adapters/ticket-provider.js';
import { advance } from '../src/factory/build-loop.js';
import { runTicket } from '../src/factory/run-lifecycle.js';
import { createRecord, parseComment, renderComment, type Run } from '../src/record/ticket-record.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';
import { BUILT, FAILING, PASS, fail, getWorld, reachReview, type World, type WorldOptions } from './fakes/loop-world.js';

const failQualityGate = async (world: World, times: number) => {
  world.scripts['pnpm test'] = Array.from({ length: times }, () => FAILING);
  await world.step();
  return Array.from({ length: times }, (_, index) => index).reduce(
    async (previous) => {
      await previous;
      return world.step(BUILT);
    },
    Promise.resolve(undefined as Awaited<ReturnType<World['step']>> | undefined),
  );
};

describe('one attempt, start to finish', () => {
  it('revalidates, then tells the agent to build attempt 1 with nothing to fix', async () => {
    const world = await getWorld();

    const result = await world.step();

    const run = (await world.record()).runs[0];
    expect(result).toEqual({ ok: true, next: 'build', attempt: 1, feedback: [] });
    expect(run?.steps.map((step) => [step.name, step.endedAt !== undefined])).toEqual([['revalidate', true], ['build', false]]);
    expect(await world.summary()).toBe('Run 1 · attempt 1 of 5 · build started');
  });

  it('runs the quality gate when the build is reported, then asks for verification', async () => {
    const world = await getWorld();
    await world.step();

    const result = await world.step(BUILT);

    const run = (await world.record()).runs[0];
    expect(await world.summary()).toBe('Run 1 · attempt 1 of 5 · verify started');
    expect(result).toEqual({ ok: true, next: 'verify', attempt: 1 });
    expect(world.commands).toEqual(['pnpm test', 'pnpm lint']);
    expect(run?.attempts).toEqual([
      {
        number: 1,
        changed: 'Added the exporter',
        decisions: ['D-001'],
        outcomes: [
          { id: 'unit-tests', station: 'quality', status: 'passed', durationSeconds: 10 },
          { id: 'lint', station: 'quality', status: 'passed', durationSeconds: 10 },
        ],
      },
    ]);
    expect(run?.steps.map((step) => step.name)).toEqual(['revalidate', 'build', 'quality', 'verify']);
    expect(run?.steps.find((step) => step.name === 'quality')?.timeoutSeconds).toBe(450);
  });

  it('asks for the review once verification passes, listing the reviewer and the agent checks in scope', async () => {
    const backend = await getWorld();
    const frontend = await getWorld({ changedFiles: ['src/ui/settings.tsx'] });

    expect(await reachReview(backend)).toEqual({ ok: true, next: 'review', attempt: 1, checks: [{ id: 'reviewer' }] });
    expect(await reachReview(frontend)).toEqual({
      ok: true,
      next: 'review',
      attempt: 1,
      checks: [{ id: 'reviewer' }, { id: 'ui-design', criteria: '.factory/checks/ui-design.md', evidence: 'screenshots' }],
    });
  });

  it('opens a pull request whose gate results and risk are the ones in the ticket\'s record', async () => {
    const world = await getWorld();
    await reachReview(world);

    await world.step({ verdicts: { reviewer: PASS } });

    const record = await world.record();
    const body = (await world.sourceControl.getPullRequest(401))?.body ?? '';
    const recorded = record.runs[0]?.attempts.at(-1)?.outcomes.map((outcome) => `- ${outcome.id} (${outcome.station}): ${outcome.status}`) ?? [];
    expect(recorded).toHaveLength(5);
    expect(recorded.filter((line) => !body.includes(line))).toEqual([]);
    expect(body).toContain(`Level: ${record.runs[0]?.risk?.level} (predicted ${record.refinement.approval?.predictedRisk}, actual low, score 0)`);
  });

  it('keeps the evidence of an agent check with its result', async () => {
    const world = await getWorld({ changedFiles: ['README.md', 'src/ui/settings.tsx'] });
    await reachReview(world);
    expect(await world.summary()).toBe('Run 1 · attempt 1 of 5 · review started');
    const uiVerdict = JSON.stringify({ verdict: 'pass', findings: [], evidence: ['shots/settings.png'] });

    await world.step({ verdicts: { reviewer: PASS, 'ui-design': uiVerdict } });

    const outcomes = (await world.record()).runs[0]?.attempts[0]?.outcomes ?? [];
    expect(outcomes.find((outcome) => outcome.id === 'ui-design')).toEqual({ id: 'ui-design', station: 'review', status: 'passed', durationSeconds: 0, evidence: ['shots/settings.png'] });
    expect(await world.status()).toBe('In review');
  });

  it('opens a pull request and moves the ticket to In review when every gate passes', async () => {
    const world = await getWorld();
    await reachReview(world);

    const result = await world.step({ verdicts: { reviewer: PASS } });

    const record = await world.record();
    const pullRequest = await world.sourceControl.getPullRequest(401);
    expect(result).toEqual({ ok: true, next: 'done', exit: 'pull_request', url: 'memory://pull/401' });
    expect(world.pushes).toEqual(['factory/pay-142']);
    expect(world.commands).toEqual(['pnpm test', 'pnpm lint', 'pnpm audit']);
    expect(await world.status()).toBe('In review');
    expect(record.state).toBe('in_review');
    expect(record.runs[0]).toMatchObject({ status: 'in_review', pullRequest: { number: 401, url: 'memory://pull/401' } });
    expect(record.runs[0]?.steps.every((step) => step.endedAt !== undefined)).toBe(true);
    expect(pullRequest?.branch).toBe('factory/pay-142');
    expect(pullRequest?.body).toBe(
      [
        'Ticket: PAY-142',
        'Spec: approved by pierre at 2026-11-21T08:00:00Z',
        '',
        '## Decisions applied',
        '- D-001',
        '',
        '## Gate results',
        '- unit-tests (quality): passed',
        '- lint (quality): passed',
        '- openspec-verify (review): passed',
        '- reviewer (review): passed',
        '- security-scan (review): passed',
        '',
        'Attempts: 1',
        '',
        '## Risk',
        'Level: low (predicted low, actual low, score 0)',
        'No risk signal',
        '',
        '## Merge',
        'Would have auto-merged: low risk is in shadow mode. A person merges this pull request.',
      ].join('\n'),
    );
    expect(await world.summary()).toBe('Run 1 · attempt 1 of 5 · pull request opened');
  });
});

const SHADOW_OFF = 'risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [src/auth/**], shadow: false }';

const deliverWith = async (options?: WorldOptions, reviewer: string = PASS) => {
  const world = await getWorld(options);
  await reachReview(world);
  await world.step({ verdicts: { reviewer } });
  const run = (await world.record()).runs[0];
  const pullRequest = await world.sourceControl.getPullRequest(401);
  return { world, run, pullRequest, body: pullRequest?.body ?? '' };
};

const getRevertedTicket = (change: (run: Run) => Run = (run) => run): Ticket => {
  const base: Run = {
    claimant: 'sam',
    machine: 'sam-mbp',
    worktreeId: 'wt-9',
    startedAt: '2026-11-10T08:00:00Z',
    status: 'merged',
    attempt: 1,
    attemptLimit: 5,
    steps: [],
    attempts: [],
    risk: { predicted: 'low', actual: 'low', level: 'low', score: 0, signals: [] },
    merge: { route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically' },
    revert: { at: '2026-11-12T09:00:00Z', by: 'pull request 77' },
  };
  const record = { ...createRecord({ repository: 'acme/billing-service' }), runs: [change(base)] };
  return getMockTicket({ key: 'PAY-100', status: 'Done', factoryComment: renderComment({ record, summary: 'Reverted' }) });
};

describe('risk and merge route at delivery', () => {
  it('records the risk report, the merge route and the pushed commit on the run', async () => {
    const { run, pullRequest } = await deliverWith();

    expect(run?.risk).toEqual({ predicted: 'low', actual: 'low', level: 'low', score: 0, signals: [] });
    expect(run?.merge).toStrictEqual({ route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode' });
    expect(run?.pullRequest).toEqual({ number: 401, url: 'memory://pull/401', headCommit: 'commit-1' });
    expect(pullRequest?.autoMerge).toBe(false);
  });

  it('takes the level of the diff when it is riskier than the spec predicted', async () => {
    const { run, body } = await deliverWith({ changedFiles: ['src/billing/export.ts', 'src/auth/session.ts'], risk: SHADOW_OFF });

    expect(run?.risk).toMatchObject({ predicted: 'low', actual: 'medium', level: 'medium', score: 4 });
    expect(body).toContain('Level: medium (predicted low, actual medium, score 4)\n- sensitive paths (+4): touches src/auth/session.ts');
    expect(body).toContain('## Merge\nMerged by a person: medium risk is merged by a person');
    expect(run?.merge).toMatchObject({ route: 'human', wouldAutoMerge: false });
  });

  it('counts the size of the change, the capabilities touched, the attempts used and advisory failures', async () => {
    const world = await getWorld({ lines: 401, specs: { 'specs__export__spec.md': '# Spec Delta\n' } });
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'factory-notes.md', content: 'x' });
    world.scripts['pnpm test'] = [FAILING];
    world.scripts['pnpm lint'] = [{ exitCode: 0, output: 'ok', timedOut: false }, { exitCode: 1, output: 'warn', timedOut: false }];
    await world.step();
    await world.step(BUILT);
    await world.step(BUILT);
    await world.step({ verdicts: { 'openspec-verify': PASS } });

    await world.step({ verdicts: { reviewer: PASS } });

    expect((await world.record()).runs[0]?.risk).toEqual({
      predicted: 'low',
      actual: 'medium',
      level: 'medium',
      score: 5,
      signals: [
        { name: 'size', points: 2, reason: '401 lines, more than 400' },
        { name: 'size', points: 1, reason: '2 capabilities touched' },
        { name: 'confidence', points: 1, reason: '2 attempts used' },
        { name: 'confidence', points: 1, reason: '1 advisory check failed' },
      ],
    });
  });

  it('turns on auto-merge for a low-risk change once shadow mode is off', async () => {
    const { run, pullRequest, body } = await deliverWith({ risk: SHADOW_OFF });

    expect(pullRequest?.autoMerge).toBe(true);
    expect(run?.merge).toEqual({ route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically' });
    expect(body).toContain('## Merge\nAuto-merge enabled: low risk merges automatically');
  });

  it('does not turn on auto-merge for a ticket that carries the no-automerge label', async () => {
    const { run, pullRequest, body } = await deliverWith({ risk: SHADOW_OFF, labels: ['factory:no-automerge'] });

    expect(pullRequest?.autoMerge).toBe(false);
    expect(run?.merge).toEqual({ route: 'human', wouldAutoMerge: false, reason: 'the ticket carries the no-automerge label' });
    expect(body).toContain('Merged by a person: the ticket carries the no-automerge label');
  });

  it('does not turn on auto-merge when the approver asked for a human merge', async () => {
    const { run, pullRequest } = await deliverWith({ risk: SHADOW_OFF, ceiling: 'human' });

    expect(pullRequest?.autoMerge).toBe(false);
    expect(run?.merge?.reason).toBe('a human merge was required at approval');
  });

  it('leaves the pull request open for a person when source control refuses the merge', async () => {
    const { world, run, body } = await deliverWith({ risk: SHADOW_OFF, refuseAutoMerge: new Error('a build has not passed') });

    expect(run?.merge).toEqual({ route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically', refused: 'a build has not passed' });
    expect(body).toContain('## Merge\nAuto-merge refused: a build has not passed. A person merges this pull request.');
    expect(body).not.toContain('Auto-merge enabled');
    expect(await world.status()).toBe('In review');
  });

  it('records the refusal even when source control gives no proper error', async () => {
    const { run } = await deliverWith({ risk: SHADOW_OFF, refuseAutoMerge: 'not allowed' });

    expect(run?.merge?.refused).toBe('not allowed');
  });

  it('lets the reviewer raise the level with a written reason', async () => {
    const verdict = JSON.stringify({ verdict: 'pass', findings: [], evidence: [], risk: 'high', riskReason: 'Changes how invoices are rounded' });

    const { run, body, pullRequest } = await deliverWith({ risk: SHADOW_OFF }, verdict);

    expect(run?.risk).toMatchObject({ actual: 'low', level: 'high', raised: 'Changes how invoices are rounded' });
    expect(body).toContain('Level: high (predicted low, actual low, score 0)\nNo risk signal\nRaised by the reviewer: Changes how invoices are rounded\n');
    expect(pullRequest?.autoMerge).toBe(false);
  });

  it('ignores a reviewer who tries to lower the level, or who gives no reason', async () => {
    const lower = JSON.stringify({ verdict: 'pass', findings: [], evidence: [], risk: 'low', riskReason: 'It is small' });
    const silent = JSON.stringify({ verdict: 'pass', findings: [], evidence: [], risk: 'high', riskReason: '' });
    const files = { changedFiles: ['src/auth/session.ts'] };

    const lowered = await deliverWith(files, lower);
    const unexplained = await deliverWith(files, silent);

    expect(lowered.run?.risk).toMatchObject({ level: 'medium' });
    expect(lowered.run?.risk).not.toHaveProperty('raised');
    expect(lowered.body).not.toContain('Raised by the reviewer');
    expect(unexplained.run?.risk).toMatchObject({ level: 'medium' });
    expect(unexplained.run?.risk).not.toHaveProperty('raised');
  });

  it('adds the signals of the project risk script, which may also lower the score', async () => {
    const world = await getWorld({ changedFiles: ['src/auth/session.ts'], risk: `${SHADOW_OFF.slice(0, -2)}, script: ./risk.sh }` });
    world.scripts['./risk.sh'] = [{ exitCode: 0, timedOut: false, output: 'scoring\n{"signals":[{"name":"feature flag","points":-2,"reason":"behind invoices.bulk"},{"name":"coverage","points":0,"reason":"all changed lines covered"}]}' }];
    await reachReview(world);

    await world.step({ verdicts: { reviewer: PASS } });

    const body = (await world.sourceControl.getPullRequest(401))?.body ?? '';
    expect((await world.record()).runs[0]?.risk).toMatchObject({ actual: 'low', level: 'low', score: 2 });
    expect(body).toContain('- sensitive paths (+4): touches src/auth/session.ts\n- feature flag (-2): behind invoices.bulk\n- coverage (+0): all changed lines covered');
    expect(world.commands.at(-1)).toBe('./risk.sh');
  });

  it('never scores below zero', async () => {
    const world = await getWorld({ risk: `${SHADOW_OFF.slice(0, -2)}, script: ./risk.sh }` });
    world.scripts['./risk.sh'] = [{ exitCode: 0, timedOut: false, output: '{"signals":[{"name":"feature flag","points":-2,"reason":"behind a flag"}]}' }];
    await reachReview(world);

    await world.step({ verdicts: { reviewer: PASS } });

    expect((await world.record()).runs[0]?.risk).toMatchObject({ score: 0, level: 'low' });
  });

  it.each([
    ['fails', { exitCode: 1, timedOut: false, output: '{"signals":[]}' }],
    ['times out', { exitCode: 0, timedOut: true, output: '{"signals":[]}' }],
    ['prints something else', { exitCode: 0, timedOut: false, output: 'done' }],
    ['prints signals without a name', { exitCode: 0, timedOut: false, output: '{"signals":[{"name":"","points":1,"reason":"x"}]}' }],
  ])('treats the change as high risk when the risk script %s', async (_case, scriptRun) => {
    const world = await getWorld({ risk: `${SHADOW_OFF.slice(0, -2)}, script: ./risk.sh }` });
    world.scripts['./risk.sh'] = [scriptRun];
    await reachReview(world);

    await world.step({ verdicts: { reviewer: PASS } });

    expect((await world.record()).runs[0]?.risk).toMatchObject({
      level: 'high',
      score: 6,
      signals: [{ name: 'risk script', points: 6, reason: 'the risk script failed, so the change is treated as high risk' }],
    });
  });

  it('goes back to shadow mode for a level after an auto-merged change of that level was reverted', async () => {
    const { run, pullRequest, body } = await deliverWith({ risk: SHADOW_OFF, others: [getRevertedTicket()] });

    expect(pullRequest?.autoMerge).toBe(false);
    expect(run?.merge).toEqual({ route: 'human', wouldAutoMerge: true, reason: 'auto-merge for low risk is back in shadow mode after a revert' });
    expect(body).toContain('Would have auto-merged: auto-merge for low risk is back in shadow mode after a revert. A person merges this pull request.');
  });

  const unrelated: readonly (readonly [string, (run: Run) => Run])[] = [
    ['a person merged it', (run) => ({ ...run, merge: { route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode' } })],
    ['auto-merge had been refused', (run) => ({ ...run, merge: { route: 'auto', wouldAutoMerge: true, reason: 'x', refused: 'a build has not passed' } })],
    ['it was of another level', (run) => ({ ...run, risk: { predicted: 'low', actual: 'medium', level: 'medium', score: 4, signals: [] } })],
    ['it was not reverted', ({ revert: _revert, ...run }) => run],
    ['it has no risk on record', ({ risk: _risk, ...run }) => run],
    ['it has no merge on record', ({ merge: _merge, ...run }) => run],
  ];

  it.each(unrelated)('keeps auto-merge on when the earlier change does not count: %s', async (_case, change) => {
    const { pullRequest } = await deliverWith({ risk: SHADOW_OFF, others: [getRevertedTicket(change)] });

    expect(pullRequest?.autoMerge).toBe(true);
  });

  it('finds the revert on any run of a ticket, even when its comment was edited by hand', async () => {
    const reverted = getRevertedTicket();
    const earlier: Run = { claimant: 'sam', machine: 'sam-mbp', worktreeId: 'wt-8', startedAt: '2026-11-09T08:00:00Z', status: 'blocked', attempt: 5, attemptLimit: 5, steps: [], attempts: [] };
    const parsed = parseComment(reverted.factoryComment ?? '', { trustEdited: false });
    if (parsed.status !== 'ok') throw new Error('invalid test record');
    const twoRuns = renderComment({ record: { ...parsed.record, runs: [earlier, ...parsed.record.runs] }, summary: 'Reverted' });

    const { pullRequest } = await deliverWith({ risk: SHADOW_OFF, others: [{ ...reverted, factoryComment: twoRuns.replace('Reverted', 'Edited').replace('"sam-mbp"', '"sams-mbp"') }] });

    expect(pullRequest?.autoMerge).toBe(false);
  });

  it('turns auto-merge back on once the level is re-enabled after the revert', async () => {
    const since = (date: string) => `risk: { low: { merge: auto, auto_since: "${date}" }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [], shadow: false }`;
    const reverted = { ...getRevertedTicket(), updatedAt: '2026-11-20T10:00:00Z' };

    const reenabled = await deliverWith({ risk: since('2026-11-13'), others: [reverted] });
    const sameDay = await deliverWith({ risk: since('2026-11-12'), others: [reverted] });

    expect(reenabled.pullRequest?.autoMerge).toBe(true);
    expect(sameDay.pullRequest?.autoMerge).toBe(false);
  });

  it('ignores tickets whose record cannot be read when looking for reverts', async () => {
    const others = [getMockTicket({ key: 'PAY-7', status: 'Done' }), getMockTicket({ key: 'PAY-8', status: 'Done', factoryComment: 'Hello\n\n```factory-record sha256=00\n{"schema":9}\n```\n' })];

    const { pullRequest } = await deliverWith({ risk: SHADOW_OFF, others });

    expect(pullRequest?.autoMerge).toBe(true);
  });
});

describe('failures and retries', () => {
  it('skips verify and review when the quality gate fails, and feeds the failure to the next attempt', async () => {
    const world = await getWorld();
    world.scripts['pnpm test'] = [FAILING];
    await world.step();

    const result = await world.step(BUILT);

    const run = (await world.record()).runs[0];
    expect(result).toEqual({
      ok: true,
      next: 'build',
      attempt: 2,
      feedback: [{ id: 'unit-tests', station: 'quality', status: 'failed', reason: 'exit code 1', detail: FAILING.output, durationSeconds: 10 }],
    });
    expect(run?.attempt).toBe(2);
    expect(await world.summary()).toBe('Run 1 · attempt 2 of 5 · build started');
    expect(run?.steps.map((step) => [step.name, step.attempt])).toEqual([['revalidate', 1], ['build', 1], ['quality', 1], ['build', 2]]);
    expect(world.commands).toEqual(['pnpm test', 'pnpm lint']);
  });

  it('does not ask for the review when verification finds an uncovered scenario', async () => {
    const world = await getWorld();
    await world.step();
    await world.step(BUILT);

    const result = await world.step({ verdicts: { 'openspec-verify': fail('Scenario "totals in mixed currencies" is not covered') } });

    expect(result).toMatchObject({ next: 'build', attempt: 2, feedback: [{ id: 'openspec-verify', reason: 'findings', detail: 'Scenario "totals in mixed currencies" is not covered' }] });
    expect(world.commands).not.toContain('pnpm audit');
  });

  it('starts another attempt when the reviewer, a review script or an agent check fails', async () => {
    const reviewer = await getWorld();
    const script = await getWorld();
    const agentCheck = await getWorld({ changedFiles: ['src/ui/settings.tsx'] });
    script.scripts['pnpm audit'] = [{ exitCode: 1, output: '1 high severity vulnerability', timedOut: false }];
    await Promise.all([reviewer, script, agentCheck].map(reachReview));

    const byReviewer = await reviewer.step({ verdicts: { reviewer: fail('Rounds before summing') } });
    const byScript = await script.step({ verdicts: { reviewer: PASS } });
    const byAgentCheck = await agentCheck.step({ verdicts: { reviewer: PASS } });

    expect(byReviewer).toMatchObject({ next: 'build', attempt: 2, feedback: [{ id: 'reviewer' }] });
    expect(byScript).toMatchObject({ next: 'build', attempt: 2, feedback: [{ id: 'security-scan', detail: '1 high severity vulnerability' }] });
    expect(byAgentCheck).toMatchObject({ next: 'build', attempt: 2, feedback: [{ id: 'ui-design', reason: 'invalid verdict' }] });
  });

  it('counts attempts per run, so alternating gate and review failures reach the limit', async () => {
    const world = await getWorld();
    world.scripts['pnpm test'] = [FAILING, { exitCode: 0, output: 'ok', timedOut: false }, FAILING, { exitCode: 0, output: 'ok', timedOut: false }, FAILING];
    await world.step();

    const first = await world.step(BUILT);
    await world.step(BUILT);
    await world.step({ verdicts: { 'openspec-verify': PASS } });
    const second = await world.step({ verdicts: { reviewer: fail('Rounds before summing') } });
    const third = await world.step(BUILT);
    await world.step(BUILT);
    await world.step({ verdicts: { 'openspec-verify': PASS } });
    const fourth = await world.step({ verdicts: { reviewer: fail('Still rounds before summing') } });
    const fifth = await world.step(BUILT);

    expect([first, second, third, fourth].map((result) => result.ok && result.next === 'build' && result.attempt)).toEqual([2, 3, 4, 5]);
    expect(fifth).toMatchObject({ ok: true, next: 'diagnose' });
    expect((await world.record()).runs[0]?.attempt).toBe(5);
  });

  it('honours the attempt limit the project configured', async () => {
    const world = await getWorld({ attempts: 2 });

    expect(await failQualityGate(world, 2)).toMatchObject({ next: 'diagnose' });
  });

  it('opens the pull request on a later attempt, saying how many it took and listing a warning', async () => {
    const world = await getWorld();
    world.scripts['pnpm test'] = [FAILING];
    world.scripts['pnpm lint'] = [{ exitCode: 0, output: 'ok', timedOut: false }, { exitCode: 1, output: '2 problems', timedOut: false }];
    await world.step();
    await world.step(BUILT);
    await world.step({ built: { changed: 'Export in chunks', decisions: ['D-004'] } });
    await world.step({ verdicts: { 'openspec-verify': PASS } });

    const result = await world.step({ verdicts: { reviewer: PASS } });

    const body = (await world.sourceControl.getPullRequest(401))?.body ?? '';
    expect(result).toMatchObject({ exit: 'pull_request' });
    expect(body).toContain('Attempts: 2');
    expect(body).toContain('## Decisions applied\n- D-001\n- D-004');
    expect(body).toContain('- lint (quality): warning (exit code 1)');
    expect(await world.status()).toBe('In review');
  });

  it('says no decision was applied when the builder reported none', async () => {
    const world = await getWorld();
    await world.step();
    await world.step({ built: { changed: 'Added the exporter', decisions: [] } });
    await world.step({ verdicts: { 'openspec-verify': PASS } });

    await world.step({ verdicts: { reviewer: PASS } });

    expect((await world.sourceControl.getPullRequest(401))?.body).toContain('## Decisions applied\nNone recorded');
  });
});

describe('questions during development', () => {
  it('sends the ticket back with the question and a recommended answer, asking nobody', async () => {
    const world = await getWorld();
    await world.step();
    const question = { question: 'Should a partial refund without an amount be rejected?', recommended: 'Yes, reject it.' };

    const result = await world.step({ question });

    const record = await world.record();
    expect(result).toEqual({ ok: true, next: 'done', exit: 'sent_back', findings: ['Should a partial refund without an amount be rejected?'] });
    expect(await world.status()).toBe('Spec review');
    expect(record.state).toBe('spec_review');
    expect(record.runs[0]?.status).toBe('sent_back');
    expect(record.refinement.sendBack?.questions).toEqual([question]);
    expect(world.commands).toEqual([]);
    expect(await world.summary()).toBe('Run 1 · attempt 1 of 5 · sent back to refinement');
  });

  it('sends the ticket back at the start when main drifted, before any build', async () => {
    const world = await getWorld();
    world.changedOnMain.push('src/billing/rounding.ts');

    const result = await world.step();

    expect(result).toEqual({ ok: true, next: 'done', exit: 'sent_back', findings: ['Changed on main since approval: src/billing/rounding.ts'] });
    expect(await world.status()).toBe('Spec review');
    expect((await world.record()).runs[0]?.steps).toEqual([]);
  });
});

describe('after the last attempt', () => {
  it('asks for one diagnosis, showing what failed and what changed in each attempt', async () => {
    const world = await getWorld({ attempts: 2 });

    const result = await failQualityGate(world, 2);

    expect(result).toEqual({
      ok: true,
      next: 'diagnose',
      attempts: [
        { number: 1, changed: 'Added the exporter', failures: [{ id: 'unit-tests', station: 'quality', status: 'failed', reason: 'exit code 1', detail: FAILING.output, durationSeconds: 10 }] },
        { number: 2, changed: 'Added the exporter', failures: [{ id: 'unit-tests', station: 'quality', status: 'failed', reason: 'exit code 1', detail: FAILING.output, durationSeconds: 10 }] },
      ],
    });
    expect(await world.status()).toBe('In development');
    expect(await world.summary()).toBe('Run 1 · attempt 2 of 2 · diagnosis needed');
  });

  it('writes a failure with no output as a single line in the report, and keeps only the first line of a long one', async () => {
    const world = await getWorld({ attempts: 2 });
    world.scripts['pnpm test'] = [{ exitCode: 1, output: 'first line\nsecond line', timedOut: false }];
    await world.step();
    await world.step(BUILT);
    await world.step(BUILT);
    await world.step({ verdicts: { 'openspec-verify': 'no verdict here' } });

    const result = await world.step({ diagnosis: { kind: 'code' } });

    const report = await world.tickets.readAttachment(result.ok && result.next === 'done' && result.exit === 'blocked' ? result.report : '');
    expect(report).toContain('## Attempt 1\n- Failed: unit-tests (quality): exit code 1\n  first line\n- Changed: Added the exporter\n');
    expect(report).toContain('## Attempt 2\n- Failed: openspec-verify (review): invalid verdict\n- Changed: Added the exporter\n');
  });

  it('posts no report until a diagnosis is given', async () => {
    const world = await getWorld({ attempts: 1 });
    await failQualityGate(world, 1);

    const result = await world.step();

    expect(result).toEqual({ ok: false, reason: 'input_required', message: 'Give one diagnosis: code, spec or environment' });
    expect(await world.status()).toBe('In development');
    expect((await world.tickets.listAttachments('PAY-142')).some((attachment) => attachment.name.startsWith('factory-failure-report'))).toBe(false);
  });

  it.each(['code', 'environment'] as const)('blocks the ticket with a failure report on a %s diagnosis', async (kind) => {
    const world = await getWorld({ attempts: 2 });
    await failQualityGate(world, 2);

    const result = await world.step({ diagnosis: { kind, nextStep: 'Stabilize the exchange-rate fixture' } });

    const record = await world.record();
    const report = (await world.tickets.listAttachments('PAY-142')).find((attachment) => attachment.name === 'factory-failure-report-run-1.md');
    expect(result).toEqual({ ok: true, next: 'done', exit: 'blocked', report: report?.link });
    expect(await world.status()).toBe('Blocked');
    expect(record.state).toBe('blocked');
    expect(record.runs[0]).toMatchObject({ status: 'blocked', diagnosis: kind, report: report?.link });
    expect(await world.tickets.readAttachment(report?.link ?? '')).toBe(
      [
        '# Failure report: PAY-142, run 1',
        '',
        `Diagnosis: ${kind}`,
        '',
        '## Attempt 1',
        '- Failed: unit-tests (quality): exit code 1',
        `  ${FAILING.output}`,
        '- Changed: Added the exporter',
        '',
        '## Attempt 2',
        '- Failed: unit-tests (quality): exit code 1',
        `  ${FAILING.output}`,
        '- Changed: Added the exporter',
        '',
        'Branch: factory/pay-142',
        'Suggested next step: Stabilize the exchange-rate fixture',
        '',
      ].join('\n'),
    );
    expect(await world.summary()).toBe(`Run 1 · attempt 2 of 2 · blocked (${kind})`);
  });

  it('leaves the suggested next step out of the report when none is given', async () => {
    const world = await getWorld({ attempts: 1 });
    await failQualityGate(world, 1);

    const result = await world.step({ diagnosis: { kind: 'code' } });

    const report = await world.tickets.readAttachment(result.ok && result.next === 'done' && result.exit === 'blocked' ? result.report : '');
    expect(report.endsWith('Branch: factory/pay-142\n')).toBe(true);
  });

  it('sends the ticket back instead of blocking it on a spec diagnosis, with each finding as a question', async () => {
    const world = await getWorld({ attempts: 1 });
    await failQualityGate(world, 1);
    const questions = [{ question: 'Should totals round before or after summing?', recommended: 'After summing.' }];

    const result = await world.step({ diagnosis: { kind: 'spec', questions } });

    const record = await world.record();
    expect(result).toEqual({ ok: true, next: 'done', exit: 'sent_back', findings: ['Should totals round before or after summing?'] });
    expect(await world.status()).toBe('Spec review');
    expect(record.runs[0]).toMatchObject({ status: 'sent_back', diagnosis: 'spec' });
    expect(record.refinement.sendBack?.questions).toEqual(questions);
  });

  it('refuses a spec diagnosis that brings no question', async () => {
    const world = await getWorld({ attempts: 1 });
    await failQualityGate(world, 1);

    expect(await world.step({ diagnosis: { kind: 'spec' } })).toEqual({ ok: false, reason: 'input_required', message: 'A spec diagnosis needs at least one question with a recommended answer' });
    expect(await world.step({ diagnosis: { kind: 'spec', questions: [] } })).toMatchObject({ ok: false, reason: 'input_required' });
    expect(await world.status()).toBe('In development');
  });
});

describe('retrying a blocked ticket', () => {
  const block = async (world: World) => {
    await failQualityGate(world, 1);
    await world.step({ diagnosis: { kind: 'environment' } });
  };

  it('revalidates and builds again in a new run once the developer confirms the retry', async () => {
    const world = await getWorld({ attempts: 1 });
    await block(world);

    const retried = await runTicket(world.deps, 'PAY-142', { confirmRetry: true });
    const result = await world.step();

    expect(retried).toMatchObject({ ok: true, action: 'started', run: 2, attempt: 1 });
    expect(result).toEqual({ ok: true, next: 'build', attempt: 1, feedback: [] });
    expect((await world.record()).runs.map((run) => run.status)).toEqual(['blocked', 'running']);
  });

  it('sends the ticket back instead of building when main drifted while it was blocked', async () => {
    const world = await getWorld({ attempts: 1 });
    await block(world);
    world.changedOnMain.push('src/billing/rounding.ts');
    await runTicket(world.deps, 'PAY-142', { confirmRetry: true });

    const result = await world.step();

    expect(result).toMatchObject({ next: 'done', exit: 'sent_back' });
    expect(await world.status()).toBe('Spec review');
  });
});

describe('what advance needs to be told', () => {
  it('refuses to go on from a build with no report of what was built', async () => {
    const world = await getWorld();
    await world.step();

    expect(await world.step()).toEqual({ ok: false, reason: 'input_required', message: 'Say what was built, or hand in a question the spec does not answer' });
    expect(world.commands).toEqual([]);
  });

  it('refuses to go on from verification with no verdict', async () => {
    const world = await getWorld();
    await world.step();
    await world.step(BUILT);

    expect(await world.step({ verdicts: { reviewer: PASS } })).toEqual({ ok: false, reason: 'input_required', message: 'Hand in the verdict of openspec-verify' });
  });

  it('refuses to go on from the review with no reviewer verdict', async () => {
    const world = await getWorld();
    await reachReview(world);

    expect(await world.step({ verdicts: {} })).toEqual({ ok: false, reason: 'input_required', message: 'Hand in the verdict of reviewer' });
    expect(await world.step()).toMatchObject({ ok: false, reason: 'input_required' });
    expect(world.commands).not.toContain('pnpm audit');
  });

  it('refuses a ticket with no run in progress, and a ticket that does not exist', async () => {
    const world = await getWorld();
    await reachReview(world);
    await world.step({ verdicts: { reviewer: PASS } });

    expect(await world.step()).toEqual({ ok: false, reason: 'no_run', message: 'PAY-142 has no run in progress' });
    expect(await advance(world.deps, 'PAY-999', {})).toEqual({ ok: false, reason: 'no_run', message: 'PAY-999 has no run in progress' });
  });

  it('refuses a ticket whose status was moved out of development by hand', async () => {
    const world = await getWorld();
    await world.step();
    await world.tickets.transition({ key: 'PAY-142', from: 'In development', to: 'Blocked' });

    expect(await world.step(BUILT)).toEqual({ ok: false, reason: 'no_run', message: 'PAY-142 has no run in progress' });
  });

  it('fails loudly on a record whose current step has no attempt behind it', async () => {
    const world = await getWorld();
    await world.step();
    await world.step(BUILT);
    const record = await world.record();
    const { saveRecord } = await import('../src/record/record-store.js');
    await saveRecord(world.tickets, { key: 'PAY-142', record: { ...record, runs: record.runs.map((run) => ({ ...run, attempts: [] })) }, summary: 'x', budget: 100_000 });

    await expect(world.step({ verdicts: { 'openspec-verify': 'not a verdict' } })).rejects.toThrow('The run has no attempt');
  });

  it('refuses to run outside an Orca worktree', async () => {
    const world = await getWorld();

    const result = await advance({ ...world.deps, runtime: createInMemoryAgentRuntime({}) }, 'PAY-142', {});

    expect(result).toEqual({ ok: false, reason: 'no_worktree', message: 'Run this from inside an Orca worktree' });
  });
});

const SPEC_PATHS = ['design.md', 'proposal.md', 'specs/billing/spec.md', 'tasks.md'];
const active = (name: string, files: readonly string[] = SPEC_PATHS) => ({ name, files, archived: false });
const archivedOnBranch = (name: string, files: readonly string[] = SPEC_PATHS) => ({ name, files, archived: true });
const NOT_FOUND = 'The approved spec of PAY-142 is not in one folder under openspec/changes/. Pull it with factory pull PAY-142 --to openspec/changes/<name> and commit it.';
const ARCHIVE_ERROR = 'billing MODIFIED failed for header "### Requirement: Bulk export" - not found\nAborted. No files were changed.';

describe('archiving the change at delivery', () => {
  it('archives the folder that holds the approved spec, then pushes the branch and opens the pull request', async () => {
    const changeFolders = [
      active('other-change', ['proposal.md', 'tasks.md']),
      active('billing-export'),
    ];

    const { world, pullRequest } = await deliverWith({ changeFolders });

    expect(world.events).toEqual(['archive billing-export', 'push factory/pay-142']);
    expect(pullRequest?.branch).toBe('factory/pay-142');
  });

  it('scores the risk with the files the archive changed', async () => {
    const changedFiles = Array.from({ length: 15 }, (_, index) => `src/billing/file-${index}.ts`);

    const { run } = await deliverWith({ changedFiles, archivedFiles: ['openspec/specs/billing/spec.md'] });

    expect(run?.risk?.signals).toContainEqual({ name: 'size', points: 2, reason: '16 files, more than 15' });
  });

  it('archives nothing when an attempt fails, so the next attempt builds against the change as it was', async () => {
    const world = await getWorld();
    await reachReview(world);

    const result = await world.step({ verdicts: { reviewer: fail('Rounds before summing') } });

    expect(result).toMatchObject({ next: 'build', attempt: 2 });
    expect(world.events).toEqual([]);
  });

  it('sends the ticket back with the archive error, without a pull request, when the change cannot be archived', async () => {
    const { world, pullRequest } = await deliverWith({ archiveError: ARCHIVE_ERROR });

    const record = await world.record();
    expect(world.events).toEqual(['archive billing-export']);
    expect(world.pushes).toEqual([]);
    expect(pullRequest).toBeUndefined();
    expect(await world.status()).toBe('Spec review');
    expect(record.runs[0]?.status).toBe('sent_back');
    expect(record.refinement.sendBack?.questions).toEqual([
      {
        question: `openspec archive billing-export failed:\n${ARCHIVE_ERROR}\nHow should the delta spec change so that it applies to the canonical specs in openspec/specs/?`,
        recommended: 'Fix the delta spec so that it applies to the canonical specs in openspec/specs/, then run the ready gate again.',
      },
    ]);
  });

  it('answers sent back when the archive fails', async () => {
    const world = await getWorld({ archiveError: ARCHIVE_ERROR });
    await reachReview(world);

    const result = await world.step({ verdicts: { reviewer: PASS } });

    expect(result).toEqual({
      ok: true,
      next: 'done',
      exit: 'sent_back',
      findings: [`openspec archive billing-export failed:\n${ARCHIVE_ERROR}\nHow should the delta spec change so that it applies to the canonical specs in openspec/specs/?`],
    });
  });

  it.each([
    ['no folder holds the approved spec', [active('other-change', ['proposal.md', 'tasks.md'])]],
    ['a folder holds the approved spec and one more spec file', [active('billing-export', [...SPEC_PATHS, 'specs/ledger/spec.md'])]],
    ['a folder holds only part of the approved spec', [active('billing-export', ['design.md', 'proposal.md', 'specs/billing/spec.md'])]],
    ['a folder holds another delta spec in place of the approved one', [active('billing-export', ['design.md', 'proposal.md', 'specs/ledger/spec.md', 'tasks.md'])]],
    ['two folders hold the approved spec', [active('billing-export'), active('billing-export-copy')]],
    ['two archives of the approved spec were added on the branch', [archivedOnBranch('2026-11-20-billing-export'), archivedOnBranch('2026-11-21-billing-export')]],
  ])('fails the attempt without archiving or opening a pull request when %s', async (_, changeFolders) => {
    const world = await getWorld({ changeFolders });
    await reachReview(world);

    const result = await world.step({ verdicts: { reviewer: PASS } });

    expect(result).toEqual({
      ok: true,
      next: 'build',
      attempt: 2,
      feedback: [{ id: 'archive', station: 'review', status: 'failed', reason: NOT_FOUND, durationSeconds: 0 }],
    });
    expect(world.events).toEqual([]);
    expect(await world.sourceControl.getPullRequest(401)).toBeUndefined();
  });

  it('asks for a diagnosis when the change cannot be found on the last attempt', async () => {
    const world = await getWorld({ attempts: 1, changeFolders: [] });
    await reachReview(world);

    const result = await world.step({ verdicts: { reviewer: PASS } });

    expect(result).toMatchObject({ next: 'diagnose', attempts: [{ number: 1, failures: [{ id: 'archive', reason: NOT_FOUND }] }] });
  });

  it('compares the folder with the spec files of the ticket only, not its other attachments', async () => {
    const { world } = await deliverWith({
      specs: { 'mockup.png': 'png', 'factory-failure-report-run-1.md': '# Failure report' },
      changeFolders: [active('billing-export')],
    });

    expect(world.events).toEqual(['archive billing-export', 'push factory/pay-142']);
  });

  it('matches the folder by its markdown files, whatever else it holds', async () => {
    const { world } = await deliverWith({ changeFolders: [active('billing-export', [...SPEC_PATHS, '.openspec.yaml'])] });

    expect(world.events).toEqual(['archive billing-export', 'push factory/pay-142']);
  });

  it('opens the pull request without archiving again when a delivery is resumed after its archive landed', async () => {
    const world = await getWorld({ pushFailures: 1 });
    await reachReview(world);
    const interrupted = await world.step({ verdicts: { reviewer: PASS } }).catch((error: unknown) => (error instanceof Error ? error.message : 'no error'));

    const resumed = await world.step({ verdicts: { reviewer: PASS } });

    expect(interrupted).toBe('git push failed: could not reach origin');
    expect(resumed).toEqual({ ok: true, next: 'done', exit: 'pull_request', url: 'memory://pull/401' });
    expect(world.events).toEqual(['archive billing-export', 'push factory/pay-142', 'push factory/pay-142']);
  });

  it('archives the change folder rather than resuming when the branch holds both the change and an archive of it', async () => {
    const { world } = await deliverWith({ changeFolders: [archivedOnBranch('2026-11-20-billing-export'), active('billing-export')] });

    expect(world.events).toEqual(['archive billing-export', 'push factory/pay-142']);
  });

  it('stops with the error and keeps the run where it was when the openspec command cannot run at all', async () => {
    const world = await getWorld({ archiveThrows: 'spawn openspec ENOENT' });
    await reachReview(world);

    const stopped = await world.step({ verdicts: { reviewer: PASS } }).catch((error: unknown) => (error instanceof Error ? error.message : 'no error'));

    const record = await world.record();
    expect(stopped).toBe('spawn openspec ENOENT');
    expect(world.pushes).toEqual([]);
    expect(await world.status()).toBe('In development');
    expect(record.runs[0]?.status).toBe('running');
    expect(record.runs[0]?.steps.at(-1)).toMatchObject({ name: 'review' });
    expect(record.runs[0]?.steps.at(-1)?.endedAt).toBeUndefined();
  });
});
