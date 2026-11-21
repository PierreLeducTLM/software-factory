import { describe, expect, it } from 'vitest';
import { createInMemoryAgentRuntime } from '../src/adapters/in-memory-agent-runtime.js';
import { createInMemorySourceControl } from '../src/adapters/in-memory-source-control.js';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import { parseFactoryConfig, type FactoryConfig } from '../src/config/project-config.js';
import { advance, type AdvanceInput, type LoopDeps } from '../src/factory/build-loop.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { approve } from '../src/factory/refinement.js';
import { runTicket } from '../src/factory/run-lifecycle.js';
import { loadRecord } from '../src/record/record-store.js';
import type { TicketRecord } from '../src/record/ticket-record.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const getConfig = (attempts = 5): FactoryConfig => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
limits: { attempts: ${attempts}, runs: 3 }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm test }
  - { id: lint, station: quality, kind: script, blocking: false, timeout: 90s, run: pnpm lint }
  - { id: security-scan, station: review, kind: script, blocking: true, timeout: 5m, run: pnpm audit }
  - { id: risk-notes, station: risk, kind: agent, blocking: true, timeout: 5m, criteria: .factory/checks/risk.md, evidence: notes }
  - { id: ui-design, station: review, kind: agent, blocking: true, timeout: 10m, applies_when: "changed: src/ui/**", criteria: .factory/checks/ui-design.md, evidence: screenshots }
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const SPEC_FILES: Readonly<Record<string, string>> = {
  'proposal.md': '# Proposal\n\n## Affected paths\n- `src/billing/**`\n',
  'design.md': '# Design\n\n## Decisions\n- D-001: chunks.\n',
  'tasks.md': '# Tasks\n\n- [ ] 1.1 Add the exporter and verify the test passes\n',
  'specs__billing__spec.md': '# Spec Delta\n',
};

const PASS = JSON.stringify({ verdict: 'pass', findings: [], evidence: [] });
const fail = (...findings: readonly string[]): string => JSON.stringify({ verdict: 'fail', findings, evidence: [] });
const FAILING: ScriptRun = { exitCode: 1, output: 'export.test.ts › splits files: expected 2, got 1', timedOut: false };
const BUILT: AdvanceInput = { built: { changed: 'Added the exporter', decisions: ['D-001'] } };

const getWorld = async (options?: { readonly attempts?: number; readonly changedFiles?: readonly string[] }) => {
  const clock = { seconds: 0 };
  const now = (): string => new Date(Date.UTC(2026, 10, 21, 8, 0, clock.seconds)).toISOString().replace('.000Z', 'Z');
  const tickets = createInMemoryTicketProvider({ tickets: [getMockTicket({ status: 'Spec review' })], now });
  await Object.entries(SPEC_FILES).reduce(async (previous, [name, content]) => {
    await previous;
    await tickets.addAttachment({ key: 'PAY-142', name, content });
  }, Promise.resolve());
  const { sourceControl, world: git } = createInMemorySourceControl({ now });
  const scripts: Record<string, ScriptRun[]> = {};
  const commands: string[] = [];
  const pushes: string[] = [];
  const changedOnMain: string[] = [];
  const deps: LoopDeps = {
    tickets,
    runtime: createInMemoryAgentRuntime({ worktree: { id: 'wt-1', path: '/work/pay-142', branch: 'factory/pay-142', host: 'pierre-mbp' } }),
    config: getConfig(options?.attempts),
    user: 'pierre',
    now,
    recordBudget: 100_000,
    machine: 'pierre-mbp',
    validateSpec: async () => [],
    predictRisk: async () => 'low',
    mainCommit: async () => 'a41c9e2',
    changedFilesSince: async () => changedOnMain,
    sourceControl,
    runScript: async (command) => {
      commands.push(command);
      clock.seconds += 10;
      return scripts[command]?.shift() ?? { exitCode: 0, output: 'ok', timedOut: false };
    },
    sleep: async () => undefined,
    changedFilesOnBranch: async () => options?.changedFiles ?? ['src/billing/export.ts'],
    pushBranch: async (branch) => {
      pushes.push(branch);
      git.push(branch, `commit-${pushes.length}`);
    },
  };
  await approve(deps, 'PAY-142');
  await runTicket(deps, 'PAY-142');
  const record = async (): Promise<TicketRecord> => {
    const loaded = await loadRecord(tickets, 'PAY-142');
    if (loaded.status !== 'ok') throw new Error(`no record: ${loaded.status}`);
    return loaded.record;
  };
  return {
    deps,
    tickets,
    sourceControl,
    scripts,
    commands,
    pushes,
    changedOnMain,
    record,
    status: async () => (await tickets.getTicket('PAY-142'))?.status,
    step: (input: AdvanceInput = {}) => advance(deps, 'PAY-142', input),
    summary: async () => (await tickets.getFactoryComment('PAY-142'))?.split('\n')[0],
  };
};

type World = Awaited<ReturnType<typeof getWorld>>;

const reachReview = async (world: World) => {
  await world.step();
  await world.step(BUILT);
  return world.step({ verdicts: { 'openspec-verify': PASS } });
};

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
    expect(body).toContain(`Risk: predicted ${record.refinement.approval?.predictedRisk}`);
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
        'Risk: predicted low',
      ].join('\n'),
    );
    expect(await world.summary()).toBe('Run 1 · attempt 1 of 5 · pull request opened');
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
