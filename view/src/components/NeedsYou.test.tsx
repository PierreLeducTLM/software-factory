import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { Freshness } from './Freshness';
import { NeedsYou } from './NeedsYou';
import { textOf, getItem } from './fixtures';

const NOW = '2026-11-21T09:00:00Z';

const { command: _command, ...merge } = getItem({ category: 'merge', key: 'PAY-138', title: 'Partial refunds', since: '2026-11-19T09:00:00Z', why: 'Merge by a person.', link: 'https://github.test/pull/412' });

const items = [
  getItem(),
  getItem({ category: 'sent_back', key: 'PAY-147', title: 'Tax rounding rules', since: '2026-11-21T06:00:00Z', why: 'Sent back with 1 question.', command: '/factory-refine PAY-147', questions: [{ question: 'Should tax rounding follow per-line rounding?', recommended: 'Yes.' }] }),
  merge,
  getItem({ key: 'PAY-120', title: 'Invoice PDF layout', since: '2026-11-20T08:59:00Z', link: 'memory://report' }),
];

describe('needs you', () => {
  it('lists each item with its kind, how long it has waited, why, and its questions', async () => {
    const screen = await render(<NeedsYou items={items} now={NOW} />);
    const rows = screen.getByRole('listitem');

    expect(textOf(rows.nth(0))).toContain('Blocked');
    expect(textOf(rows.nth(0))).toContain('waiting 25 mins');
    expect(textOf(rows.nth(0))).toContain('PAY-133 Multi-currency totals Jira');
    expect(textOf(rows.nth(0))).toContain('Failed 5 of 5 attempts. Diagnosis: environment.');
    expect(textOf(rows.nth(1))).toContain('waiting 3 hours');
    expect(textOf(rows.nth(1))).toContain('Should tax rounding follow per-line rounding?');
    expect(textOf(rows.nth(1))).toContain('Recommended: Yes.');
    expect(textOf(rows.nth(2))).toContain('Ready to merge');
    expect(textOf(rows.nth(2))).toContain('waiting 2 days');
    expect(textOf(rows.nth(3))).toContain('waiting 1 day');
  });

  it('copies the command of an item, and links to its pull request or report', async () => {
    const copy = vi.fn(async () => undefined);
    const screen = await render(<NeedsYou items={items} now={NOW} copy={copy} />);
    const rows = screen.getByRole('listitem');

    await rows.nth(0).getByRole('button', { name: 'Copy command' }).click();

    expect(copy).toHaveBeenCalledWith('/factory-run PAY-133');
    await expect.element(rows.nth(0).getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect.element(rows.nth(2).getByRole('link', { name: 'Open pull request' })).toHaveAttribute('href', 'https://github.test/pull/412');
    await expect.element(rows.nth(3).getByRole('link', { name: 'Open report' })).toHaveAttribute('href', 'memory://report');
    expect(rows.nth(2).getByRole('button').elements()).toHaveLength(0);
  });

  it('filters by kind, offering only the kinds that are present with their counts', async () => {
    const screen = await render(<NeedsYou items={items} now={NOW} />);
    const filters = screen.getByRole('group', { name: 'Filter' });

    await expect.element(filters.getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true');
    expect(filters.getByRole('button').elements().map((button) => button.textContent)).toEqual(['All 4', 'Blocked 2', 'Sent back 1', 'Ready to merge 1']);

    await filters.getByRole('button', { name: 'Blocked 2' }).click();

    await expect.element(filters.getByRole('button', { name: 'Blocked 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('listitem').elements()).toHaveLength(2);

    await filters.getByRole('button', { name: 'All 4' }).click();

    expect(screen.getByRole('listitem').elements()).toHaveLength(4);
  });

  it('says so when nothing needs a person, and names every kind', async () => {
    const empty = await render(<NeedsYou items={[]} now={NOW} />);
    await expect.element(empty.getByText('Nothing needs you right now.')).toBeVisible();
    await empty.unmount();

    const kinds = (['run_limit', 'interrupted', 'record_edited', 'approve', 'not_started'] as const).map((category) => getItem({ category, key: category, since: '2026-11-21T08:59:30Z' }));
    const all = await render(<NeedsYou items={kinds} now={NOW} />);

    expect(all.getByRole('listitem').elements().map((item) => item.querySelector('.item__label')?.textContent)).toEqual(['Run limit reached', 'Interrupted', 'Record edited', 'Approve spec', 'Not started']);
    expect(textOf(all.getByRole('listitem').nth(0))).toContain('waiting 0 mins');
  });
});

describe('freshness', () => {
  it('says how long ago the tickets were read, how many runs are going and how many items need a person', async () => {
    const screen = await render(<Freshness loadedAt="2026-11-21T09:00:40Z" refreshedAt="2026-11-21T09:00:00Z" running={4} needsYou={9} />);

    expect(textOf(screen.getByRole('status'))).toContain('Updated 40 s ago · 4 running · 9 need you');
  });

  it('says since when the data is stale and why', async () => {
    const stale = await render(<Freshness loadedAt="2026-11-21T09:05:00Z" refreshedAt="2026-11-21T09:00:00Z" staleSince="2026-11-21T09:00:00Z" problem="Jira is unreachable" running={0} needsYou={0} />);
    expect(textOf(stale.getByRole('status'))).toContain('Stale since 09:00 UTC · Jira is unreachable · retrying');
    await stale.unmount();

    const noReason = await render(<Freshness loadedAt="2026-11-21T09:05:00Z" staleSince="2026-11-21T14:02:00Z" running={0} needsYou={0} />);
    expect(textOf(noReason.getByRole('status'))).toContain('Stale since 14:02 UTC · retrying');
  });

  it('shows zero seconds before the first refresh is known', async () => {
    const screen = await render(<Freshness loadedAt="2026-11-21T09:00:40Z" running={0} needsYou={0} />);

    expect(textOf(screen.getByRole('status'))).toContain('Updated 0 s ago');
  });
});
