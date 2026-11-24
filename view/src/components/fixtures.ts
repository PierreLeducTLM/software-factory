import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import type { Card, Column, NeedsYouItem, RunDetail } from '../../../src/view/model.js';
import { cardSearch } from './BoardScreen';

export const getCard = (overrides?: Partial<Card>): Card => ({
  key: 'PAY-142',
  title: 'Bulk invoice export',
  provider: 'Jira',
  note: 'Building',
  claimant: 'pierre',
  risk: 'low',
  run: { number: 1, limit: 3 },
  attempt: { number: 2, limit: 5 },
  rows: [{ number: 2, build: 'running', gate: 'pending', verify: 'pending', review: 'pending' }],
  earlierAttempts: 0,
  seconds: 840,
  interrupted: false,
  recordEdited: false,
  onThisMachine: true,
  ...overrides,
});

const COLUMN_NAMES = { available: 'Available', refining: 'Refining', ready: 'Ready', revalidate: 'Revalidate', build: 'Build', review: 'Review', pr: 'Pull request', needs_you: 'Needs you', done: 'Done' } as const;

export const getColumns = (cards: Partial<Record<Column['id'], readonly Card[]>> = { build: [getCard()] }): readonly Column[] =>
  (['available', 'refining', 'ready', 'revalidate', 'build', 'review', 'pr', 'needs_you', 'done'] as const).map((id) => ({ id, name: COLUMN_NAMES[id], cards: cards[id] ?? [] }));

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

export const getSampleColumns = (): readonly Column[] =>
  getColumns({
    available: [getCard({ key: 'PIE-21', title: 'Start a worktree from the dashboard', rows: [], note: 'Available for refinement' })],
    ready: [getCard({ key: 'ENG-90', title: 'Webhook retry policy', rows: [], note: 'Eligible for /factory-next' }), getCard({ key: 'PAY-151', title: 'Refund export', rows: [], note: 'Waiting for a developer' })],
    build: [getCard(), getCard({ key: 'ENG-95', title: 'Audit log export', earlierAttempts: 1, risk: 'medium' })],
    review: [getCard({ key: 'ENG-87', title: 'Retry back-off for exports', rows: [{ number: 1, build: 'pass', gate: 'pass', verify: 'pass', review: 'running' }] })],
    pr: [getCard({ key: 'ENG-88', title: 'Currency rounding', pullRequest: 'https://github.test/pull/412' })],
    needs_you: [
      getCard({ key: 'PAY-147', title: 'Invoice PDF footer', note: 'Sent back with 1 question.', category: 'sent_back' }),
      getCard({ key: 'PAY-155', title: 'Late fee reminder', note: 'The ready gate passed. Waiting for approval.', category: 'approve', risk: 'high' }),
    ],
    done: [getCard({ key: 'ENG-80', title: 'CSV import' }), getCard({ key: 'ENG-81', title: 'Tax report' })],
  });

const Rendered = createContext<ReactNode>(null);

export const renderBoard = async (ui: ReactNode, { entries = ['/'] }: { readonly entries?: readonly string[] } = {}) => {
  const root = createRootRoute();
  const board = createRoute({ getParentRoute: () => root, path: '/', validateSearch: cardSearch, component: () => useContext(Rendered) });
  const needsYou = createRoute({ getParentRoute: () => root, path: '/needs-you', component: () => createElement('h1', null, 'Needs you page') });
  const router = createRouter({ routeTree: root.addChildren([board, needsYou]), history: createMemoryHistory({ initialEntries: [...entries], initialIndex: entries.length - 1 }), scrollRestoration: true });
  await router.load();
  const within = (node: ReactNode) => createElement(Rendered.Provider, { value: node }, createElement(RouterProvider, { router }));
  const screen = await render(within(ui));
  return { ...screen, router, rerender: (node: ReactNode) => screen.rerender(within(node)) };
};
