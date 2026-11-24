import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '../styles.css';
import type { Column } from '../../../src/view/model.js';
import type { ComponentProps } from 'react';
import { BoardScreen, useCardAddress } from './BoardScreen';
import { HeaderStatus } from './HeaderStatus';
import { getCard, getColumns, getItem, getSampleColumns, renderBoard } from './fixtures';

const noDetail = async () => undefined;

function AddressedBoard(props: ComponentProps<typeof BoardScreen>) {
  return <BoardScreen {...props} address={useCardAddress()} />;
}

const COLUMN_ORDER = ['Available', 'Refining', 'Ready', 'Revalidate', 'Build', 'Review', 'Pull request', 'Needs you', 'Done'];

const pageScrollsSideways = (): boolean => document.documentElement.scrollWidth > document.documentElement.clientWidth;

const headingsOf = (screen: Awaited<ReturnType<typeof renderBoard>>): readonly Element[] => screen.getByRole('heading', { level: 2 }).elements().filter((heading) => heading.closest('.board') !== null);

const boardOf = (screen: Awaited<ReturnType<typeof renderBoard>>): Element => screen.getByRole('region', { name: 'Pipeline' }).element();

const fullColumns = (): readonly Column[] =>
  getColumns(
    Object.fromEntries(
      (['available', 'refining', 'ready', 'revalidate', 'build', 'review', 'pr', 'needs_you', 'done'] as const).map((id) => [
        id,
        [getCard({ key: `ENG-${id.length}00`, risk: 'medium', rows: [{ number: 3, build: 'pass', gate: 'pass', verify: 'fail', review: 'pending' }], earlierAttempts: 2 })],
      ]),
    ),
  );

describe('the Board fits the screen', () => {
  it('shows all nine columns at 1440px with no sideways scroll', async () => {
    await page.viewport(1440, 900);
    const screen = await renderBoard(<BoardScreen columns={getSampleColumns()} loadDetail={noDetail} />);

    expect(headingsOf(screen).map((heading) => heading.getBoundingClientRect().right <= window.innerWidth)).toEqual(COLUMN_ORDER.map(() => true));
    expect(pageScrollsSideways()).toBe(false);
    expect(boardOf(screen).scrollWidth).toBeLessThanOrEqual(boardOf(screen).clientWidth);
  });

  it('keeps the four chips of a card on one line at 1280px, even with every column full', async () => {
    await page.viewport(1280, 900);
    const screen = await renderBoard(<BoardScreen columns={fullColumns()} loadDetail={noDetail} />);
    const chipTops = screen.getByTitle(/^(build|gate|verify|review) /).elements().map((chip) => Math.round(chip.getBoundingClientRect().top));

    expect(chipTops).toHaveLength(36);
    expect(new Set(chipTops).size).toBe(1);
    expect(pageScrollsSideways()).toBe(false);
    expect(boardOf(screen).scrollWidth).toBeLessThanOrEqual(boardOf(screen).clientWidth);
  });

  it('shrinks an empty column to a narrow strip with its name and count', async () => {
    await page.viewport(1440, 900);
    const screen = await renderBoard(<BoardScreen columns={getSampleColumns()} loadDetail={noDetail} />);
    const revalidate = screen.getByRole('heading', { name: 'Revalidate 0' }).element().closest('.column');
    const build = screen.getByRole('heading', { name: 'Build 2' }).element().closest('.column');

    expect(revalidate?.getBoundingClientRect().width).toBeLessThanOrEqual(48);
    expect(build?.getBoundingClientRect().width).toBeGreaterThan(100);
    expect(revalidate?.textContent).toBe('Revalidate 0');
    expect(screen.getByText('Nothing here').elements()).toHaveLength(0);
  });

  it('scrolls only the Board sideways at 900px, snapping to columns, with the strip staying in place', async () => {
    await page.viewport(900, 900);
    const items = [getItem({ key: 'PAY-147', why: 'Sent back · 1 question' })];
    const screen = await renderBoard(<PageWithHeader columns={getSampleColumns()} needsYou={items} loadDetail={noDetail} refresh={async () => undefined} />);
    const board = boardOf(screen);
    const strip = screen.getByRole('navigation', { name: 'Needs you' }).element();
    const stripLeft = strip.getBoundingClientRect().left;
    const forceRefresh = screen.getByRole('button', { name: 'Force refresh' }).element();
    const forceRefreshLeft = forceRefresh.getBoundingClientRect().left;

    expect(board.scrollWidth).toBeGreaterThan(board.clientWidth);
    expect(getComputedStyle(board).scrollSnapType).toBe('x mandatory');
    expect(getComputedStyle(headingsOf(screen)[2]?.closest('.column') ?? board).scrollSnapAlign).toBe('start');

    expect(pageScrollsSideways()).toBe(false);
    board.scrollLeft = 400;
    await expect.poll(() => board.scrollLeft).toBeGreaterThan(0);

    expect(window.scrollX).toBe(0);
    expect(strip.getBoundingClientRect().left).toBe(stripLeft);
    expect(forceRefresh.getBoundingClientRect().left).toBe(forceRefreshLeft);
    expect(forceRefresh.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });

  it('stacks the columns top to bottom in Board column order at 390px', async () => {
    await page.viewport(390, 844);
    const screen = await renderBoard(<BoardScreen columns={getSampleColumns()} loadDetail={noDetail} />);
    const headings = headingsOf(screen);
    const tops = headings.map((heading) => heading.getBoundingClientRect().top);

    expect(headings.map((heading) => heading.firstChild?.textContent?.trim())).toEqual(COLUMN_ORDER);
    expect(tops).toEqual(tops.toSorted((left, right) => left - right));
    expect(new Set(tops).size).toBe(9);
    expect(pageScrollsSideways()).toBe(false);
  });
});

describe('the run detail drawer', () => {
  it('keeps the page where it was when a card opens, another card replaces it, and the drawer closes', async () => {
    await page.viewport(1440, 300);
    const screen = await renderBoard(<AddressedBoard columns={getSampleColumns()} loadDetail={noDetail} />);
    const positions = () => headingsOf(screen).map((heading) => heading.getBoundingClientRect().top);
    window.scrollTo(0, 100);
    await expect.poll(() => window.scrollY).toBe(100);
    const before = positions();

    screen.getByRole('button', { name: /Open ENG-81/ }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).toBeVisible();
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'ENG-81', column: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.scrollY).toBe(100);
    expect(positions()).toEqual(before);

    screen.getByRole('button', { name: /Open ENG-80/ }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'ENG-80', column: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.scrollY).toBe(100);
  });

  it.each([
    ['the close button', async (screen: Awaited<ReturnType<typeof renderBoard>>) => screen.getByRole('button', { name: 'Close run detail' }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }))],
    ['Escape', async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['the browser back button', async (screen: Awaited<ReturnType<typeof renderBoard>>) => screen.router.history.back()],
  ])('keeps the page where the person scrolled it while the drawer was open, when closing with %s', async (_, closeWith) => {
    await page.viewport(1440, 300);
    const screen = await renderBoard(<AddressedBoard columns={getSampleColumns()} loadDetail={noDetail} />, { entries: ['/needs-you', '/'] });
    const click = (key: string) => screen.getByRole('button', { name: new RegExp(`Open ${key}`) }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    click('PIE-21');
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'PIE-21', column: 'available' });
    window.scrollTo(0, 150);
    await expect.poll(() => window.scrollY).toBe(150);
    click('ENG-81');
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'ENG-81', column: 'done' });
    await new Promise((resolve) => setTimeout(resolve, 200));

    await closeWith(screen);
    await expect.poll(() => screen.router.state.location.search).toEqual({});
    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(window.scrollY).toBe(150);
  });

  it('keeps the Board where the person scrolled it sideways at 900px, when back closes the drawer', async () => {
    await page.viewport(900, 900);
    const screen = await renderBoard(<AddressedBoard columns={getSampleColumns()} loadDetail={noDetail} />, { entries: ['/needs-you', '/'] });
    const board = boardOf(screen);

    screen.getByRole('button', { name: /Open PIE-21/ }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'PIE-21', column: 'available' });
    board.scrollLeft = 460;
    await expect.poll(() => board.scrollLeft).toBeGreaterThan(200);
    const scrolled = board.scrollLeft;
    await new Promise((resolve) => setTimeout(resolve, 100));

    screen.router.history.back();
    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(board.scrollLeft).toBe(scrolled);
  });

  it('returns focus to the card that opened the drawer, scrolling only when the person scrolled it out of view', async () => {
    await page.viewport(1440, 400);
    const done = Array.from({ length: 10 }, (_, index) => getCard({ key: `DONE-${index + 1}`, title: `Shipped ${index + 1}` }));
    const screen = await renderBoard(<AddressedBoard columns={getColumns({ build: [getCard()], done })} loadDetail={noDetail} />);
    const card = (key: string) => screen.getByRole('button', { name: new RegExp(`Open ${key} `) }).element();
    const click = (key: string) => card(key).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const closeButton = () => screen.getByRole('button', { name: 'Close run detail' }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

    click('DONE-1');
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'DONE-1', column: 'done' });
    const visibleAt = Math.round(card('DONE-5').getBoundingClientRect().top + window.scrollY - 100);
    window.scrollTo(0, visibleAt);
    await expect.poll(() => window.scrollY).toBe(visibleAt);
    click('DONE-5');
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'DONE-5', column: 'done' });
    await settle();
    closeButton();
    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).not.toBeInTheDocument();
    await settle();

    expect(document.activeElement).toBe(card('DONE-5'));
    expect(window.scrollY).toBe(visibleAt);

    click('DONE-5');
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'DONE-5', column: 'done' });
    window.scrollTo(0, document.documentElement.scrollHeight);
    await expect.poll(() => card('DONE-5').getBoundingClientRect().bottom).toBeLessThan(0);
    await settle();
    closeButton();
    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).not.toBeInTheDocument();
    await settle();

    const bounds = card('DONE-5').getBoundingClientRect();
    expect(document.activeElement).toBe(card('DONE-5'));
    expect([Math.round(bounds.top) >= 0, Math.round(bounds.bottom) <= window.innerHeight]).toEqual([true, true]);
  });

  it('keeps the page where it was when a drawer opened from the address is closed', async () => {
    await page.viewport(1440, 300);
    const screen = await renderBoard(<AddressedBoard columns={getSampleColumns()} loadDetail={noDetail} />, { entries: ['/?card=ENG-81&column=done'] });
    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).toBeVisible();
    window.scrollTo(0, 100);
    await expect.poll(() => window.scrollY).toBe(100);

    screen.getByRole('button', { name: 'Close run detail' }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.poll(() => screen.router.state.location.search).toEqual({});
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(window.scrollY).toBe(100);
  });

  it('opens on the right, at most 520px wide, without moving the columns, at 1440px', async () => {
    await page.viewport(1440, 900);
    const screen = await renderBoard(<BoardScreen columns={getSampleColumns()} loadDetail={noDetail} />);
    const positions = () => headingsOf(screen).map((heading) => heading.getBoundingClientRect().left);
    const before = positions();

    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    const drawer = screen.getByRole('complementary', { name: 'Run detail' });
    await expect.poll(() => Math.round(drawer.element().getBoundingClientRect().right)).toBe(document.documentElement.clientWidth);

    expect(drawer.element().getBoundingClientRect().width).toBeLessThanOrEqual(520);
    expect(positions()).toEqual(before);
  });

  it('fills the window on a phone, from its top, with the close button at the top', async () => {
    await page.viewport(390, 844);
    const screen = await renderBoard(<AddressedBoard columns={getSampleColumns()} loadDetail={noDetail} />);
    const done = screen.getByRole('button', { name: /Open ENG-81/ });
    done.element().scrollIntoView();
    await expect.poll(() => window.scrollY).toBeGreaterThan(0);
    const scrolled = window.scrollY;

    await done.click();
    const drawer = screen.getByRole('complementary', { name: 'Run detail' });
    await expect.poll(() => drawer.element().getBoundingClientRect().left).toBe(0);
    const bounds = drawer.element().getBoundingClientRect();
    const close = drawer.getByRole('button', { name: 'Close run detail' }).element().getBoundingClientRect();

    expect([bounds.left, bounds.top, Math.round(bounds.width), Math.round(bounds.height)]).toEqual([0, 0, document.documentElement.clientWidth, window.innerHeight]);
    expect(drawer.element().scrollTop).toBe(0);
    expect(close.top).toBeLessThan(60);
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'ENG-81', column: 'done' });
    expect(window.scrollY).toBe(scrolled);

    drawer.getByRole('button', { name: 'Close run detail' }).element().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.element(drawer).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(window.scrollY).toBe(scrolled);
    expect(document.activeElement).toBe(done.element());
  });
});

function PageWithHeader({ refresh, ...props }: ComponentProps<typeof BoardScreen> & { readonly refresh: () => Promise<unknown> }) {
  return (
    <>
      <header className="top">
        <div>
          <h1 className="top__title">Software factory</h1>
        </div>
        <HeaderStatus loadedAt="2026-11-24T10:00:00Z" refreshedAt="2026-11-24T10:00:00Z" running={1} needsYou={2} reload={async () => undefined} refresh={refresh} />
      </header>
      <div className="rule" />
      <AddressedBoard {...props} />
    </>
  );
}

describe('the drawer leaves the header usable', () => {
  const headerOf = () => document.querySelector('header.top')?.getBoundingClientRect();

  it('starts below the header at 1440px, so Force refresh stays visible and clickable', async () => {
    await page.viewport(1440, 900);
    const refresh = vi.fn(async () => undefined);
    const screen = await renderBoard(<PageWithHeader columns={getSampleColumns()} loadDetail={noDetail} refresh={refresh} />);
    window.scrollTo(0, 0);

    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    const drawer = screen.getByRole('complementary', { name: 'Run detail' });
    await expect.element(drawer).toBeVisible();
    const header = headerOf();

    expect(Math.round(drawer.element().getBoundingClientRect().top)).toBeGreaterThanOrEqual(Math.round(header?.bottom ?? Infinity));
    expect(Math.round(drawer.element().getBoundingClientRect().bottom)).toBe(window.innerHeight);
    const status = screen.getByRole('status').element().getBoundingClientRect();
    const forceRefresh = screen.getByRole('button', { name: 'Force refresh' });
    expect(document.elementFromPoint(status.left + status.width / 2, status.top + status.height / 2)?.closest('.top__status')).not.toBeNull();
    const button = forceRefresh.element().getBoundingClientRect();
    expect(document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2)).toBe(forceRefresh.element());

    await forceRefresh.click();

    await expect.poll(() => refresh.mock.calls.length).toBe(1);
    await expect.element(drawer.getByRole('heading', { name: 'Invoice PDF footer' })).toBeVisible();
  });

  it('reaches the top of the window once the page has scrolled past the header', async () => {
    await page.viewport(1440, 400);
    const screen = await renderBoard(<PageWithHeader columns={getSampleColumns()} loadDetail={noDetail} refresh={async () => undefined} />);
    window.scrollTo(0, 0);
    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    const drawer = screen.getByRole('complementary', { name: 'Run detail' }).element();

    window.scrollTo(0, Math.ceil((headerOf()?.bottom ?? 0) + window.scrollY + 20));
    await expect.poll(() => headerOf()?.bottom ?? 0).toBeLessThan(0);

    await expect.poll(() => Math.round(drawer.getBoundingClientRect().top)).toBe(0);
    expect(Math.round(drawer.getBoundingClientRect().bottom)).toBe(window.innerHeight);
  });

  it('still fills the window on a phone', async () => {
    await page.viewport(390, 844);
    const screen = await renderBoard(<PageWithHeader columns={getSampleColumns()} loadDetail={noDetail} refresh={async () => undefined} />);
    window.scrollTo(0, 0);

    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    const drawer = screen.getByRole('complementary', { name: 'Run detail' }).element();

    await expect.poll(() => Math.round(drawer.getBoundingClientRect().top)).toBe(0);
    expect(Math.round(drawer.getBoundingClientRect().height)).toBe(window.innerHeight);
  });
});

describe('a fresh load', () => {
  it.each([
    [390, 844],
    [1440, 300],
  ])('starts at the top with the drawer open at %ipx, even after the Board was scrolled earlier in the session', async (width, height) => {
    await page.viewport(width, height);
    const earlier = await renderBoard(<AddressedBoard columns={getSampleColumns()} loadDetail={noDetail} />);
    window.scrollTo(0, 200);
    await expect.poll(() => window.scrollY).toBe(200);
    earlier.router.navigate({ to: '/needs-you' });
    await expect.element(earlier.getByRole('heading', { name: 'Needs you page' })).toBeVisible();
    await earlier.unmount();
    window.scrollTo(0, 200);

    const screen = await renderBoard(<AddressedBoard columns={getSampleColumns()} loadDetail={noDetail} />, { entries: ['/?card=ENG-81&column=done'] });

    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).toBeVisible();
    await expect.poll(() => window.scrollY).toBe(0);
  });
});
