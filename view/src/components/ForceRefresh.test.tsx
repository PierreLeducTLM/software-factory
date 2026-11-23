import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ForceRefresh } from './ForceRefresh';

const pending = () => {
  const control: { resolve: () => void; reject: (reason: unknown) => void } = { resolve: () => undefined, reject: () => undefined };
  const promise = new Promise<void>((resolve, reject) => {
    control.resolve = resolve;
    control.reject = reject;
  });
  return { promise, ...control };
};

describe('force refresh', () => {
  it('shows an enabled Force refresh button', async () => {
    const screen = await render(<ForceRefresh reload={vi.fn(async () => undefined)} refresh={vi.fn(async () => undefined)} />);

    await expect.element(screen.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
  });

  it('reloads the board once, then refreshes the page data', async () => {
    const order: string[] = [];
    const reload = vi.fn(async () => {
      order.push('reload');
    });
    const refresh = vi.fn(async () => {
      order.push('refresh');
    });
    const screen = await render(<ForceRefresh reload={reload} refresh={refresh} />);

    await screen.getByRole('button', { name: 'Force refresh' }).click();

    await expect.element(screen.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
    expect(order).toEqual(['reload', 'refresh']);
  });

  it('is disabled and reads Refreshing… while the reload runs, and a second click starts nothing', async () => {
    const running = pending();
    const reload = vi.fn(() => running.promise);
    const refresh = vi.fn(async () => undefined);
    const screen = await render(<ForceRefresh reload={reload} refresh={refresh} />);

    await screen.getByRole('button', { name: 'Force refresh' }).click();
    const busy = screen.getByRole('button', { name: 'Refreshing…' });
    await expect.element(busy).toBeDisabled();
    busy.element().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    running.resolve();
    await expect.element(screen.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('is enabled again, and refreshes the page data, when the reload fails', async () => {
    const running = pending();
    const refresh = vi.fn(async () => undefined);
    const screen = await render(<ForceRefresh reload={() => running.promise} refresh={refresh} />);

    await screen.getByRole('button', { name: 'Force refresh' }).click();
    await expect.element(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    running.reject(new Error('server unreachable'));

    await expect.element(screen.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stays disabled until the page data is refreshed', async () => {
    const refreshing = pending();
    const screen = await render(<ForceRefresh reload={async () => undefined} refresh={() => refreshing.promise} />);

    await screen.getByRole('button', { name: 'Force refresh' }).click();

    await expect.element(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    refreshing.resolve();
    await expect.element(screen.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
  });

  it('is enabled again when refreshing the page data fails', async () => {
    const screen = await render(<ForceRefresh reload={async () => undefined} refresh={() => Promise.reject(new Error('router failed'))} />);

    await screen.getByRole('button', { name: 'Force refresh' }).click();

    await expect.element(screen.getByRole('button', { name: 'Force refresh' })).toBeEnabled();
  });
});
