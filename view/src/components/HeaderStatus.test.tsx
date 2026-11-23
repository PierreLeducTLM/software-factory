import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { HeaderStatus } from './HeaderStatus';
import { textOf } from './fixtures';

const getProps = (overrides?: Partial<Parameters<typeof HeaderStatus>[0]>): Parameters<typeof HeaderStatus>[0] => ({
  loadedAt: '2026-11-21T09:00:00Z',
  refreshedAt: '2026-11-21T09:00:00Z',
  running: 1,
  needsYou: 2,
  reload: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  ...overrides,
});

describe('header status', () => {
  it('shows an enabled Force refresh button next to the freshness line', async () => {
    const screen = await render(<HeaderStatus {...getProps()} />);
    const group = screen.getByRole('group', { name: 'Board freshness' });

    expect(textOf(group.getByRole('status'))).toBe('Updated 0 s ago · 1 running · 2 need you');
    await expect.element(group.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
  });

  it('keeps the button next to the stale line when the board could not be refreshed', async () => {
    const screen = await render(<HeaderStatus {...getProps({ staleSince: '2026-11-21T08:58:00Z', problem: 'Linear is unreachable' })} />);
    const group = screen.getByRole('group', { name: 'Board freshness' });

    expect(textOf(group.getByRole('status'))).toBe('Stale since 08:58 UTC · Linear is unreachable · retrying');
    await expect.element(group.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
  });

  it('reloads the board once and then refreshes the page data when the button is pressed', async () => {
    const order: string[] = [];
    const props = getProps({
      reload: vi.fn(async () => {
        order.push('reload');
      }),
      refresh: vi.fn(async () => {
        order.push('refresh');
      }),
    });
    const screen = await render(<HeaderStatus {...props} />);

    await screen.getByRole('button', { name: 'Force refresh' }).click();

    await expect.element(screen.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
    expect(order).toEqual(['reload', 'refresh']);
  });
});
