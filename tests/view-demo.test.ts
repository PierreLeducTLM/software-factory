import { expect, it } from 'vitest';
import { parseFactoryConfig } from '../src/config/project-config.js';
import { createDemoViewSource } from '../src/view/demo.js';

const getConfig = () => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: Doing, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks: []
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`);
  if (!parsed.ok) throw new Error('invalid test config');
  return parsed.value;
};

it('fills every column and every kind of item with sample tickets, whatever the project calls its statuses', async () => {
  const source = createDemoViewSource({ config: getConfig(), now: () => '2026-11-21T09:00:00Z' });

  const data = await source.load();

  expect(data.providers).toEqual(['Sample data']);
  expect(data.columns.map((column) => [column.id, column.cards.map((card) => card.key)])).toEqual([
    ['ready', ['PAY-151', 'ENG-90']],
    ['revalidate', ['PAY-149']],
    ['build', ['PAY-142', 'ENG-87', 'ENG-95']],
    ['review', ['GH-231']],
    ['pr', ['PAY-138', 'ENG-88']],
    ['needs_you', ['PAY-133', 'PAY-147']],
    ['done', ['PAY-130']],
  ]);
  expect(data.needsYou.map((item) => [item.category, item.key])).toEqual([
    ['blocked', 'PAY-133'],
    ['interrupted', 'ENG-95'],
    ['sent_back', 'PAY-147'],
    ['merge', 'PAY-138'],
    ['merge', 'ENG-88'],
    ['approve', 'PAY-155'],
    ['not_started', 'PAY-151'],
  ]);
  expect(data.running).toBe(4);
});

it('shows a run with a failed first attempt and a second one being built', async () => {
  const source = createDemoViewSource({ config: getConfig(), now: () => '2026-11-21T09:00:00Z' });
  const data = await source.load();

  const card = data.columns.find((column) => column.id === 'build')?.cards.find((candidate) => candidate.key === 'PAY-142');
  const detail = await source.detail('PAY-142');

  expect(card?.rows).toEqual([
    { number: 1, build: 'pass', gate: 'fail', verify: 'pending', review: 'pending' },
    { number: 2, build: 'running', gate: 'pending', verify: 'pending', review: 'pending' },
  ]);
  expect(card?.onThisMachine).toBe(true);
  expect(detail?.sections.map((section) => section.title)).toEqual(['Refinement', 'Run 1 of 3', 'Attempt 1 of 5', 'Attempt 2 of 5']);
});
