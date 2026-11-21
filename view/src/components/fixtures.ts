import type { Card, Column, NeedsYouItem, RunDetail } from '../../../src/view/model.js';

export const getCard = (overrides?: Partial<Card>): Card => ({
  key: 'PAY-142',
  title: 'Bulk invoice export',
  provider: 'Jira',
  note: 'Building',
  claimant: 'pierre',
  risk: 'low',
  run: { number: 1, limit: 3 },
  attempt: { number: 2, limit: 5 },
  rows: [
    { number: 1, build: 'pass', gate: 'fail', verify: 'pending', review: 'pending' },
    { number: 2, build: 'running', gate: 'pending', verify: 'pending', review: 'pending' },
  ],
  earlierAttempts: 0,
  seconds: 840,
  interrupted: false,
  recordEdited: false,
  onThisMachine: true,
  ...overrides,
});

const COLUMN_NAMES = { ready: 'Ready', revalidate: 'Revalidate', build: 'Build', review: 'Review', pr: 'Pull request', needs_you: 'Needs you', done: 'Done' } as const;

export const getColumns = (cards: Partial<Record<Column['id'], readonly Card[]>> = { build: [getCard()] }): readonly Column[] =>
  (['ready', 'revalidate', 'build', 'review', 'pr', 'needs_you', 'done'] as const).map((id) => ({ id, name: COLUMN_NAMES[id], cards: cards[id] ?? [] }));

export const getDetail = (overrides?: Partial<RunDetail>): RunDetail => ({
  key: 'PAY-142',
  title: 'Bulk invoice export',
  sections: [
    { title: 'Refinement', steps: [{ label: 'Approval', status: 'pass', lines: ['Approved by pierre at 2026-11-20T16:00:00Z'], links: [] }] },
    {
      title: 'Attempt 1 of 5',
      steps: [
        { label: 'Build', status: 'pass', lines: ['Added the exporter'], links: [] },
        { label: 'Quality gate', status: 'fail', lines: ['unit-tests: failed (exit code 1)', 'export.test.ts › splits files: expected 2, got 1'], links: [] },
        { label: 'Review', status: 'pending', lines: [], links: ['https://ci.test/evidence/1', 'shots/settings.png'] },
      ],
    },
  ],
  ...overrides,
});

export const getItem = (overrides?: Partial<NeedsYouItem>): NeedsYouItem => ({
  category: 'blocked',
  key: 'PAY-133',
  title: 'Multi-currency totals',
  provider: 'Jira',
  since: '2026-11-21T08:35:00Z',
  why: 'Failed 5 of 5 attempts. Diagnosis: environment.',
  command: '/factory-run PAY-133',
  questions: [],
  ...overrides,
});

export const textOf = (locator: { readonly element: () => Element }): string => locator.element().textContent ?? '';
