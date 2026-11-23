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
    ['available', ['PAY-160']],
    ['refining', ['PAY-147', 'PAY-155', 'PAY-158']],
    ['ready', ['PAY-151', 'ENG-90']],
    ['revalidate', ['PAY-149']],
    ['build', ['PAY-142', 'ENG-87', 'ENG-95']],
    ['review', ['GH-231']],
    ['pr', ['PAY-138', 'ENG-88']],
    ['needs_you', ['ENG-85', 'PAY-133', 'ENG-95', 'PAY-147', 'PAY-138', 'ENG-88', 'PAY-155', 'PAY-151']],
    ['done', ['PAY-130', 'PAY-128', 'PAY-127', 'ENG-84', 'ENG-82', 'ENG-85']],
  ]);
  expect(data.needsYou.map((item) => [item.category, item.key])).toEqual([
    ['revert', 'ENG-85'],
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

it('shows a ticket available for refinement and every stage of refinement, but not the backlog left out of the factory', async () => {
  const source = createDemoViewSource({ config: getConfig(), now: () => '2026-11-21T09:00:00Z' });

  const data = await source.load();
  const notesIn = (id: string) => data.columns.find((column) => column.id === id)?.cards.map((card) => [card.key, card.note, card.command]);

  expect(notesIn('available')).toEqual([['PAY-160', 'Available for refinement', '/factory-refine PAY-160']]);
  expect(notesIn('refining')).toEqual([
    ['PAY-147', 'Sent back · 1 question', '/factory-refine PAY-147'],
    ['PAY-155', 'Gate passed, waiting for approval', '/factory-refine PAY-155'],
    ['PAY-158', 'Gate failed', '/factory-refine PAY-158'],
  ]);
  expect(data.columns.flatMap((column) => column.cards.map((card) => card.key))).not.toContain('PAY-161');
});

it('has merged work to show on Health: changes merged as is, one edited by a person and two reverted', async () => {
  const source = createDemoViewSource({ config: getConfig(), now: () => '2026-11-21T09:00:00Z' });

  const [health] = (await source.health(7)).providers;

  expect(health).toMatchObject({ provider: 'Sample data', merged: 6, firstPassRate: 1, averageAttempts: 1, sendBacks: 1, blocked: 1, failures: [{ gate: 'unit-tests', count: 2 }] });
  expect(health?.levels.map(({ level, merged, mergedAsIs, changed, reverted, streak }) => [level, merged, mergedAsIs, changed, reverted, streak])).toEqual([
    ['low', 4, 3, 1, 1, 2],
    ['medium', 1, 1, 0, 1, 0],
    ['high', 1, 1, 0, 0, 1],
  ]);
  expect(health?.stations).toEqual([
    { name: 'revalidate', medianSeconds: 60 },
    { name: 'build', medianSeconds: 840 },
    { name: 'quality', medianSeconds: 300 },
    { name: 'verify', medianSeconds: 240 },
    { name: 'review', medianSeconds: 360 },
    { name: 'waiting for merge', medianSeconds: 9000 },
  ]);
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

it('says that a sample run has no Orca session to open', async () => {
  const source = createDemoViewSource({ config: getConfig(), now: () => '2026-11-21T08:00:00Z' });

  expect(await source.openInOrca('PAY-149')).toEqual({ ok: false, message: 'Orca could not open the run: This is sample data, with no Orca session behind it.' });
});
