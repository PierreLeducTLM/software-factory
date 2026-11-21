import { describe, expect, it } from 'vitest';
import { parseFactoryConfig, type FactoryConfig } from '../src/config/project-config.js';
import {
  changeLatestRun,
  createRecord,
  endRun,
  endStep,
  recordApproval,
  recordReadyGate,
  recordSendBack,
  renderComment,
  startRun,
  startStep,
  type Attempt,
  type Run,
  type TicketRecord,
} from '../src/record/ticket-record.js';
import { buildBoard, buildNeedsYou, buildRunDetail, type Card, type ViewOptions, type ViewTicket } from '../src/view/model.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const getConfig = (extra = ''): FactoryConfig => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks: []
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
${extra}`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const getOptions = (overrides?: Partial<ViewOptions>): ViewOptions => ({
  config: getConfig(),
  now: '2026-11-21T09:00:00Z',
  machine: 'pierre-mbp',
  repository: 'acme/billing-service',
  ...overrides,
});

const approvedRecord = (risk: 'low' | 'medium' | 'high' = 'low', repository = 'acme/billing-service'): TicketRecord =>
  recordApproval(recordReadyGate(createRecord({ repository }), { passed: true, fingerprint: 'f1', findings: [], at: '2026-11-20T15:00:00Z', by: 'pierre' }), {
    approver: 'pierre',
    at: '2026-11-20T16:00:00Z',
    mainCommit: 'a41c9e2',
    fingerprint: 'f1',
    predictedRisk: risk,
  });

const claimed = (record: TicketRecord = approvedRecord(), machine = 'pierre-mbp', claimant = 'pierre'): TicketRecord =>
  startRun(record, { claimant, machine, worktreeId: 'wt-1', at: '2026-11-21T08:00:00Z', attemptLimit: 5 });

const step = (record: TicketRecord, name: string, startedAt: string, endedAt?: string, timeoutSeconds = 1800): TicketRecord => {
  const started = startStep(record, { name, at: startedAt, timeoutSeconds, by: 'pierre' });
  return endedAt === undefined ? started : endStep(started, { at: endedAt, by: 'pierre' });
};

const withAttempt = (record: TicketRecord, attempt: Attempt): TicketRecord => changeLatestRun(record, (run) => ({ ...run, attempt: attempt.number, attempts: [...run.attempts, attempt] }));

const passed = (id: string, station: string) => ({ id, station, status: 'passed' as const, durationSeconds: 5 });
const failed = (id: string, station: string, detail?: string) => ({ id, station, status: 'failed' as const, reason: 'exit code 1', durationSeconds: 5, ...(detail === undefined ? {} : { detail }) });

const ticketWith = (record: TicketRecord | undefined, overrides?: Partial<ViewTicket>): ViewTicket => ({
  ...getMockTicket({ status: 'In development', ...overrides }),
  provider: 'Jira',
  ...(record === undefined ? {} : { factoryComment: renderComment({ record, summary: 'x' }) }),
  ...overrides,
});

const inReviewWith = (merge: Run['merge'], withPullRequest = true): TicketRecord =>
  endRun(
    changeLatestRun(claimed(), (run) => ({
      ...run,
      ...(withPullRequest ? { pullRequest: { number: 412, url: 'https://github.test/pull/412' } } : {}),
      ...(merge === undefined ? {} : { merge }),
    })),
    { status: 'in_review', at: '2026-11-21T08:40:00Z', by: 'pierre' },
  );

const cardsIn = (tickets: readonly ViewTicket[], column: string, options = getOptions()): readonly Card[] =>
  buildBoard(tickets, options).find((candidate) => candidate.id === column)?.cards ?? [];

const built = (endedAt = '2026-11-21T08:10:00Z'): TicketRecord => endStep(building(), { at: endedAt, by: 'pierre' });

const building = (): TicketRecord => step(step(claimed(), 'revalidate', '2026-11-21T08:00:00Z', '2026-11-21T08:01:00Z'), 'build', '2026-11-21T08:01:00Z');

describe('pipeline board', () => {
  it('has the seven columns in pipeline order, even when empty', () => {
    const board = buildBoard([], getOptions());

    expect(board.map((column) => [column.id, column.name, column.cards.length])).toEqual([
      ['ready', 'Ready', 0],
      ['revalidate', 'Revalidate', 0],
      ['build', 'Build', 0],
      ['review', 'Review', 0],
      ['pr', 'Pull request', 0],
      ['needs_you', 'Needs you', 0],
      ['done', 'Done', 0],
    ]);
  });

  it('shows a ready ticket as eligible for /factory-next or waiting for a developer, never as queued', () => {
    const cards = cardsIn(
      [
        ticketWith(approvedRecord('medium'), { key: 'ENG-90', status: 'Ready for Dev', labels: ['factory-auto'], provider: 'Linear' }),
        ticketWith(approvedRecord(), { key: 'PAY-151', status: 'Ready for Dev' }),
      ],
      'ready',
    );

    expect(cards).toEqual([
      { key: 'ENG-90', title: 'Bulk invoice export', provider: 'Linear', note: 'Eligible for /factory-next', rows: [], earlierAttempts: 0, interrupted: false, recordEdited: false, onThisMachine: false, risk: 'medium', command: '/factory-next' },
      { key: 'PAY-151', title: 'Bulk invoice export', provider: 'Jira', note: 'Waiting for a developer', rows: [], earlierAttempts: 0, interrupted: false, recordEdited: false, onThisMachine: false, risk: 'low', command: '/factory-run PAY-151' },
    ]);
  });

  it('places a claimed ticket by the step its run is on', () => {
    const justClaimed = ticketWith(claimed(), { key: 'A-1' });
    const revalidating = ticketWith(step(claimed(), 'revalidate', '2026-11-21T08:29:00Z', undefined, 120), { key: 'A-2' });
    const gating = ticketWith(step(built(), 'quality', '2026-11-21T08:29:00Z'), { key: 'A-4' });
    const verifying = ticketWith(step(claimed(), 'verify', '2026-11-21T08:29:00Z'), { key: 'A-5' });
    const reviewing = ticketWith(step(claimed(), 'review', '2026-11-21T08:29:00Z'), { key: 'A-6' });
    const diagnosing = ticketWith(step(claimed(), 'diagnose', '2026-11-21T08:29:00Z'), { key: 'A-7' });
    const tickets = [justClaimed, revalidating, ticketWith(building(), { key: 'A-3' }), gating, verifying, reviewing, diagnosing];

    const board = buildBoard(tickets, getOptions({ now: '2026-11-21T08:30:00Z' }));

    expect(board.map((column) => column.cards.map((card) => card.key))).toEqual([[], ['A-1', 'A-2'], ['A-3', 'A-4', 'A-7'], ['A-5', 'A-6'], [], [], []]);
    expect(board.flatMap((column) => column.cards.map((card) => card.note))).toEqual(['Checking drift', 'Checking drift', 'Building', 'Building', 'Building', 'Reviewing', 'Reviewing']);
  });

  it('keeps a run on a step it does not know in the Build column', () => {
    const cards = cardsIn([ticketWith(step(claimed(), 'risk', '2026-11-21T08:59:00Z'))], 'build');

    expect(cards.map((card) => card.note)).toEqual(['Building']);
  });

  it('shows who claimed the run, the run and attempt numbers, the risk and the time spent', () => {
    const [card] = cardsIn([ticketWith(building())], 'build', getOptions({ now: '2026-11-21T08:30:00Z' }));

    expect(card).toMatchObject({
      claimant: 'pierre',
      run: { number: 1, limit: 3 },
      attempt: { number: 1, limit: 5 },
      risk: 'low',
      seconds: 60,
      onThisMachine: true,
      rows: [{ number: 1, build: 'running', gate: 'pending', verify: 'pending', review: 'pending' }],
    });
    expect('command' in (card ?? {})).toBe(false);
  });

  it('marks a run on another machine as not on this one', () => {
    const [card] = cardsIn([ticketWith(step(claimed(approvedRecord(), 'maya-mbp', 'maya'), 'build', '2026-11-21T08:50:00Z'))], 'build');

    expect(card).toMatchObject({ claimant: 'maya', onThisMachine: false });
  });

  it('shows the last two attempts with a chip per gate, and how many came before', () => {
    const firstFailed = withAttempt(step(built(), 'quality', '2026-11-21T08:10:00Z', '2026-11-21T08:12:00Z'), {
      number: 1,
      changed: 'a',
      decisions: [],
      outcomes: [failed('unit-tests', 'quality')],
    });
    const second = changeLatestRun(firstFailed, (run) => ({ ...run, attempt: 2 }));
    const secondFailed = withAttempt(
      step(step(step(step(second, 'build', '2026-11-21T08:12:00Z', '2026-11-21T08:20:00Z'), 'quality', '2026-11-21T08:20:00Z', '2026-11-21T08:22:00Z'), 'verify', '2026-11-21T08:22:00Z', '2026-11-21T08:24:00Z'), 'review', '2026-11-21T08:24:00Z', '2026-11-21T08:30:00Z'),
      { number: 2, changed: 'b', decisions: [], outcomes: [passed('unit-tests', 'quality'), passed('openspec-verify', 'review'), failed('reviewer', 'review')] },
    );
    const third = step(changeLatestRun(secondFailed, (run) => ({ ...run, attempt: 3 })), 'build', '2026-11-21T08:30:00Z');

    const [card] = cardsIn([ticketWith(third)], 'build');

    expect(card?.rows).toEqual([
      { number: 2, build: 'pass', gate: 'pass', verify: 'pass', review: 'fail' },
      { number: 3, build: 'running', gate: 'pending', verify: 'pending', review: 'pending' },
    ]);
    expect(card?.earlierAttempts).toBe(1);
    expect(card?.attempt).toEqual({ number: 3, limit: 5 });
  });

  it('shows a failed verification, and gates in progress, on their own chips', () => {
    const verifyFailed = withAttempt(step(built(), 'verify', '2026-11-21T08:20:00Z', '2026-11-21T08:22:00Z'), { number: 1, changed: 'a', decisions: [], outcomes: [passed('unit-tests', 'quality'), failed('openspec-verify', 'review')] });
    const gateRunning = step(built(), 'quality', '2026-11-21T08:59:00Z');
    const verifyRunning = step(built(), 'verify', '2026-11-21T08:59:00Z');
    const reviewRunning = step(built(), 'review', '2026-11-21T08:59:00Z');

    const rows = [verifyFailed, gateRunning, verifyRunning, reviewRunning].map((record) => buildBoard([ticketWith(record)], getOptions()).flatMap((column) => column.cards)[0]?.rows[0]);

    expect(rows.map((row) => [row?.gate, row?.verify, row?.review])).toEqual([
      ['pending', 'fail', 'pending'],
      ['running', 'pending', 'pending'],
      ['pending', 'running', 'pending'],
      ['pending', 'pending', 'running'],
    ]);
  });

  it('shows a pull request with how it will be merged, as the run recorded it', () => {
    const tickets = [
      ticketWith(inReviewWith({ route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode' }), { key: 'A-1', status: 'In review' }),
      ticketWith(inReviewWith({ route: 'human', wouldAutoMerge: false, reason: 'medium risk is merged by a person' }), { key: 'A-2', status: 'In review' }),
      ticketWith(inReviewWith({ route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically' }), { key: 'A-3', status: 'In review' }),
      ticketWith(inReviewWith({ route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically', refused: 'a build has not passed' }), { key: 'A-4', status: 'In review' }),
      ticketWith(inReviewWith(undefined), { key: 'A-5', status: 'In review' }),
    ];

    expect(cardsIn(tickets, 'pr').map((card) => [card.key, card.note, card.pullRequest])).toEqual([
      ['A-1', 'Would have auto-merged', 'https://github.test/pull/412'],
      ['A-2', 'Merge by a person', 'https://github.test/pull/412'],
      ['A-3', 'Auto-merge is on', 'https://github.test/pull/412'],
      ['A-4', 'Auto-merge refused', 'https://github.test/pull/412'],
      ['A-5', 'Merge by a person', 'https://github.test/pull/412'],
    ]);
  });

  it('shows the final risk of a run once it is known, and the predicted one before', () => {
    const final = changeLatestRun(claimed(approvedRecord('low')), (run) => ({ ...run, risk: { predicted: 'low', actual: 'high', level: 'high', score: 7, signals: [] } }));

    expect(cardsIn([ticketWith(final)], 'revalidate')[0]?.risk).toBe('high');
    expect(cardsIn([ticketWith(claimed(approvedRecord('medium')))], 'revalidate')[0]?.risk).toBe('medium');
  });

  it('says what became of a merged change', () => {
    const done = (change: Partial<Run>) => ticketWith(changeLatestRun(endRun(claimed(), { status: 'merged', at: '2026-11-21T08:40:00Z', by: 'pierre' }), (run) => ({ ...run, ...change })), { status: 'Done' });
    const at = '2026-11-21T08:50:00Z';

    const notes = [
      done({}),
      done({ watch: { at, passed: true } }),
      done({ watch: { at, passed: false, detail: 'x' } }),
      done({ revert: { at, by: 'main failed at m1', pullRequest: 'https://github.test/pull/413' } }),
      done({ revert: { at, by: 'main failed at m1', needed: true } }),
      done({ revert: { at, by: 'pull request 413', merged: true }, watch: { at, passed: true } }),
    ].map((ticket) => cardsIn([ticket], 'done')[0]?.note);

    expect(notes).toEqual(['Merged', 'Delivered', 'Merged', 'Revert opened', 'Revert needed', 'Reverted']);
  });

  it('puts blocked and sent-back tickets in Needs you, and merged ones in Done', () => {
    const blocked = endRun(changeLatestRun(claimed(), (run) => ({ ...run, diagnosis: 'environment' as const })), { status: 'blocked', at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const sentBack = recordSendBack(endRun(claimed(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' }), {
      questions: [{ question: 'Q1?', recommended: 'A1' }, { question: 'Q2?', recommended: 'A2' }],
      at: '2026-11-21T08:40:00Z',
      by: 'pierre',
    });
    const merged = endRun(claimed(), { status: 'merged', at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const tickets = [ticketWith(blocked, { key: 'A-1', status: 'Blocked' }), ticketWith(sentBack, { key: 'A-2', status: 'Spec review' }), ticketWith(merged, { key: 'A-3', status: 'Done' })];

    const board = buildBoard(tickets, getOptions());

    expect(cardsIn(tickets, 'needs_you').map((card) => [card.key, card.note, card.command])).toEqual([
      ['A-1', 'Blocked · environment', '/factory-run A-1'],
      ['A-2', 'Sent back · 2 questions', '/factory-refine A-2'],
    ]);
    expect(board.at(-1)?.cards.map((card) => [card.key, card.note])).toEqual([['A-3', 'Merged']]);
  });

  it('says "1 question" for a single one, and "no diagnosis" on a blocked ticket that has none', () => {
    const one = recordSendBack(endRun(claimed(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' }), { questions: [{ question: 'Q1?', recommended: 'A1' }], at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const blocked = endRun(claimed(), { status: 'blocked', at: '2026-11-21T08:40:00Z', by: 'pierre' });

    const notes = cardsIn([ticketWith(one, { key: 'A-1', status: 'Spec review' }), ticketWith(blocked, { key: 'A-2', status: 'Blocked' })], 'needs_you').map((card) => card.note);

    expect(notes).toEqual(['Sent back · 1 question', 'Blocked · no diagnosis']);
  });

  it('leaves out tickets still being refined, and tickets in a status the factory does not know', () => {
    const tickets = [
      ticketWith(undefined, { key: 'A-1', status: 'To refine' }),
      ticketWith(approvedRecord(), { key: 'A-2', status: 'Spec review' }),
      ticketWith(undefined, { key: 'A-3', status: 'Won\'t do' }),
    ];

    expect(buildBoard(tickets, getOptions()).flatMap((column) => column.cards)).toEqual([]);
  });

  it('shows a ticket with no factory record by its status alone', () => {
    const [card] = cardsIn([ticketWith(undefined, { status: 'Ready for Dev' })], 'ready');

    expect(card).toEqual({ key: 'PAY-142', title: 'Bulk invoice export', provider: 'Jira', note: 'Waiting for a developer', rows: [], earlierAttempts: 0, interrupted: false, recordEdited: false, onThisMachine: false, command: '/factory-run PAY-142' });
  });

  it('shows a re-approved ticket back in Ready with its run count, not with the old run\'s claimant', () => {
    const reapproved = endRun(claimed(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' });

    const [card] = cardsIn([ticketWith(reapproved, { status: 'Ready for Dev' })], 'ready');

    expect(card?.run).toEqual({ number: 1, limit: 3 });
    expect(card?.claimant).toBeUndefined();
    expect(card?.rows).toEqual([]);
  });
});

describe('interrupted runs', () => {
  const stalled = (startedAt: string): ViewTicket => ticketWith(step(claimed(), 'build', startedAt, undefined, 1500));

  it('flags a run whose step started longer ago than its timeout plus the grace period, with the resume command', () => {
    const [card] = cardsIn([stalled('2026-11-21T08:20:00Z')], 'build', getOptions({ now: '2026-11-21T09:00:00Z' }));

    expect(card).toMatchObject({ interrupted: true, note: 'Interrupted', command: '/factory-run PAY-142' });
  });

  it('still shows a run as running exactly at the deadline, and as interrupted one second later', () => {
    const at = (now: string) => cardsIn([stalled('2026-11-21T08:00:00Z')], 'build', getOptions({ now }))[0]?.interrupted;

    expect(at('2026-11-21T08:35:00Z')).toBe(false);
    expect(at('2026-11-21T08:35:01Z')).toBe(true);
  });

  it('uses the grace period the project configured', () => {
    const options = getOptions({ now: '2026-11-21T08:27:01Z', config: getConfig('view: { interrupted_grace_minutes: 2 }') });

    expect(cardsIn([stalled('2026-11-21T08:00:00Z')], 'build', options)[0]?.interrupted).toBe(true);
    expect(cardsIn([stalled('2026-11-21T08:00:00Z')], 'build', getOptions({ now: '2026-11-21T08:27:01Z' }))[0]?.interrupted).toBe(false);
  });

  it('never flags a run with no step in progress, or a ticket that is no longer in development', () => {
    const allEnded = ticketWith(step(claimed(), 'revalidate', '2026-11-20T08:00:00Z', '2026-11-20T08:01:00Z'));
    const moved = { ...stalled('2026-11-20T08:00:00Z'), status: 'Blocked' };

    expect(buildBoard([allEnded, moved], getOptions()).flatMap((column) => column.cards).map((card) => card.interrupted)).toEqual([false, false]);
  });
});

describe('scope and integrity', () => {
  it('shows only tickets whose record names this repository, plus tickets with no record yet', () => {
    const tickets = [
      ticketWith(approvedRecord('low', 'acme/web-app'), { key: 'WEB-1', status: 'Ready for Dev' }),
      ticketWith(approvedRecord(), { key: 'PAY-1', status: 'Ready for Dev' }),
      ticketWith(undefined, { key: 'PAY-2', status: 'Ready for Dev' }),
    ];

    expect(cardsIn(tickets, 'ready').map((card) => card.key)).toEqual(['PAY-1', 'PAY-2']);
    expect(buildNeedsYou(tickets, getOptions({ now: '2026-11-25T09:00:00Z' })).map((item) => item.key)).toEqual(['PAY-1', 'PAY-2']);
  });

  it('flags a ticket whose record was edited by hand, or is not a factory record', () => {
    const edited = ticketWith(approvedRecord(), { key: 'A-1', status: 'Ready for Dev' });
    const tampered = { ...edited, factoryComment: (edited.factoryComment ?? '').replace('"fingerprint":"f1"', '"fingerprint":"f9"') };
    const invalid = { ...ticketWith(undefined, { key: 'A-2', status: 'Ready for Dev' }), factoryComment: renderComment({ record: { ...approvedRecord(), schema: 2 } as unknown as TicketRecord, summary: 'x' }) };
    const plain = { ...ticketWith(undefined, { key: 'A-3', status: 'Ready for Dev' }), factoryComment: 'just a note' };

    const cards = cardsIn([tampered, invalid, plain], 'ready');

    expect(cards.map((card) => [card.key, card.recordEdited])).toEqual([['A-1', true], ['A-2', true], ['A-3', false]]);
    expect(buildNeedsYou([tampered], getOptions())[0]?.why).toBe('The factory comment was edited outside the factory.');
    expect(buildNeedsYou([tampered, invalid, plain], getOptions()).map((item) => [item.key, item.category, item.command])).toEqual([
      ['A-1', 'record_edited', '/factory-run A-1'],
      ['A-2', 'record_edited', '/factory-run A-2'],
    ]);
  });
});

describe('needs you', () => {
  const blockedRecord = (runs = 1): TicketRecord =>
    Array.from({ length: runs }, (_, index) => index).reduce(
      (record) =>
        endRun(changeLatestRun(claimed(record), (run) => ({ ...run, attempt: 5, diagnosis: 'environment' as const, report: 'memory://report' })), { status: 'blocked', at: '2026-11-21T08:40:00Z', by: 'pierre' }),
      approvedRecord(),
    );

  it('lists every human decision, most urgent category first and the oldest first within one', () => {
    const sentBack = recordSendBack(endRun(claimed(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' }), { questions: [{ question: 'Q1?', recommended: 'A1' }], at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const inReview = endRun(changeLatestRun(claimed(approvedRecord('medium')), (run) => ({ ...run, pullRequest: { number: 412, url: 'https://github.test/pull/412' } })), { status: 'in_review', at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const gated = recordReadyGate(createRecord({ repository: 'acme/billing-service' }), { passed: true, fingerprint: 'f1', findings: [], at: '2026-11-20T15:00:00Z', by: 'pierre' });
    const tickets = [
      ticketWith(approvedRecord(), { key: 'NOT-STARTED', status: 'Ready for Dev', statusSince: '2026-11-19T09:00:00Z' }),
      ticketWith(gated, { key: 'APPROVE', status: 'Spec review' }),
      ticketWith(inReview, { key: 'MERGE', status: 'In review' }),
      ticketWith(sentBack, { key: 'SENT-BACK', status: 'Spec review' }),
      ticketWith(step(claimed(approvedRecord(), 'sam-mbp', 'sam'), 'build', '2026-11-21T08:00:00Z', undefined, 1500), { key: 'INTERRUPTED' }),
      ticketWith(blockedRecord(3), { key: 'LIMIT', status: 'Blocked' }),
      ticketWith(blockedRecord(), { key: 'BLOCKED-NEW', status: 'Blocked', statusSince: '2026-11-21T08:40:00Z' }),
      ticketWith(blockedRecord(), { key: 'BLOCKED-OLD', status: 'Blocked', statusSince: '2026-11-20T08:40:00Z' }),
    ];

    const items = buildNeedsYou(tickets, getOptions());

    expect(items.map((item) => [item.category, item.key])).toEqual([
      ['blocked', 'BLOCKED-OLD'],
      ['blocked', 'BLOCKED-NEW'],
      ['run_limit', 'LIMIT'],
      ['interrupted', 'INTERRUPTED'],
      ['sent_back', 'SENT-BACK'],
      ['merge', 'MERGE'],
      ['approve', 'APPROVE'],
      ['not_started', 'NOT-STARTED'],
    ]);
    expect(items.map((item) => item.why)).toEqual([
      'Failed 5 of 5 attempts. Diagnosis: environment.',
      'Failed 5 of 5 attempts. Diagnosis: environment.',
      'Used 3 of 3 runs.',
      'The build step never ended. Claimed by sam.',
      'Sent back with 1 question.',
      'Merge by a person.',
      'The ready gate passed. Waiting for approval.',
      'Ready for 48 hours with no factory-auto label.',
    ]);
    expect(items.map((item) => item.command ?? item.link)).toEqual([
      '/factory-run BLOCKED-OLD',
      '/factory-run BLOCKED-NEW',
      '/factory-run LIMIT --over-limit',
      '/factory-run INTERRUPTED',
      '/factory-refine SENT-BACK',
      'https://github.test/pull/412',
      '/factory-refine APPROVE',
      '/factory-run NOT-STARTED',
    ]);
    expect(items.find((item) => item.key === 'SENT-BACK')?.questions).toEqual([{ question: 'Q1?', recommended: 'A1' }]);
    expect(items.find((item) => item.key === 'BLOCKED-OLD')?.link).toBe('memory://report');
    expect(items.find((item) => item.key === 'INTERRUPTED')?.since).toBe('2026-11-21T08:00:00Z');
  });

  it('lists a ready ticket that reached its run limit, with the override command', () => {
    const [item] = buildNeedsYou([ticketWith(blockedRecord(3), { status: 'Ready for Dev', labels: ['factory-auto'] })], getOptions());

    expect(item).toMatchObject({ category: 'run_limit', why: 'Used 3 of 3 runs.', command: '/factory-run PAY-142 --over-limit' });
  });

  it('does not list a ticket one run short of the limit as at the limit', () => {
    expect(buildNeedsYou([ticketWith(blockedRecord(2), { status: 'Blocked' })], getOptions()).map((item) => item.category)).toEqual(['blocked']);
  });

  it('lists a pull request a person must merge, and not one that merges by itself', () => {
    const shadow = ticketWith(inReviewWith({ route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode' }, false), { status: 'In review' });
    const automatic = ticketWith(inReviewWith({ route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically' }), { status: 'In review' });
    const refused = ticketWith(inReviewWith({ route: 'auto', wouldAutoMerge: true, reason: 'x', refused: 'a build has not passed' }), { status: 'In review' });

    expect(buildNeedsYou([shadow], getOptions())).toMatchObject([{ category: 'merge', why: 'Would have auto-merged.' }]);
    expect('link' in (buildNeedsYou([shadow], getOptions())[0] ?? {})).toBe(false);
    expect(buildNeedsYou([automatic], getOptions())).toEqual([]);
    expect(buildNeedsYou([refused], getOptions())).toMatchObject([{ category: 'merge', why: 'Auto-merge refused: a build has not passed.', link: 'https://github.test/pull/412' }]);
  });

  it('lists a merged change whose revert still waits for a person, first of all', () => {
    const at = '2026-11-21T08:50:00Z';
    const done = (key: string, revert: NonNullable<Run['revert']>, pullRequest = true) =>
      ticketWith(
        changeLatestRun(endRun(claimed(), { status: 'merged', at: '2026-11-21T08:40:00Z', by: 'pierre' }), (run) => ({ ...run, revert, ...(pullRequest ? { pullRequest: { number: 412, url: 'https://github.test/pull/412' } } : {}) })),
        { key, status: 'Done', statusSince: '2026-11-21T08:45:00Z' },
      );
    const blocked = ticketWith(blockedRecord(1), { key: 'BLOCKED', status: 'Blocked' });
    const tickets = [
      blocked,
      done('OPENED', { at, by: 'main failed at m1', pullRequest: 'https://github.test/pull/413' }),
      done('NEEDED', { at: '2026-11-21T08:55:00Z', by: 'the staging watch failed on ./smoke.sh', needed: true }),
      done('NO-LINK', { at: '2026-11-21T08:56:00Z', by: 'main failed at m2', needed: true }, false),
      done('REVERTED', { at, by: 'pull request 413', merged: true }),
      { ...done('REOPENED', { at, by: 'main failed at m1', needed: true }), status: 'Ready for Dev' },
    ];

    const items = buildNeedsYou(tickets, getOptions());

    expect(items.map((item) => [item.category, item.key])).toEqual([['revert', 'OPENED'], ['revert', 'NEEDED'], ['revert', 'NO-LINK'], ['blocked', 'BLOCKED']]);
    expect(items[0]).toMatchObject({ since: at, why: 'Merge the revert pull request: main failed at m1.', link: 'https://github.test/pull/413' });
    expect(items[1]).toMatchObject({ why: 'Revert this change by hand: the staging watch failed on ./smoke.sh.', link: 'https://github.test/pull/412' });
    expect(items[0]).not.toHaveProperty('command');
    expect(items[2]).not.toHaveProperty('link');
  });

  it('lists an unlabelled ready ticket only once it has waited longer than the configured time', () => {
    const ticket = ticketWith(approvedRecord(), { status: 'Ready for Dev', statusSince: '2026-11-20T09:00:00Z' });
    const labelled = { ...ticket, labels: ['factory-auto'] };

    expect(buildNeedsYou([ticket], getOptions({ now: '2026-11-21T09:00:00Z' }))).toEqual([]);
    expect(buildNeedsYou([ticket], getOptions({ now: '2026-11-21T09:00:01Z' }))).toMatchObject([{ category: 'not_started', why: 'Ready for 24 hours with no factory-auto label.' }]);
    expect(buildNeedsYou([labelled], getOptions({ now: '2026-11-25T09:00:00Z' }))).toEqual([]);
    expect(buildNeedsYou([ticket], getOptions({ now: '2026-11-20T10:00:01Z', config: getConfig('view: { not_started_after_hours: 1 }') }))).toMatchObject([{ why: 'Ready for 1 hour with no factory-auto label.' }]);
  });

  it('does not ask for approval when the ready gate failed, was never run, or the ticket is not in Spec review', () => {
    const failedGate = recordReadyGate(createRecord({ repository: 'acme/billing-service' }), { passed: false, fingerprint: 'f1', findings: ['x'], at: '2026-11-20T15:00:00Z', by: 'pierre' });
    const tickets = [
      ticketWith(failedGate, { key: 'A-1', status: 'Spec review' }),
      ticketWith(createRecord({ repository: 'acme/billing-service' }), { key: 'A-2', status: 'Spec review' }),
      ticketWith(undefined, { key: 'A-3', status: 'To refine' }),
    ];

    expect(buildNeedsYou(tickets, getOptions())).toEqual([]);
  });

  it('lists a ticket blocked by hand, with no factory record, as blocked', () => {
    const [item] = buildNeedsYou([ticketWith(undefined, { status: 'Blocked' })], getOptions());

    expect(item).toEqual({ category: 'blocked', key: 'PAY-142', title: 'Bulk invoice export', provider: 'Jira', since: '2026-11-20T10:00:00Z', why: 'Blocked, with no factory record.', command: '/factory-run PAY-142', questions: [] });
  });

  it('says "no diagnosis" as "none" for a blocked run that has none', () => {
    const undiagnosed = endRun(claimed(), { status: 'blocked', at: '2026-11-21T08:40:00Z', by: 'pierre' });

    expect(buildNeedsYou([ticketWith(undiagnosed, { status: 'Blocked' })], getOptions())[0]?.why).toBe('Failed 1 of 5 attempts. Diagnosis: none.');
  });

  it('only counts the run limit against tickets that are ready or blocked', () => {
    const sentBackAtLimit = recordSendBack(blockedRecord(3), { questions: [{ question: 'Q?', recommended: 'A' }], at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const runningAtLimit = step(claimed(blockedRecord(2)), 'build', '2026-11-21T08:50:00Z');

    const items = buildNeedsYou([ticketWith(sentBackAtLimit, { key: 'A-1', status: 'Spec review' }), ticketWith(runningAtLimit, { key: 'A-2' })], getOptions());

    expect(items.map((item) => [item.key, item.category])).toEqual([['A-1', 'sent_back']]);
  });

  it('ignores leftover send-back questions and long waits on a ticket whose status the factory does not track', () => {
    const leftover = recordSendBack(approvedRecord(), { questions: [{ question: 'Q?', recommended: 'A' }], at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const tickets = [ticketWith(leftover, { key: 'A-1', status: 'To refine', statusSince: '2026-11-01T09:00:00Z' }), ticketWith(leftover, { key: 'A-2', status: 'Archived', statusSince: '2026-11-01T09:00:00Z' })];

    expect(buildNeedsYou(tickets, getOptions())).toEqual([]);
    expect(buildBoard(tickets, getOptions()).flatMap((column) => column.cards)).toEqual([]);
  });

  it('lists nothing for tickets that are running normally or done', () => {
    const tickets = [ticketWith(step(claimed(), 'build', '2026-11-21T08:50:00Z')), ticketWith(endRun(claimed(), { status: 'merged', at: '2026-11-21T08:40:00Z', by: 'pierre' }), { key: 'A-2', status: 'Done' })];

    expect(buildNeedsYou(tickets, getOptions())).toEqual([]);
  });
});

describe('run detail', () => {
  it('shows the refinement, the run, each attempt\'s steps with their output, and the outcome', () => {
    const attempt1 = withAttempt(step(built(), 'quality', '2026-11-21T08:10:00Z', '2026-11-21T08:12:00Z'), {
      number: 1,
      changed: 'Added the exporter',
      decisions: ['D-001', 'D-004'],
      outcomes: [failed('unit-tests', 'quality', 'export.test.ts › splits files: expected 2, got 1')],
    });
    const attempt2 = withAttempt(
      step(step(step(step(changeLatestRun(attempt1, (run) => ({ ...run, attempt: 2 })), 'build', '2026-11-21T08:12:00Z', '2026-11-21T08:20:00Z'), 'quality', '2026-11-21T08:20:00Z', '2026-11-21T08:22:00Z'), 'verify', '2026-11-21T08:22:00Z', '2026-11-21T08:24:00Z'), 'review', '2026-11-21T08:24:00Z', '2026-11-21T08:30:00Z'),
      { number: 2, changed: 'Export in chunks', decisions: [], outcomes: [passed('unit-tests', 'quality'), passed('openspec-verify', 'review'), passed('reviewer', 'review'), { ...passed('ui-design', 'review'), evidence: ['shots/settings.png'] }] },
    );
    const delivered = endRun(changeLatestRun(attempt2, (run) => ({ ...run, pullRequest: { number: 412, url: 'https://github.test/pull/412' } })), { status: 'in_review', at: '2026-11-21T08:31:00Z', by: 'pierre' });

    const detail = buildRunDetail(ticketWith(delivered, { status: 'In review' }), getOptions());

    expect(detail).toEqual({
      key: 'PAY-142',
      title: 'Bulk invoice export',
      sections: [
        {
          title: 'Refinement',
          steps: [
            { label: 'Ready gate', status: 'pass', lines: [], links: [] },
            { label: 'Approval', status: 'pass', lines: ['Approved by pierre at 2026-11-20T16:00:00Z', 'Predicted risk: low', 'Main at a41c9e2'], links: [] },
          ],
        },
        { title: 'Run 1 of 3', steps: [{ label: 'Revalidate', status: 'pass', lines: [], links: [] }] },
        {
          title: 'Attempt 1 of 5',
          steps: [
            { label: 'Build', status: 'pass', lines: ['Added the exporter', 'Decisions applied: D-001, D-004'], links: [] },
            { label: 'Quality gate', status: 'fail', lines: ['unit-tests: failed (exit code 1)', 'export.test.ts › splits files: expected 2, got 1'], links: [] },
            { label: 'Verify', status: 'pending', lines: [], links: [] },
            { label: 'Review', status: 'pending', lines: [], links: [] },
          ],
        },
        {
          title: 'Attempt 2 of 5',
          steps: [
            { label: 'Build', status: 'pass', lines: ['Export in chunks'], links: [] },
            { label: 'Quality gate', status: 'pass', lines: ['unit-tests: passed'], links: [] },
            { label: 'Verify', status: 'pass', lines: ['openspec-verify: passed'], links: [] },
            { label: 'Review', status: 'pass', lines: ['reviewer: passed', 'ui-design: passed'], links: ['shots/settings.png'] },
          ],
        },
        { title: 'Outcome', steps: [{ label: 'Pull request', status: 'running', lines: [], links: ['https://github.test/pull/412'] }] },
      ],
    });
  });

  it('shows a merged pull request as passed', () => {
    const merged = endRun(changeLatestRun(claimed(), (run) => ({ ...run, pullRequest: { number: 412, url: 'u' } })), { status: 'merged', at: '2026-11-21T08:31:00Z', by: 'pierre' });

    expect(buildRunDetail(ticketWith(merged, { status: 'Done' }), getOptions())?.sections.at(-1)).toEqual({ title: 'Outcome', steps: [{ label: 'Pull request', status: 'pass', lines: [], links: ['u'] }] });
  });

  it('shows the risk report, the merge and what followed on the pull request', () => {
    const outcome = (change: Partial<Run>) => {
      const merged = endRun(changeLatestRun(claimed(), (run) => ({ ...run, pullRequest: { number: 412, url: 'u' }, ...change })), { status: 'merged', at: '2026-11-21T08:31:00Z', by: 'pierre' });
      return buildRunDetail(ticketWith(merged, { status: 'Done' }), getOptions())?.sections.at(-1)?.steps[0];
    };
    const risk: NonNullable<Run['risk']> = { predicted: 'low', actual: 'medium', level: 'high', score: 4, signals: [{ name: 'sensitive paths', points: 4, reason: 'touches src/auth/session.ts' }], raised: 'Changes rounding' };
    const at = '2026-11-21T09:00:00Z';

    expect(outcome({ risk, merge: { route: 'human', wouldAutoMerge: false, reason: 'high risk is merged by a person', at, by: 'sam', asIs: true }, watch: { at, passed: true } })).toEqual({
      label: 'Pull request',
      status: 'pass',
      lines: [
        'Risk: high (predicted low, actual medium, score 4)',
        'sensitive paths: touches src/auth/session.ts',
        'Raised by the reviewer: Changes rounding',
        'Merge: high risk is merged by a person',
        'Merged by sam at 2026-11-21T09:00:00Z, merged as is',
        'Delivered at 2026-11-21T09:00:00Z: the staging watch passed',
      ],
      links: ['u'],
    });
    expect(outcome({ merge: { route: 'auto', wouldAutoMerge: true, reason: 'low risk merges automatically', refused: 'a build has not passed', at, asIs: false } })?.lines).toEqual([
      'Merge: low risk merges automatically',
      'Auto-merge refused: a build has not passed',
      'Merged by unknown at 2026-11-21T09:00:00Z, changed by a human',
    ]);
    expect(outcome({ watch: { at, passed: false, detail: './smoke.sh: 500' }, revert: { at, by: 'the staging watch failed on ./smoke.sh', pullRequest: 'r' } })).toEqual({
      label: 'Pull request',
      status: 'fail',
      lines: ['The staging watch failed at 2026-11-21T09:00:00Z: ./smoke.sh: 500', 'Revert opened at 2026-11-21T09:00:00Z: the staging watch failed on ./smoke.sh'],
      links: ['u', 'r'],
    });
    expect(outcome({ watch: { at, passed: false }, revert: { at, by: 'commit r1', merged: true } })?.lines).toEqual(['The staging watch failed at 2026-11-21T09:00:00Z: no detail', 'Reverted at 2026-11-21T09:00:00Z: commit r1']);
  });

  it('shows the failure report of a blocked run, and the questions of a sent-back one', () => {
    const blocked = endRun(changeLatestRun(claimed(), (run) => ({ ...run, diagnosis: 'code' as const, report: 'memory://report' })), { status: 'blocked', at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const undiagnosed = endRun(claimed(), { status: 'blocked', at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const sentBack = recordSendBack(endRun(claimed(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' }), { questions: [{ question: 'Q1?', recommended: 'A1' }], at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const answered = endRun(claimed(), { status: 'sent_back', at: '2026-11-21T08:40:00Z', by: 'pierre' });
    const outcome = (record: TicketRecord, status: string) => buildRunDetail(ticketWith(record, { status }), getOptions())?.sections.at(-1);

    expect(outcome(blocked, 'Blocked')).toEqual({ title: 'Outcome', steps: [{ label: 'Failure report', status: 'fail', lines: ['Diagnosis: code'], links: ['memory://report'] }] });
    expect(outcome(undiagnosed, 'Blocked')).toEqual({ title: 'Outcome', steps: [{ label: 'Failure report', status: 'fail', lines: ['Diagnosis: none'], links: [] }] });
    expect(outcome(sentBack, 'Spec review')).toEqual({ title: 'Outcome', steps: [{ label: 'Sent back', status: 'fail', lines: ['Q1?', 'Recommended: A1'], links: [] }] });
    expect(outcome(answered, 'Ready for Dev')).toEqual({ title: 'Outcome', steps: [{ label: 'Sent back', status: 'fail', lines: [], links: [] }] });
  });

  it('shows only the refinement for a ticket that was never claimed, with the findings of a failed gate', () => {
    const failedGate = recordReadyGate(createRecord({ repository: 'acme/billing-service' }), { passed: false, fingerprint: 'f1', findings: ['design.md:4 contains a TBD marker'], at: '2026-11-20T15:00:00Z', by: 'pierre' });

    const detail = buildRunDetail(ticketWith(failedGate, { status: 'Spec review' }), getOptions());

    expect(detail?.sections).toEqual([{ title: 'Refinement', steps: [{ label: 'Ready gate', status: 'fail', lines: ['design.md:4 contains a TBD marker'], links: [] }] }]);
  });

  it('shows a run that has not built yet with no attempt and no outcome', () => {
    const detail = buildRunDetail(ticketWith(step(claimed(), 'revalidate', '2026-11-21T08:59:00Z', undefined, 120)), getOptions());

    expect(detail?.sections.map((section) => section.title)).toEqual(['Refinement', 'Run 1 of 3']);
    expect(detail?.sections[1]?.steps).toEqual([{ label: 'Revalidate', status: 'running', lines: [], links: [] }]);
  });

  it('shows the attempt being built with nothing recorded for it yet', () => {
    const detail = buildRunDetail(ticketWith(building()), getOptions());

    expect(detail?.sections.at(-1)).toEqual({
      title: 'Attempt 1 of 5',
      steps: [
        { label: 'Build', status: 'running', lines: [], links: [] },
        { label: 'Quality gate', status: 'pending', lines: [], links: [] },
        { label: 'Verify', status: 'pending', lines: [], links: [] },
        { label: 'Review', status: 'pending', lines: [], links: [] },
      ],
    });
  });

  it('shows an empty refinement for a record with no gate result and no approval', () => {
    const detail = buildRunDetail(ticketWith(createRecord({ repository: 'acme/billing-service' }), { status: 'Spec review' }), getOptions());

    expect(detail?.sections).toEqual([{ title: 'Refinement', steps: [] }]);
  });

  it('has no detail for a ticket with no factory record', () => {
    expect(buildRunDetail(ticketWith(undefined, { status: 'Ready for Dev' }), getOptions())).toBeUndefined();
  });
});
