import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { Health as HealthData, ProviderHealth } from '../../../src/view/health.js';
import { Health } from './Health';
import { textOf } from './fixtures';

const getProvider = (overrides?: Partial<ProviderHealth>): ProviderHealth => ({
  provider: 'Jira',
  merged: 8,
  firstPassRate: 0.625,
  averageAttempts: 1.5,
  sendBacks: 2,
  blocked: 1,
  failures: [
    { gate: 'unit-tests', count: 4 },
    { gate: 'reviewer', count: 1 },
  ],
  stations: [
    { name: 'build', medianSeconds: 840 },
    { name: 'waiting for merge', medianSeconds: 5400 },
  ],
  levels: [
    { level: 'low', merged: 6, mergedAsIs: 5, changed: 1, reverted: 0, streak: 3, threshold: 3, suggestion: '/factory-workflow enable auto-merge for low risk' },
    { level: 'medium', merged: 2, mergedAsIs: 2, changed: 0, reverted: 1, streak: 0, threshold: 3 },
    { level: 'high', merged: 0, mergedAsIs: 0, changed: 0, reverted: 0, streak: 0, threshold: 3 },
  ],
  ...overrides,
});

const getHealth = (providers: readonly ProviderHealth[] = [getProvider()], periodDays = 7): HealthData => ({ periodDays, providers });

describe('health', () => {
  it('shows the figures of the period for each provider', async () => {
    const screen = await render(<Health health={getHealth([getProvider(), getProvider({ provider: 'Linear', merged: 3 })])} onPeriod={() => undefined} />);
    const jira = screen.getByRole('region', { name: 'Jira' });

    expect(textOf(jira.getByRole('group', { name: 'Totals' }))).toBe('Merged8First-pass rate63%Average attempts1.5Send-backs2Blocked1Cost per mergeNot reported');
    expect(textOf(screen.getByRole('region', { name: 'Linear' }))).toContain('Merged3');
    await expect.element(screen.getByText('The agent runtime does not report cost.').first()).toBeVisible();
  });

  it('lists the gates that failed most and the median time of each station', async () => {
    const screen = await render(<Health health={getHealth()} onPeriod={() => undefined} />);

    expect(screen.getByRole('table', { name: 'Failure reasons by gate' }).getByRole('row').elements().map((row) => row.textContent)).toEqual(['GateFailures', 'unit-tests4', 'reviewer1']);
    expect(screen.getByRole('table', { name: 'Median time per station' }).getByRole('row').elements().map((row) => row.textContent)).toEqual(['StationMedian', 'build14m', 'waiting for merge1h 30m']);
  });

  it('shows shadow-mode agreement per level, and the command that turns auto-merge on once the threshold is reached', async () => {
    const copy = vi.fn(async () => undefined);
    const screen = await render(<Health health={getHealth()} onPeriod={() => undefined} copy={copy} />);
    const rows = screen.getByRole('table', { name: 'Shadow mode by risk level' }).getByRole('row');

    expect(rows.elements().slice(0, 4).map((row) => row.textContent?.replace('Copy command', ''))).toEqual([
      'LevelMergedMerged as isChanged by a personReverted within 2 weeksIn a row',
      'low65103 of 3',
      'medium22010 of 3',
      'high00000 of 3',
    ]);
    expect(textOf(screen.getByRole('region', { name: 'Jira' }))).toContain('Low risk reached 3 changes in a row with no disagreement and no revert. To turn auto-merge on, run:');
    await screen.getByRole('button', { name: 'Copy command' }).click();
    expect(copy).toHaveBeenCalledWith('/factory-workflow enable auto-merge for low risk');
  });

  it('says so when there is nothing to show', async () => {
    const empty = getProvider({ merged: 0, failures: [], stations: [], levels: getProvider().levels.map(({ suggestion: _suggestion, ...level }) => level) });
    const { firstPassRate: _rate, averageAttempts: _attempts, ...quiet } = empty;
    const screen = await render(<Health health={getHealth([quiet])} onPeriod={() => undefined} />);
    const none = await render(<Health health={getHealth([])} onPeriod={() => undefined} />);

    expect(textOf(screen.getByRole('group', { name: 'Totals' }))).toBe('Merged0First-pass rate–Average attempts–Send-backs2Blocked1Cost per mergeNot reported');
    await expect.element(screen.getByText('No gate failed in this period.')).toBeVisible();
    await expect.element(screen.getByText('No step finished in this period.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy command' }).elements()).toHaveLength(0);
    await expect.element(none.getByText('No ticket with a factory record changed in the last 7 days.')).toBeVisible();
  });

  it('switches the period', async () => {
    const onPeriod = vi.fn();
    const screen = await render(<Health health={getHealth([getProvider()], 30)} onPeriod={onPeriod} />);

    await expect.element(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'false');
    await screen.getByRole('button', { name: '90 days' }).click();

    expect(onPeriod).toHaveBeenCalledWith(90);
    expect(textOf(screen.getByRole('main'))).toContain('tickets updated in the last 30 days');
  });
});
