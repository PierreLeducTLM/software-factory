import { createInMemoryTicketProvider } from '../adapters/in-memory-ticket-provider.js';
import type { Ticket } from '../adapters/ticket-provider.js';
import type { FactoryConfig } from '../config/project-config.js';
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
} from '../record/ticket-record.js';
import { createViewSource, type ViewSource } from './source.js';

type Options = { readonly config: FactoryConfig; readonly now: () => string };

const REPOSITORY = 'acme/billing-service';
const MACHINE = 'this-machine';
const MINUTE = 60_000;
const NO_ORCA = 'This is sample data, with no Orca session behind it.';

type Risk = 'low' | 'medium' | 'high';

export const createDemoViewSource = ({ config, now }: Options): ViewSource => {
  const start = Date.parse(now());
  const ago = (minutes: number): string => new Date(start - minutes * MINUTE).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const approved = (risk: 'low' | 'medium' | 'high'): TicketRecord =>
    recordApproval(recordReadyGate(createRecord({ repository: REPOSITORY }), { passed: true, fingerprint: 'demo', findings: [], at: ago(600), by: 'pierre' }), {
      approver: 'pierre',
      at: ago(590),
      mainCommit: 'a41c9e2',
      fingerprint: 'demo',
      predictedRisk: risk,
    });

  const claimed = (record: TicketRecord, claimant: string, machine: string, minutesAgo: number): TicketRecord =>
    startRun(record, { claimant, machine, worktreeId: `wt-${claimant}`, at: ago(minutesAgo), attemptLimit: config.limits.attempts });

  const step = (record: TicketRecord, name: string, startedAgo: number, endedAgo?: number): TicketRecord => {
    const started = startStep(record, { name, at: ago(startedAgo), timeoutSeconds: 1800, by: 'factory' });
    return endedAgo === undefined ? started : endStep(started, { at: ago(endedAgo), by: 'factory' });
  };

  const attempt = (record: TicketRecord, entry: Attempt): TicketRecord => changeLatestRun(record, (run) => ({ ...run, attempt: entry.number, attempts: [...run.attempts, entry] }));

  const passed = (id: string, station: string) => ({ id, station, status: 'passed' as const, durationSeconds: 30 });
  const failed = (id: string, station: string, detail: string) => ({ id, station, status: 'failed' as const, reason: 'exit code 1', detail, durationSeconds: 30 });

  const firstAttemptFailed = (record: TicketRecord): TicketRecord =>
    changeLatestRun(
      attempt(step(step(step(record, 'revalidate', 40, 39), 'build', 39, 25), 'quality', 25, 22), {
        number: 1,
        changed: 'Added the exporter',
        decisions: ['D-001'],
        outcomes: [failed('unit-tests', 'quality', 'export.test.ts › splits files over 10,000 rows: expected 2 files, got 1')],
      }),
      (run) => ({ ...run, attempt: 2 }),
    );

  const reviewed = (record: TicketRecord, earlier: number): TicketRecord =>
    attempt(step(step(step(step(step(record, 'revalidate', earlier + 60, earlier + 59), 'build', earlier + 59, earlier + 45), 'quality', earlier + 45, earlier + 40), 'verify', earlier + 40, earlier + 36), 'review', earlier + 36, earlier + 30), {
      number: 1,
      changed: 'Required an amount for partial refunds',
      decisions: ['D-002'],
      outcomes: [passed('unit-tests', 'quality'), passed('openspec-verify', 'review'), passed('reviewer', 'review')],
    });

  const decision = (risk: Risk): NonNullable<Run['merge']> =>
    risk === 'low' ? { route: 'human', wouldAutoMerge: true, reason: 'low risk is in shadow mode' } : { route: 'human', wouldAutoMerge: false, reason: `${risk} risk is merged by a person` };

  const delivered = (risk: Risk, number: number, claimant: string, startedAgo: number): TicketRecord =>
    changeLatestRun(reviewed(claimed(approved(risk), claimant, MACHINE, startedAgo + 61), startedAgo), (run) => ({
      ...run,
      pullRequest: { number, url: `https://example.test/pull/${number}`, headCommit: 'c0ffee1' },
      risk: {
        predicted: risk,
        actual: risk,
        level: risk,
        score: risk === 'low' ? 0 : 4,
        signals: risk === 'low' ? [] : [{ name: 'sensitive paths', points: 4, reason: 'touches src/billing/rounding.ts' }],
      },
      merge: decision(risk),
    }));

  const inReview = (risk: Risk, number: number): TicketRecord => endRun(delivered(risk, number, 'pierre', 0), { status: 'in_review', at: ago(30), by: 'pierre' });

  const merged = (risk: Risk, number: number, mergedAgo: number, outcome: { readonly asIs: boolean; readonly revert?: NonNullable<Run['revert']> }): TicketRecord =>
    changeLatestRun(endRun(delivered(risk, number, 'maya', mergedAgo + 120), { status: 'merged', at: ago(mergedAgo), by: 'factory-ci' }), (run) => ({
      ...run,
      merge: { ...decision(risk), at: ago(mergedAgo), by: 'maya', asIs: outcome.asIs },
      ...(outcome.revert === undefined ? {} : { revert: outcome.revert }),
    }));

  const blocked = endRun(
    changeLatestRun(firstAttemptFailed(claimed(approved('medium'), 'pierre', MACHINE, 41)), (run) => ({ ...run, attempt: run.attemptLimit, diagnosis: 'environment' as const, report: 'https://example.test/report/PAY-133' })),
    { status: 'blocked', at: ago(25), by: 'pierre' },
  );

  const sentBack = recordSendBack(endRun(claimed(approved('medium'), 'pierre', MACHINE, 70), { status: 'sent_back', at: ago(60), by: 'pierre' }), {
    questions: [{ question: 'Since PAY-130, billing rounds each line item. Should tax rounding follow per-line rounding too?', recommended: 'Yes, to stay consistent with Billing rules v2.' }],
    at: ago(60),
    by: 'pierre',
  });

  const ticket = (key: string, title: string, status: string, statusAgo: number, record: TicketRecord | undefined, labels: readonly string[] = []): Ticket => ({
    key,
    title,
    status,
    labels,
    repository: REPOSITORY,
    updatedAt: ago(statusAgo),
    statusSince: ago(statusAgo),
    ...(record === undefined ? {} : { factoryComment: renderComment({ record, summary: 'Sample data' }) }),
  });

  const { states, labels } = config;
  const tickets: readonly Ticket[] = [
    ticket('PAY-160', 'Late payment reminders', states.to_refine, 1440, undefined, [labels.available]),
    ticket('PAY-161', 'Customer portal redesign', states.to_refine, 4300, undefined),
    ticket('PAY-151', 'Export invoices to CSV', states.ready_for_dev, 2880, approved('low')),
    ticket('ENG-90', 'Rate-limit the public API', states.ready_for_dev, 180, approved('medium'), [labels.auto]),
    ticket('PAY-149', 'Validate customer addresses', states.in_development, 1, step(claimed(approved('low'), 'pierre', MACHINE, 1), 'revalidate', 1)),
    ticket('PAY-142', 'Bulk invoice export', states.in_development, 41, step(firstAttemptFailed(claimed(approved('low'), 'pierre', MACHINE, 41)), 'build', 6)),
    ticket('ENG-87', 'Webhook retry policy', states.in_development, 5, step(step(claimed(approved('medium'), 'maya', 'maya-mbp', 5), 'revalidate', 5, 4), 'build', 4)),
    ticket('ENG-95', 'Audit log export', states.in_development, 95, step(step(claimed(approved('low'), 'sam', 'sam-mbp', 95), 'revalidate', 95, 94), 'build', 94)),
    ticket('GH-231', 'Dark mode for settings', states.in_development, 20, step(step(step(step(step(claimed(approved('low'), 'pierre', MACHINE, 20), 'revalidate', 20, 19), 'build', 19, 8), 'quality', 8, 6), 'verify', 6, 3), 'review', 3)),
    ticket('PAY-138', 'Partial refunds', states.in_review, 30, inReview('medium', 412)),
    ticket('ENG-88', 'Retry back-off for exports', states.in_review, 30, inReview('low', 415)),
    ticket('PAY-133', 'Multi-currency totals', states.blocked, 25, blocked),
    ticket('PAY-147', 'Tax rounding rules', states.spec_review, 60, sentBack),
    ticket('PAY-155', 'Credit notes', states.spec_review, 180, recordReadyGate(createRecord({ repository: REPOSITORY }), { passed: true, fingerprint: 'demo', findings: [], at: ago(180), by: 'pierre' })),
    ticket('PAY-158', 'Discount codes', states.spec_review, 45, recordReadyGate(createRecord({ repository: REPOSITORY }), { passed: false, fingerprint: 'demo', findings: ['The spec has 1 open question.'], at: ago(45), by: 'pierre' }), [labels.available]),
    ticket('PAY-130', 'Billing rules v2', states.done, 300, merged('high', 398, 300, { asIs: true })),
    ticket('PAY-128', 'Invoice footer text', states.done, 1500, merged('low', 396, 1500, { asIs: true })),
    ticket('PAY-127', 'Currency symbol placement', states.done, 2900, merged('low', 395, 2900, { asIs: true })),
    ticket('ENG-84', 'Pagination for audit log', states.done, 4300, merged('low', 392, 4300, { asIs: false })),
    ticket('ENG-82', 'Export file naming', states.done, 5700, merged('low', 390, 5700, { asIs: true, revert: { at: ago(5000), by: 'pull request 391', merged: true } })),
    ticket('ENG-85', 'Cache invoice totals', states.done, 200, merged('medium', 397, 200, { asIs: true, revert: { at: ago(90), by: 'the staging watch failed on ./smoke.sh', needed: true } })),
  ];

  const source = createViewSource({
    providers: [{ name: 'Sample data', provider: createInMemoryTicketProvider({ tickets, now }) }],
    config,
    repository: REPOSITORY,
    machine: MACHINE,
    now,
    openWorktree: () => Promise.reject(new Error(NO_ORCA)),
    startWorktree: () => Promise.reject(new Error(NO_ORCA)),
  });
  return { ...source, startInOrca: async ({ key }) => ({ ok: false, message: `Orca could not start ${key}: ${NO_ORCA}` }) };
};
