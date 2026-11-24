import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { HeaderStatus } from './HeaderStatus';
import { JokeButton } from './JokeButton';
import { textOf } from './fixtures';

const JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  "There are 10 kinds of people: those who understand binary and those who don't.",
  'A SQL query walks into a bar, goes up to two tables and asks: may I join you?',
  'Why did the pull request go to therapy? It had too many unresolved conflicts.',
  'Why did the developer go broke? Because they used up all their cache.',
] as const;

describe('the joke button', () => {
  it('shows an enabled Tell me a joke button and no joke before any press', async () => {
    const screen = await render(<JokeButton />);

    await expect.element(screen.getByRole('button', { name: 'Tell me a joke' })).toBeEnabled();
    expect(screen.getByRole('status').elements()).toHaveLength(0);
  });

  it('displays the first joke on the first press, and still reads Tell me a joke, enabled', async () => {
    const screen = await render(<JokeButton />);

    await screen.getByRole('button', { name: 'Tell me a joke' }).click();

    await expect.element(screen.getByText(JOKES[0])).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Tell me a joke' })).toBeEnabled();
  });

  it('displays the five jokes in order, each replacing the one before, then the first again', async () => {
    const screen = await render(<JokeButton />);
    const button = screen.getByRole('button', { name: 'Tell me a joke' });
    const shown: string[] = [];

    for (let press = 0; press <= JOKES.length; press += 1) {
      await button.click();
      shown.push(textOf(screen.getByRole('status')));
    }

    expect(shown).toEqual([...JOKES, JOKES[0]]);
  });

  it('displays the joke as a status message, with no button but Tell me a joke', async () => {
    const screen = await render(<JokeButton />);

    await screen.getByRole('button', { name: 'Tell me a joke' }).click();

    expect(textOf(screen.getByRole('status'))).toBe(JOKES[0]);
    expect(screen.getByRole('button').elements().map((button) => button.textContent)).toEqual(['Tell me a joke']);
  });

  it('sends no request when pressed', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    const sendSpy = vi.spyOn(XMLHttpRequest.prototype, 'send');
    const screen = await render(<JokeButton />);

    await screen.getByRole('button', { name: 'Tell me a joke' }).click();
    await expect.element(screen.getByRole('status')).toHaveTextContent(JOKES[0]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    sendSpy.mockRestore();
  });

  it('starts over on a fresh page', async () => {
    const earlier = await render(<JokeButton />);
    const pressEarlier = () => earlier.getByRole('button', { name: 'Tell me a joke' }).click();
    await pressEarlier();
    await pressEarlier();
    await pressEarlier();
    await expect.element(earlier.getByRole('status')).toHaveTextContent(JOKES[2]);
    await earlier.unmount();

    const screen = await render(<JokeButton />);
    expect(screen.getByRole('status').elements()).toHaveLength(0);
    await screen.getByRole('button', { name: 'Tell me a joke' }).click();

    expect(textOf(screen.getByRole('status'))).toBe(JOKES[0]);
  });

  it('keeps the joke, and which joke comes next, across a change of page and a refresh', async () => {
    const root = createRootRoute({
      component: () => (
        <>
          <header className="top">
            <JokeButton />
          </header>
          <Outlet />
        </>
      ),
    });
    const board = createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>Board page</h1> });
    const needsYou = createRoute({ getParentRoute: () => root, path: '/needs-you', component: () => <h1>Needs you page</h1> });
    const router = createRouter({ routeTree: root.addChildren([board, needsYou]), history: createMemoryHistory({ initialEntries: ['/'] }) });
    await router.load();
    const screen = await render(<RouterProvider router={router} />);

    await screen.getByRole('button', { name: 'Tell me a joke' }).click();
    await router.navigate({ to: '/needs-you' });
    await expect.element(screen.getByRole('heading', { name: 'Needs you page' })).toBeVisible();
    await router.invalidate();

    expect(textOf(screen.getByRole('status'))).toBe(JOKES[0]);
    await screen.getByRole('button', { name: 'Tell me a joke' }).click();
    expect(textOf(screen.getByRole('status'))).toBe(JOKES[1]);
  });

  it('neither reloads nor refreshes the board, and leaves the freshness line as it was', async () => {
    const reload = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const screen = await render(
      <JokeButton>
        <HeaderStatus loadedAt="2026-11-24T10:00:12Z" refreshedAt="2026-11-24T10:00:00Z" running={1} needsYou={0} reload={reload} refresh={refresh} />
      </JokeButton>,
    );
    const freshness = screen.getByRole('group', { name: 'Board freshness' }).getByRole('status');

    expect(textOf(freshness)).toBe('Updated 12 s ago · 1 running · 0 need you');
    await screen.getByRole('button', { name: 'Tell me a joke' }).click();
    await expect.element(screen.getByText(JOKES[0])).toBeVisible();

    expect(reload).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(textOf(freshness)).toBe('Updated 12 s ago · 1 running · 0 need you');
  });
});
