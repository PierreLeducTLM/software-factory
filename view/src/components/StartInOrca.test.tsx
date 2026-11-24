import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { StartResult } from '../../../src/view/source.js';
import { BoardScreen } from './BoardScreen';
import { getCard, getColumns, getDetail } from './fixtures';
import { StartInOrca } from './StartInOrca';

const pending = () => {
  const control: { resolve: (result: StartResult) => void; reject: (reason: unknown) => void } = { resolve: () => undefined, reject: () => undefined };
  const promise = new Promise<StartResult>((resolve, reject) => {
    control.resolve = resolve;
    control.reject = reject;
  });
  return { promise, ...control };
};

const FAILED: StartResult = { ok: false, message: 'Orca could not start PIE-21: Orca is not running' };

describe('start in Orca', () => {
  it('starts the command the panel shows, once, for the card key', async () => {
    const start = vi.fn(async (): Promise<StartResult> => ({ ok: true, worktree: 'pie-21' }));
    const screen = await render(<StartInOrca runKey="PIE-21" command="/factory-refine PIE-21" start={start} />);

    await expect.element(screen.getByRole('button', { name: 'Start in Orca' })).toBeEnabled();
    await screen.getByRole('button', { name: 'Start in Orca' }).click();

    await expect.element(screen.getByText('Started in Orca: pie-21')).toBeVisible();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ key: 'PIE-21', command: '/factory-refine PIE-21' });
  });

  it('is disabled and reads Starting in Orca… while Orca answers, and a second click starts nothing', async () => {
    const running = pending();
    const start = vi.fn(() => running.promise);
    const screen = await render(<StartInOrca runKey="PIE-21" command="/factory-refine PIE-21" start={start} />);

    await screen.getByRole('button', { name: 'Start in Orca' }).click();
    const busy = screen.getByRole('button', { name: 'Starting in Orca…' });
    await expect.element(busy).toBeDisabled();
    busy.element().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(start).toHaveBeenCalledTimes(1);
    running.resolve({ ok: true, worktree: 'pie-21-2' });
    await expect.element(screen.getByText('Started in Orca: pie-21-2')).toBeVisible();
  });

  it('stays disabled after a start, so a second click starts nothing', async () => {
    const start = vi.fn(async (): Promise<StartResult> => ({ ok: true, worktree: 'pie-21' }));
    const screen = await render(<StartInOrca runKey="PIE-21" command="/factory-refine PIE-21" start={start} />);

    await screen.getByRole('button', { name: 'Start in Orca' }).click();
    await expect.element(screen.getByText('Started in Orca: pie-21')).toBeVisible();
    const started = screen.getByRole('button', { name: 'Start in Orca' });
    await expect.element(started).toBeDisabled();
    started.element().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('shows why Orca could not start, and is enabled again', async () => {
    const start = vi.fn(async (): Promise<StartResult> => FAILED);
    const screen = await render(<StartInOrca runKey="PIE-21" command="/factory-refine PIE-21" start={start} />);

    await screen.getByRole('button', { name: 'Start in Orca' }).click();

    await expect.element(screen.getByText('Orca could not start PIE-21: Orca is not running')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Start in Orca' })).toBeEnabled();
  });

  it('says Orca could not start when the dashboard server cannot be reached, and is enabled again', async () => {
    const start = vi.fn(() => Promise.reject(new Error('Failed to fetch')));
    const screen = await render(<StartInOrca runKey="PIE-21" command="/factory-refine PIE-21" start={start} />);

    await screen.getByRole('button', { name: 'Start in Orca' }).click();

    await expect.element(screen.getByText('Orca could not start PIE-21: Failed to fetch')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Start in Orca' })).toBeEnabled();
  });

  it('is enabled again once the panel is closed and the card reopened', async () => {
    const card = getCard({ key: 'PIE-21', onThisMachine: false, command: '/factory-refine PIE-21' });
    const start = vi.fn(async (): Promise<StartResult> => ({ ok: true, worktree: 'pie-21' }));
    const screen = await render(<BoardScreen columns={getColumns({ available: [card] })} loadDetail={async () => getDetail()} startInOrca={start} />);

    await screen.getByRole('button', { name: /Open PIE-21/ }).click();
    await screen.getByRole('button', { name: 'Start in Orca' }).click();
    await expect.element(screen.getByRole('button', { name: 'Start in Orca' })).toBeDisabled();
    await screen.getByRole('button', { name: 'Close run detail' }).click();
    await screen.getByRole('button', { name: /Open PIE-21/ }).click();

    await expect.element(screen.getByRole('button', { name: 'Start in Orca' })).toBeEnabled();
    expect(screen.getByText('Started in Orca: pie-21').elements()).toHaveLength(0);
  });
});
