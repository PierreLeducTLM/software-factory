import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../styles.css';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import type { NeedsYouItem } from '../../../src/view/model.js';
import { BoardScreen } from './BoardScreen';
import { NeedsYouStrip } from './NeedsYouStrip';
import { getCard, getColumns, getItem, renderBoard, textOf } from './fixtures';

const noDetail = async () => undefined;

const twoItems = [
  getItem({ category: 'sent_back', key: 'PAY-147', title: 'Invoice PDF footer', why: 'Sent back · 1 question' }),
  getItem({ category: 'approve', key: 'PAY-155', title: 'Late fee reminder', why: 'Waiting for approval', command: '/factory-refine PAY-155' }),
];

const eightItems = Array.from({ length: 8 }, (_, index) => getItem({ key: `PAY-${160 + index}`, why: `Failed 5 of 5 attempts on the bulk export of ticket number ${index + 1}. Diagnosis: environment.` }));

const columnsFor = (items: readonly ReturnType<typeof getItem>[]) =>
  getColumns({ needs_you: items.map((item) => getCard({ key: item.key, title: item.title, note: item.why, category: item.category, ...(item.command === undefined ? {} : { command: item.command }) })) });

const stripOf = (screen: Awaited<ReturnType<typeof renderBoard>>) => screen.getByRole('navigation', { name: 'Needs you' });

describe('needs you strip', () => {
  it('lists each ticket that needs a person, in the Needs you page order, with its key and reason', async () => {
    await page.viewport(1440, 900);
    const screen = await renderBoard(<BoardScreen columns={columnsFor(twoItems)} needsYou={twoItems} loadDetail={noDetail} />);
    const strip = stripOf(screen);

    await expect.element(strip.getByText('2 need you').first()).toBeVisible();
    expect(strip.getByRole('button').elements().map((item) => item.textContent)).toEqual(['PAY-147 Sent back · 1 question', 'PAY-155 Waiting for approval']);
    expect(strip.getByText(/more/).elements()).toHaveLength(0);
    expect(strip.getByRole('link').elements()).toHaveLength(0);
  });

  it('shows no strip when nothing needs a person', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns()} needsYou={[]} loadDetail={noDetail} />);

    await expect.element(screen.getByRole('heading', { name: 'Needs you 0' })).toBeVisible();
    expect(stripOf(screen).elements()).toHaveLength(0);
  });

  it('keeps to two lines, showing the first items then "+N more" linking to the Needs you page', async () => {
    await page.viewport(1440, 900);
    const screen = await renderBoard(<BoardScreen columns={columnsFor(eightItems)} needsYou={eightItems} loadDetail={noDetail} />);
    const strip = stripOf(screen);
    const more = strip.getByRole('link', { name: /^\+\d+ more$/ });

    await expect.element(more).toBeVisible();
    const shown = strip.getByRole('button').elements().map((item) => item.textContent?.split(' ')[0]);
    const tops = [...strip.element().querySelectorAll('li')].map((item) => Math.round(item.getBoundingClientRect().top));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toEqual(eightItems.slice(0, shown.length).map((item) => item.key));
    expect(textOf(more)).toBe(`+${8 - shown.length} more`);
    expect(new Set(tops).size).toBe(2);

    await more.click();
    await expect.element(screen.getByRole('heading', { name: 'Needs you page' })).toBeVisible();
  });

  it('keeps to two lines however many tickets need a person', async () => {
    await page.viewport(1440, 900);
    const many = Array.from({ length: 150 }, (_, index) => getItem({ key: `ENG-${100 + index}`, why: 'Waiting for approval' }));
    const screen = await renderBoard(<BoardScreen columns={columnsFor(many)} needsYou={many} loadDetail={noDetail} />);
    const strip = stripOf(screen);

    await expect.element(strip.getByText('150 need you').first()).toBeVisible();
    const shown = strip.getByRole('button').elements().length;
    expect(textOf(strip.getByRole('link', { name: /more$/ }))).toBe(`+${150 - shown} more`);
    expect(new Set([...strip.element().querySelectorAll('li')].map((item) => Math.round(item.getBoundingClientRect().top))).size).toBe(2);
  });

  it('opens the ticket\'s Needs you card in the drawer, and returns focus to the item on Escape', async () => {
    await page.viewport(1440, 900);
    const station = getCard({ key: 'PAY-155', title: 'Late fee reminder', note: 'Waiting for a developer', command: '/factory-run PAY-155' });
    const columns = getColumns({ ready: [station], needs_you: columnsFor(twoItems).find((column) => column.id === 'needs_you')?.cards ?? [] });
    const screen = await renderBoard(<BoardScreen columns={columns} needsYou={twoItems} loadDetail={noDetail} />);
    const item = stripOf(screen).getByRole('button', { name: /PAY-155/ });
    const drawer = screen.getByRole('complementary', { name: 'Run detail' });

    await item.click();

    await expect.element(drawer.getByText('Waiting for approval')).toBeVisible();
    await expect.element(drawer.getByText('/factory-refine PAY-155')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(drawer).not.toBeInTheDocument();
    await expect.element(item).toHaveFocus();
  });

  it('measures again when the window goes to phone width and back', async () => {
    await page.viewport(1440, 900);
    const whys = ['Revert this change by hand: the staging watch failed on ./smoke.sh.', 'Failed 5 of 5 attempts. Diagnosis: environment.', 'The build step never ended. Claimed by sam.', 'Sent back with 1 question.', 'Merge by a person.', 'Would have auto-merged.', 'The ready gate passed. Waiting for approval.', 'Ready for 48 hours with no factory-auto label.'];
    const items = eightItems.map((item, index) => ({ ...item, why: whys[index] ?? '' }));
    const screen = await renderBoard(<BoardScreen columns={columnsFor(items)} needsYou={items} loadDetail={noDetail} />);
    const strip = stripOf(screen);
    await expect.poll(() => strip.getByRole('button').elements().length).toBe(8);
    await new Promise((resolve) => setTimeout(resolve, 100));

    await page.viewport(600, 900);
    await expect.element(strip.getByRole('link', { name: '8 need you' })).toBeVisible();
    await page.viewport(1440, 900);

    await expect.poll(() => strip.getByRole('button').elements().length).toBe(8);
    expect(strip.getByRole('link', { name: /more$/ }).elements()).toHaveLength(0);
  });

  it('shows only the count, linking to the Needs you page, on a phone', async () => {
    await page.viewport(390, 844);
    const screen = await renderBoard(<BoardScreen columns={columnsFor(eightItems)} needsYou={eightItems} loadDetail={noDetail} />);
    const strip = stripOf(screen);

    await expect.element(strip.getByRole('link', { name: '8 need you' })).toBeVisible();
    expect(strip.getByRole('button').elements()).toHaveLength(0);

    await strip.getByRole('link', { name: '8 need you' }).click();
    await expect.element(screen.getByRole('heading', { name: 'Needs you page' })).toBeVisible();
  });
});

const serverRendered = async (items: readonly NeedsYouItem[]): Promise<HTMLElement> => {
  const root = createRootRoute({ component: () => <NeedsYouStrip items={items} onOpen={() => undefined} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  await router.load();
  const host = document.createElement('div');
  host.innerHTML = renderToString(<RouterProvider router={router} />);
  document.body.append(host);
  const strip = host.querySelector<HTMLElement>('nav.strip');
  if (strip === null) throw new Error('The server rendered no strip');
  return strip;
};

describe('the strip as the server sends it, before the page runs any script', () => {
  const nine = Array.from({ length: 9 }, (_, index) => getItem({ key: `ENG-${80 + index}`, why: `Failed 5 of 5 attempts on the bulk export of ticket number ${index + 1}. Diagnosis: environment.` }));

  it('shows only the count on a phone, as tall as the strip the page then shows', async () => {
    await page.viewport(390, 844);
    const screen = await renderBoard(<BoardScreen columns={columnsFor(nine)} needsYou={nine} loadDetail={noDetail} />);
    await expect.element(stripOf(screen).getByRole('link', { name: '9 need you' })).toBeVisible();
    const shownHeight = stripOf(screen).element().getBoundingClientRect().height;

    const strip = await serverRendered(nine);

    expect(strip.innerText.trim()).toBe('9 need you');
    expect(strip.getBoundingClientRect().height).toBe(shownHeight);
    strip.parentElement?.remove();
  });

  it('takes at most two lines at 1440px, as tall as the strip the page then shows', async () => {
    await page.viewport(1440, 900);
    const screen = await renderBoard(<BoardScreen columns={columnsFor(nine)} needsYou={nine} loadDetail={noDetail} />);
    await expect.element(stripOf(screen).getByRole('link', { name: /more$/ })).toBeVisible();
    const shownHeight = stripOf(screen).element().getBoundingClientRect().height;

    const strip = await serverRendered(nine);

    const visibleRows = new Set(
      [...strip.querySelectorAll('li')]
        .filter((item) => item.getBoundingClientRect().bottom <= (strip.querySelector('ul')?.getBoundingClientRect().bottom ?? 0))
        .map((item) => Math.round(item.getBoundingClientRect().top)),
    );
    expect(visibleRows.size).toBe(2);
    expect(strip.getBoundingClientRect().height).toBe(shownHeight);
    strip.parentElement?.remove();
  });
});
