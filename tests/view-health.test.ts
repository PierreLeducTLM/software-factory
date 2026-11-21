import { describe, expect, it } from 'vitest';
import { parseFactoryConfig, type FactoryConfig } from '../src/config/project-config.js';
import { createRecord, renderComment, type FactoryEvent, type Run, type TicketRecord } from '../src/record/ticket-record.js';
import { buildHealth, type HealthOptions } from '../src/view/health.js';
import type { ViewTicket } from '../src/view/model.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const getConfig = (risk = 'risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [], shadow_threshold: 3 }'): FactoryConfig => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks: []
${risk}
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const getOptions = (overrides?: Partial<HealthOptions>): HealthOptions => ({
  config: getConfig(),
  now: '2026-11-21T12:00:00Z',
  repository: 'acme/billing-service',
  periodDays: 7,
  ...overrides,
});

const day = (date: number, time = '10:00:00'): string => `2026-11-${String(date).padStart(2, '0')}T${time}Z`;

const getRun = (overrides?: Partial<Run>): Run => ({
  claimant: 'pierre',
  machine: 'pierre-mbp',
  worktreeId: 'wt-1',
  startedAt: day(20, '08:00:00'),
  status: 'merged',
  attempt: 1,
  attemptLimit: 5,
  steps: [
    { name: 'build', attempt: 1, startedAt: day(20, '08:00:00'), endedAt: day(20, '08:10:00'), timeoutSeconds: 1800 },
    { name: 'review', attempt: 1, startedAt: day(20, '08:10:00'), endedAt: day(20, '08:14:00'), timeoutSeconds: 900 },
  ],
  attempts: [{ number: 1, changed: 'x', decisions: [], outcomes: [] }],
  risk: { predicted: 'low', actual: 'low', level: 'low', score: 0, signals: [] },
  merge: { route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode', at: day(20, '09:14:00'), by: 'sam', asIs: true },
  ...overrides,
});

const getTicket = (runs: readonly Run[], extra?: { readonly key?: string; readonly provider?: string; readonly events?: readonly FactoryEvent[]; readonly repository?: string }): ViewTicket => {
  const record: TicketRecord = { ...createRecord({ repository: extra?.repository ?? 'acme/billing-service' }), runs: [...runs], events: [...(extra?.events ?? [])] };
  return { ...getMockTicket({ key: extra?.key ?? 'PAY-1', status: 'Done' }), provider: extra?.provider ?? 'Jira', factoryComment: renderComment({ record, summary: 'x' }) };
};

const mergedOn = (date: number, merge?: Partial<NonNullable<Run['merge']>>, overrides?: Partial<Run>): Run =>
  getRun({ merge: { route: 'human', wouldAutoMerge: true, reason: 'x', at: day(date), by: 'sam', asIs: true, ...merge }, ...overrides });

const only = (tickets: readonly ViewTicket[], options = getOptions()) => {
  const [first] = buildHealth(tickets, options).providers;
  if (first === undefined) throw new Error('no provider');
  return first;
};

const lowOf = (tickets: readonly ViewTicket[], options = getOptions()) => only(tickets, options).levels[0];

describe('health of the factory', () => {
  it('has nothing to average when nothing was merged in the period', () => {
    const health = buildHealth([getTicket([getRun({ status: 'in_review', merge: { route: 'human', wouldAutoMerge: true, reason: 'x' } })])], getOptions());

    expect(health.periodDays).toBe(7);
    expect(health.providers[0]).toMatchObject({ provider: 'Jira', merged: 0, sendBacks: 0, blocked: 0, failures: [] });
    expect(health.providers[0]).not.toHaveProperty('firstPassRate');
    expect(health.providers[0]).not.toHaveProperty('averageAttempts');
    expect(buildHealth([], getOptions()).providers).toEqual([]);
  });

  it('counts merges of the period only, per provider', () => {
    const edited = getTicket([mergedOn(20)], { key: 'PAY-11' });
    const tickets = [
      getTicket([mergedOn(20)], { key: 'PAY-1' }),
      getTicket([mergedOn(14, {}, { startedAt: day(14) })], { key: 'PAY-2' }),
      getTicket([mergedOn(14, { at: '2026-11-14T12:00:00Z' })], { key: 'PAY-3' }),
      getTicket([mergedOn(14, { at: '2026-11-14T11:59:59Z' })], { key: 'PAY-4' }),
      getTicket([mergedOn(19)], { key: 'LIN-1', provider: 'Linear' }),
      getTicket([mergedOn(19)], { key: 'OTHER-1', repository: 'acme/other' }),
      { ...getMockTicket({ key: 'PAY-9', status: 'Done' }), provider: 'Jira' },
      { ...edited, factoryComment: (edited.factoryComment ?? '').replace('"by":"sam"', '"by":"someone"') },
      { ...getMockTicket({ key: 'PAY-10', status: 'Done' }), provider: 'Jira', factoryComment: 'x\n\n```factory-record sha256=00\n{}\n```\n' },
    ];

    const health = buildHealth(tickets, getOptions());
    const month = buildHealth(tickets, getOptions({ periodDays: 30 }));

    expect(health.providers.map(({ provider, merged }) => [provider, merged])).toEqual([['Jira', 2], ['Linear', 1]]);
    expect(month.providers.map(({ provider, merged }) => [provider, merged])).toEqual([['Jira', 4], ['Linear', 1]]);
    expect(month.periodDays).toBe(30);
  });

  it('counts a ticket as first-pass only when merged on attempt 1 of its first run, and sums the attempts of every run', () => {
    const sentBack = getRun({ status: 'sent_back', attempt: 2, merge: undefined, risk: undefined });
    const { merge: _merge, risk: _risk, ...earlier } = sentBack;
    const tickets = [
      getTicket([mergedOn(20)], { key: 'PAY-1' }),
      getTicket([earlier, mergedOn(20)], { key: 'PAY-2' }),
      getTicket([mergedOn(20, {}, { attempt: 3 })], { key: 'PAY-3' }),
      getTicket([mergedOn(20)], { key: 'PAY-4' }),
    ];

    const health = only(tickets);

    expect(health.firstPassRate).toBe(0.5);
    expect(health.averageAttempts).toBe((1 + 3 + 3 + 1) / 4);
  });

  it('counts send-backs and blocked runs of the period from the events', () => {
    const events: readonly FactoryEvent[] = [
      { at: day(20), by: 'pierre', type: 'sent_back', detail: '1 question' },
      { at: day(19), by: 'pierre', type: 'sent_back', detail: '2 questions' },
      { at: day(10), by: 'pierre', type: 'sent_back', detail: '1 question' },
      { at: day(20), by: 'pierre', type: 'run_ended', detail: 'blocked' },
      { at: day(20), by: 'pierre', type: 'run_ended', detail: 'in_review' },
      { at: day(20), by: 'pierre', type: 'state', detail: 'blocked' },
      { at: day(9), by: 'pierre', type: 'run_ended', detail: 'blocked' },
    ];

    expect(only([getTicket([], { events })])).toMatchObject({ sendBacks: 2, blocked: 1 });
  });

  it('ranks the gates that failed most in runs of the period', () => {
    const failed = (id: string) => ({ id, station: 'quality', status: 'failed' as const, reason: 'exit code 1', durationSeconds: 1 });
    const other = (id: string, status: 'passed' | 'warning' | 'skipped') => ({ id, station: 'quality', status, durationSeconds: 1 });
    const attempt = (number: number, outcomes: Run['attempts'][number]['outcomes']) => ({ number, changed: 'x', decisions: [], outcomes });
    const tickets = [
      getTicket([getRun({ attempts: [attempt(1, [failed('unit-tests'), other('lint', 'warning')]), attempt(2, [failed('unit-tests'), failed('reviewer')]), attempt(3, [other('unit-tests', 'passed'), failed('e2e')])] })]),
      getTicket([getRun({ attempts: [attempt(1, [failed('unit-tests'), other('e2e', 'skipped')])] }), getRun({ startedAt: day(1), attempts: [attempt(1, [failed('old-gate')])] })], { key: 'PAY-2' }),
    ];

    expect(only(tickets).failures).toEqual([{ gate: 'unit-tests', count: 3 }, { gate: 'e2e', count: 1 }, { gate: 'reviewer', count: 1 }]);
  });

  it('gives the median time of each station, and of waiting for merge', () => {
    const steps = (buildMinutes: number): Run['steps'] => [
      { name: 'build', attempt: 1, startedAt: day(20, '08:00:00'), endedAt: day(20, `08:${String(buildMinutes).padStart(2, '0')}:00`), timeoutSeconds: 1800 },
      { name: 'review', attempt: 1, startedAt: day(20, '08:30:00'), endedAt: day(20, '08:34:00'), timeoutSeconds: 900 },
    ];
    const running = getRun({ status: 'running', merge: { route: 'human', wouldAutoMerge: false, reason: 'x' }, steps: [{ name: 'build', attempt: 1, startedAt: day(20, '08:00:00'), timeoutSeconds: 1800 }] });
    const tickets = [
      getTicket([mergedOn(20, { at: day(20, '09:34:00') }, { steps: steps(10) })], { key: 'PAY-1' }),
      getTicket([mergedOn(20, { at: day(20, '10:34:00') }, { steps: steps(20) })], { key: 'PAY-2' }),
      getTicket([mergedOn(20, { at: day(20, '08:44:00') }, { steps: steps(40) })], { key: 'PAY-3' }),
      getTicket([mergedOn(20, { at: day(20, '12:35:01') }, { steps: steps(50) })], { key: 'PAY-4' }),
      getTicket([running], { key: 'PAY-5' }),
      getTicket([mergedOn(20, {}, { steps: [] })], { key: 'PAY-6' }),
    ];

    expect(only(tickets).stations).toEqual([
      { name: 'build', medianSeconds: 30 * 60 },
      { name: 'review', medianSeconds: 240 },
      { name: 'waiting for merge', medianSeconds: 5400 },
    ]);
    expect(only(tickets.slice(0, 3)).stations[0]).toEqual({ name: 'build', medianSeconds: 20 * 60 });
  });

  it('counts, per risk level, changes merged as is, changed by a person, and reverted within two weeks', () => {
    const medium: NonNullable<Run['risk']> = { predicted: 'low', actual: 'medium', level: 'medium', score: 4, signals: [] };
    const tickets = [
      getTicket([mergedOn(20)], { key: 'PAY-1' }),
      getTicket([mergedOn(19, { asIs: false })], { key: 'PAY-2' }),
      getTicket([mergedOn(18, {}, { revert: { at: '2026-12-02T10:00:00Z', by: 'pull request 9', merged: true } })], { key: 'PAY-3' }),
      getTicket([mergedOn(17, {}, { revert: { at: '2026-12-01T10:00:01Z', by: 'pull request 8', merged: true } })], { key: 'PAY-4' }),
      getTicket([mergedOn(16, {}, { risk: medium })], { key: 'PAY-5' }),
      getTicket([mergedOn(16, {}, { risk: undefined })].map(({ risk: _risk, ...run }) => run), { key: 'PAY-6' }),
    ];

    const { levels } = only(tickets);

    expect(levels.map(({ level, merged, mergedAsIs, changed, reverted }) => [level, merged, mergedAsIs, changed, reverted])).toEqual([
      ['low', 4, 3, 1, 1],
      ['medium', 1, 1, 0, 0],
      ['high', 0, 0, 0, 0],
    ]);
  });

  it('suggests turning auto-merge on once the latest changes of a level reach the threshold without disagreement', () => {
    const agreeing = [20, 19, 18].map((date, index) => getTicket([mergedOn(date)], { key: `PAY-${index}` }));
    const withOldDisagreement = [...agreeing, getTicket([mergedOn(16, { asIs: false })], { key: 'PAY-8' })];

    expect(lowOf(agreeing)).toMatchObject({ streak: 3, threshold: 3, suggestion: '/factory-workflow enable auto-merge for low risk' });
    expect(lowOf(withOldDisagreement)).toMatchObject({ merged: 4, streak: 3, suggestion: '/factory-workflow enable auto-merge for low risk' });
    expect(lowOf(agreeing.slice(0, 2))).toMatchObject({ streak: 2 });
    expect(lowOf(agreeing.slice(0, 2))).not.toHaveProperty('suggestion');
  });

  it('starts the count again after a change that a person edited or that was reverted', () => {
    const edited = [getTicket([mergedOn(17)], { key: 'A' }), getTicket([mergedOn(20)], { key: 'B' }), getTicket([mergedOn(19, { asIs: false })], { key: 'C' }), getTicket([mergedOn(18)], { key: 'D' }), getTicket([mergedOn(16)], { key: 'E' })];
    const reverted = [getTicket([mergedOn(20)], { key: 'A' }), getTicket([mergedOn(19, {}, { revert: { at: day(21), by: 'commit r1', merged: true } })], { key: 'B' }), getTicket([mergedOn(18)], { key: 'C' }), getTicket([mergedOn(17)], { key: 'D' }), getTicket([mergedOn(16)], { key: 'E' })];

    expect(lowOf(edited)).toMatchObject({ merged: 5, streak: 1 });
    expect(lowOf(edited)).not.toHaveProperty('suggestion');
    expect(lowOf(reverted)).toMatchObject({ merged: 5, streak: 1, reverted: 1 });
  });

  it('suggests nothing for a level that already merges automatically', () => {
    const agreeing = [20, 19, 18].map((date, index) => getTicket([mergedOn(date)], { key: `PAY-${index}` }));
    const risk = (low: string, rest = '') => `risk: { low: ${low}, medium: { merge: human }, high: { merge: human }, sensitive_paths: [], shadow_threshold: 3${rest} }`;
    const optionsFor = (yaml: string) => getOptions({ config: getConfig(yaml) });

    expect(lowOf(agreeing, optionsFor(risk('{ merge: auto, shadow: false }')))).not.toHaveProperty('suggestion');
    expect(lowOf(agreeing, optionsFor(risk('{ merge: auto }', ', shadow: false')))).not.toHaveProperty('suggestion');
    expect(lowOf(agreeing, optionsFor(risk('{ merge: auto, shadow: true }', ', shadow: false')))).toHaveProperty('suggestion');
    expect(lowOf(agreeing, optionsFor(risk('{ merge: human }', ', shadow: false')))).toHaveProperty('suggestion');
  });
});
