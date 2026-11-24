import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import type { RunDetail } from '../../../src/view/model.js';
import { BoardScreen, useCardAddress } from './BoardScreen';
import { textOf, getCard, getColumns, getDetail, getItem, renderBoard } from './fixtures';

const noDetail = async () => undefined;

describe('board', () => {
  it('shows the nine columns, in pipeline order, with how many tickets each holds', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [getCard()], ready: [getCard({ key: 'PAY-151' }), getCard({ key: 'ENG-90' })] })} loadDetail={noDetail} />);

    await expect.element(screen.getByRole('heading', { name: 'Ready 2' })).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Build 1' })).toBeVisible();
    for (const name of ['Available 0', 'Refining 0', 'Revalidate 0', 'Review 0', 'Pull request 0', 'Needs you 0', 'Done 0']) {
      await expect.element(screen.getByRole('heading', { name })).toBeVisible();
    }
    expect(screen.getByRole('heading', { level: 2 }).elements().map((heading) => heading.textContent)).toEqual([
      'Available 0',
      'Refining 0',
      'Ready 2',
      'Revalidate 0',
      'Build 1',
      'Review 0',
      'Pull request 0',
      'Needs you 0',
      'Done 0',
    ]);
    expect(screen.getByText('Nothing here').elements()).toHaveLength(0);
  });

  it('shows who claimed a run, its run and attempt, the risk, the time and a chip per gate', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns()} loadDetail={noDetail} />);
    const card = screen.getByRole('button', { name: 'Open PAY-142 Bulk invoice export' });

    expect(textOf(card)).toContain('pierre · run 1 of 3');
    expect(textOf(card)).toContain('Low');
    expect(textOf(card)).toContain('attempt 2/5 · 14m');
    expect(textOf(card)).toContain('Building');
    expect(textOf(screen.getByLabelText('Attempt 2'))).toBe('b build runningg gate not startedv verify not startedr review not started');
  });

  it('shows only the latest attempt as one chip row lettered b, g, v, r, each named with its gate and status', async () => {
    const card = getCard({ attempt: { number: 3, limit: 5 }, rows: [{ number: 3, build: 'pass', gate: 'fail', verify: 'running', review: 'pending' }], earlierAttempts: 2 });
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [card] })} loadDetail={noDetail} />);
    const chips = ['build passed', 'gate failed', 'verify running', 'review not started'].map((name) => screen.getByTitle(name, { exact: true }));

    expect(screen.getByLabelText(/^Attempt /).elements()).toHaveLength(1);
    expect(chips.map((chip) => chip.element().firstChild?.textContent)).toEqual(['b', 'g', 'v', 'r']);
    expect(chips.map((chip) => chip.element().querySelector('.visually-hidden')?.textContent)).toEqual([' build passed', ' gate failed', ' verify running', ' review not started']);
    expect(textOf(screen.getByRole('button', { name: /Open PAY-142/ }))).toContain('+2 earlier attempts');
  });

  it('shows no earlier attempts line on a first attempt', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [getCard({ key: 'ENG-87', attempt: { number: 1, limit: 5 }, rows: [{ number: 1, build: 'running', gate: 'pending', verify: 'pending', review: 'pending' }] })] })} loadDetail={noDetail} />);

    expect(textOf(screen.getByRole('button', { name: /Open ENG-87/ }))).not.toContain('earlier');
  });

  it('shows the provider on a card only when the Board reads from more than one provider', async () => {
    const one = await renderBoard(<BoardScreen columns={getColumns()} providers={1} loadDetail={noDetail} />);
    expect(textOf(one.getByRole('button', { name: /Open PAY-142/ }))).not.toContain('Jira');
    await one.unmount();

    const two = await renderBoard(<BoardScreen columns={getColumns()} providers={2} loadDetail={noDetail} />);
    expect(textOf(two.getByRole('button', { name: /Open PAY-142/ }))).toContain('Jira');
  });

  it('reads the risk badge as Low, Medium or High, named as the predicted risk', async () => {
    const cards = [getCard({ key: 'A-LOW', risk: 'low' }), getCard({ key: 'A-MEDIUM', risk: 'medium' }), getCard({ key: 'A-HIGH', risk: 'high' })];
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: cards })} loadDetail={noDetail} />);

    const badges = ['Low risk (predicted)', 'Medium risk (predicted)', 'High risk (predicted)'].map((name) => screen.getByRole('img', { name }));
    expect(badges.map((badge) => textOf(badge))).toEqual(['Low', 'Medium', 'High']);
  });

  it('shows an unclaimed ticket, earlier attempts, an interruption and an edited record', async () => {
    const { claimant: _claimant, run: _run, attempt: _attempt, seconds: _seconds, risk: _risk, ...bare } = getCard({ key: 'PAY-151', rows: [], note: 'Waiting for a developer' });
    const unclaimed = bare;
    const cards = [
      unclaimed,
      getCard({ key: 'ENG-95', earlierAttempts: 1, interrupted: true, note: 'Interrupted', seconds: 4320 }),
      getCard({ key: 'ENG-96', earlierAttempts: 3, recordEdited: true, seconds: 40 }),
      getCard({ key: 'ENG-97', seconds: 3600, risk: 'high' }),
    ];
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: cards })} loadDetail={noDetail} />);

    expect(textOf(screen.getByRole('button', { name: /Open PAY-151/ }))).toBe('PAY-151Bulk invoice exportUnclaimedWaiting for a developer');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-95/ }))).toContain('+1 earlier attempt');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-95/ }))).toContain('1h 12m');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-96/ }))).toContain('+3 earlier attempts');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-96/ }))).toContain('Record edited outside the factory');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-96/ }))).toContain('40s');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-97/ }))).toContain('1h');
    await expect.element(screen.getByRole('button', { name: /Open ENG-97/ }).getByRole('img', { name: 'High risk (predicted)' })).toHaveTextContent('High');
  });

  it('marks each card by where it stands: not started, running, waiting on a person, failed or done', async () => {
    const columns = getColumns({
      available: [getCard({ key: 'A-AVAILABLE', note: 'Available for refinement' })],
      refining: [getCard({ key: 'A-REFINING', note: 'Refining' })],
      ready: [getCard({ key: 'A-READY' })],
      build: [getCard({ key: 'A-BUILD' }), getCard({ key: 'A-STALLED', interrupted: true })],
      pr: [getCard({ key: 'A-PR' })],
      needs_you: [
        getCard({ key: 'A-REVERT', note: 'Revert this change by hand: main failed at m1.', category: 'revert' }),
        getCard({ key: 'A-BLOCKED', note: 'Failed 5 of 5 attempts. Diagnosis: environment.', category: 'blocked' }),
        getCard({ key: 'A-LIMIT', note: 'Used 3 of 3 runs.', category: 'run_limit' }),
        getCard({ key: 'A-SENT', note: 'Sent back with 1 question.', category: 'sent_back' }),
        getCard({ key: 'A-APPROVE', note: 'The ready gate passed. Waiting for approval.', category: 'approve' }),
      ],
      done: [getCard({ key: 'A-DONE' })],
    });
    const screen = await renderBoard(<BoardScreen columns={columns} loadDetail={noDetail} />);
    const markOf = (key: string): string | undefined => screen.getByRole('button', { name: new RegExp(`Open ${key}`) }).element().querySelector('.dot')?.className;

    expect(['A-AVAILABLE', 'A-REFINING', 'A-READY', 'A-BUILD', 'A-STALLED', 'A-PR', 'A-REVERT', 'A-BLOCKED', 'A-LIMIT', 'A-SENT', 'A-APPROVE', 'A-DONE'].map(markOf)).toEqual([
      'dot dot--pending',
      'dot dot--running',
      'dot dot--pending',
      'dot dot--running',
      'dot dot--waiting',
      'dot dot--waiting',
      'dot dot--fail',
      'dot dot--fail',
      'dot dot--fail',
      'dot dot--waiting',
      'dot dot--waiting',
      'dot dot--pass',
    ]);
  });

  it('shows how many tasks a pull request leaves open, and the accept command on its Needs you card', async () => {
    const pullRequest = 'https://github.test/pull/30';
    const inPr = getCard({ key: 'PIE-63', note: '2 of 9 tasks open · Merge by a person', pullRequest });
    const needsYou = getCard({ key: 'PIE-63', note: '2 of 9 tasks open. Tick them in a push, or accept them as open.', command: 'factory accept-tasks PIE-63', category: 'open_tasks', pullRequest });
    const screen = await renderBoard(<BoardScreen columns={getColumns({ pr: [inPr], needs_you: [needsYou] })} loadDetail={async () => getDetail()} />);
    const cards = screen.getByRole('button', { name: /Open PIE-63/ });

    expect(textOf(cards.nth(0))).toContain('2 of 9 tasks open · Merge by a person');
    expect(cards.nth(1).element().querySelector('.dot')?.className).toBe('dot dot--waiting');

    await cards.nth(1).click();

    const panel = screen.getByRole('complementary', { name: 'Run detail' });
    await expect.element(panel.getByText('factory accept-tasks PIE-63')).toBeVisible();
    await expect.element(panel.getByRole('link', { name: 'Open pull request' })).toHaveAttribute('href', pullRequest);
  });

  it('lists the open tasks of a run in its detail, with their notes and who accepted them', async () => {
    const tasks: RunDetail['sections'][number] = {
      title: 'Tasks: 7 of 9 done',
      steps: [
        { label: '4.1 Open the board against live Linear', status: 'pass', statusName: 'accepted open', lines: ['Not done: the board was not opened against live Linear', 'Accepted by Pierre on 2026-11-24'], links: [] },
        { label: '4.2 Record a demo', status: 'fail', statusName: 'open', lines: [], links: [] },
      ],
    };
    const screen = await renderBoard(<BoardScreen columns={getColumns({ pr: [getCard({ key: 'PIE-68' })] })} loadDetail={async () => getDetail({ sections: [tasks] })} />);

    await screen.getByRole('button', { name: /Open PIE-68/ }).click();

    const panel = screen.getByRole('complementary', { name: 'Run detail' });
    await expect.element(panel.getByRole('heading', { name: 'Tasks: 7 of 9 done' })).toBeVisible();
    expect(textOf(panel.getByRole('listitem').nth(0))).toBe('4.1 Open the board against live Linearaccepted openNot done: the board was not opened against live LinearAccepted by Pierre on 2026-11-24');
    expect(textOf(panel.getByRole('listitem').nth(1))).toBe('4.2 Record a demoopen');
  });

  it('opens the card that was clicked when a ticket shows in its station and in Needs you', async () => {
    const station = getCard({ key: 'PAY-170', note: 'Waiting for a developer', command: '/factory-run PAY-170' });
    const needsYou = getCard({ key: 'PAY-170', note: 'Used 3 of 3 runs.', command: '/factory-run PAY-170 --over-limit', category: 'run_limit' });
    const screen = await renderBoard(<BoardScreen columns={getColumns({ ready: [station], needs_you: [needsYou] })} loadDetail={async () => getDetail()} />);
    const [inReady, inNeedsYou] = screen.getByRole('button', { name: /Open PAY-170/ }).all();

    await inNeedsYou?.click();

    await expect.element(screen.getByRole('complementary').getByText('/factory-run PAY-170 --over-limit')).toBeVisible();
    expect([inReady?.element().getAttribute('aria-pressed'), inNeedsYou?.element().getAttribute('aria-pressed')]).toEqual(['false', 'true']);

    await inReady?.click();

    await expect.element(screen.getByRole('complementary').getByText('/factory-run PAY-170', { exact: true })).toBeVisible();
    expect([inReady?.element().getAttribute('aria-pressed'), inNeedsYou?.element().getAttribute('aria-pressed')]).toEqual(['true', 'false']);
  });

  it('keeps the run detail open when a refresh moves the ticket to another column', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns({ ready: [getCard({ note: 'Waiting for a developer' })] })} loadDetail={async () => getDetail()} />);
    await screen.getByRole('button', { name: /Open PAY-142/ }).click();

    await screen.rerender(<BoardScreen columns={getColumns({ build: [getCard({ note: 'Building' })] })} loadDetail={async () => getDetail()} />);

    await expect.element(screen.getByRole('complementary', { name: 'Run detail' }).getByText('Building')).toBeVisible();
  });

  it('tells the person to select the text when the browser refuses the clipboard', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns({ ready: [getCard({ command: '/factory-run PAY-142' })] })} loadDetail={noDetail} />);
    await screen.getByRole('button', { name: /Open PAY-142/ }).click();

    await screen.getByRole('button', { name: 'Copy command' }).click();

    await expect.element(screen.getByRole('button', { name: 'Copy failed: select the text' })).toBeVisible();
    await expect.element(screen.getByText('/factory-run PAY-142')).toBeVisible();
  });

  it('opens the run detail of the card that is selected, and closes it again', async () => {
    const loadDetail = vi.fn(async () => getDetail());
    const screen = await renderBoard(<BoardScreen columns={getColumns()} loadDetail={loadDetail} />);

    await screen.getByRole('button', { name: /Open PAY-142/ }).click();

    const panel = screen.getByRole('complementary', { name: 'Run detail' });
    await expect.element(panel.getByRole('heading', { name: 'Bulk invoice export' })).toBeVisible();
    await expect.element(panel.getByRole('heading', { name: 'Attempt 1 of 5' })).toBeVisible();
    await expect.element(panel.getByText('export.test.ts › splits files: expected 2, got 1')).toBeVisible();
    await expect.element(panel.getByText('This run is on your machine, in Orca.')).toBeVisible();
    await expect.element(panel.getByRole('link', { name: 'https://ci.test/evidence/1' })).toBeVisible();
    await expect.element(panel.getByText('shots/settings.png')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: /Open PAY-142/ })).toHaveAttribute('aria-pressed', 'true');
    expect(loadDetail).toHaveBeenCalledWith('PAY-142');

    await panel.getByRole('button', { name: 'Close run detail' }).click();

    await expect.element(panel).not.toBeInTheDocument();
  });

  it('opens a run on this machine in Orca, and says why when Orca cannot', async () => {
    const openInOrca = vi.fn(async (key: string) => (key === 'PAY-142' ? { ok: true as const } : { ok: false as const, message: 'Orca could not open the run: Orca is not running' }));
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [getCard(), getCard({ key: 'ENG-95' })] })} loadDetail={async () => getDetail()} openInOrca={openInOrca} />);

    await screen.getByRole('button', { name: /Open PAY-142/ }).click();
    await screen.getByRole('button', { name: 'Open in Orca' }).click();

    await expect.element(screen.getByText('Opened in Orca.')).toBeVisible();
    expect(openInOrca).toHaveBeenCalledWith('PAY-142');

    await screen.getByRole('button', { name: /Open ENG-95/ }).click();
    await expect.element(screen.getByText('Opened in Orca.')).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Open in Orca' }).click();

    await expect.element(screen.getByText('Orca could not open the run: Orca is not running')).toBeVisible();
  });

  it('says a run on another machine is in that developer\'s Orca, and offers the command and the pull request', async () => {
    const card = getCard({ onThisMachine: false, claimant: 'maya', command: '/factory-run PAY-142', pullRequest: 'https://github.test/pull/412' });
    const copy = vi.fn(async () => undefined);
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [card] })} loadDetail={async () => getDetail()} copy={copy} />);

    await screen.getByRole('button', { name: /Open PAY-142/ }).click();
    await screen.getByRole('button', { name: 'Copy command' }).click();

    await expect.element(screen.getByText("This run is in maya's Orca.")).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Open pull request' })).toHaveAttribute('href', 'https://github.test/pull/412');
    await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(copy).toHaveBeenCalledWith('/factory-run PAY-142');
    expect(screen.getByRole('button', { name: 'Open in Orca' }).elements()).toHaveLength(0);
  });

  it('offers Start in Orca next to the command of a card that is not running on this machine', async () => {
    const { claimant: _claimant, ...available } = getCard({ key: 'PIE-21', onThisMachine: false, rows: [], command: '/factory-refine PIE-21' });
    const startInOrca = vi.fn(async () => ({ ok: true as const, worktree: 'pie-21' }));
    const screen = await renderBoard(<BoardScreen columns={getColumns({ available: [available] })} loadDetail={noDetail} openInOrca={vi.fn()} startInOrca={startInOrca} />);

    await screen.getByRole('button', { name: /Open PIE-21/ }).click();

    await expect.element(screen.getByText('/factory-refine PIE-21')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Copy command' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Start in Orca' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open in Orca' }).elements()).toHaveLength(0);
  });

  it('offers Start in Orca, and not Open in Orca, on an interrupted run claimed on another machine', async () => {
    const card = getCard({ key: 'PIE-12', onThisMachine: false, claimant: 'maya', interrupted: true, command: '/factory-run PIE-12' });
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [card] })} loadDetail={noDetail} openInOrca={vi.fn()} startInOrca={vi.fn()} />);

    await screen.getByRole('button', { name: /Open PIE-12/ }).click();

    await expect.element(screen.getByRole('button', { name: 'Start in Orca' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open in Orca' }).elements()).toHaveLength(0);
  });

  it('keeps Open in Orca, and offers no Start in Orca, on a run on this machine', async () => {
    const card = getCard({ key: 'PIE-12', onThisMachine: true, interrupted: true, command: '/factory-run PIE-12' });
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [card] })} loadDetail={noDetail} openInOrca={vi.fn()} startInOrca={vi.fn()} />);

    await screen.getByRole('button', { name: /Open PIE-12/ }).click();

    await expect.element(screen.getByRole('button', { name: 'Open in Orca' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Copy command' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start in Orca' }).elements()).toHaveLength(0);
  });

  it('offers no Start in Orca on a card with no command', async () => {
    const card = getCard({ onThisMachine: false, claimant: 'maya' });
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [card] })} loadDetail={noDetail} openInOrca={vi.fn()} startInOrca={vi.fn()} />);

    await screen.getByRole('button', { name: /Open PAY-142/ }).click();

    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start in Orca' }).elements()).toHaveLength(0);
  });

  it('starts a card\'s command in Orca from the detail panel', async () => {
    const card = getCard({ key: 'PIE-30', onThisMachine: false, rows: [], command: '/factory-next' });
    const startInOrca = vi.fn(async () => ({ ok: true as const, worktree: 'pie-30' }));
    const screen = await renderBoard(<BoardScreen columns={getColumns({ ready: [card] })} loadDetail={noDetail} startInOrca={startInOrca} />);

    await screen.getByRole('button', { name: /Open PIE-30/ }).click();
    await screen.getByRole('button', { name: 'Start in Orca' }).click();

    await expect.element(screen.getByText('Started in Orca: pie-30')).toBeVisible();
    await expect.element(screen.getByText('/factory-next')).toBeVisible();
    expect(startInOrca).toHaveBeenCalledWith({ key: 'PIE-30', command: '/factory-next' });
  });

  it('says so when the ticket has no factory record, or the record holds nothing for a section', async () => {
    const { claimant: _claimant, ...unclaimed } = getCard({ rows: [] });
    const empty = await renderBoard(<BoardScreen columns={getColumns({ ready: [unclaimed] })} loadDetail={noDetail} />);
    await empty.getByRole('button', { name: /Open PAY-142/ }).click();
    await expect.element(empty.getByText('This ticket has no factory record yet.')).toBeVisible();
    expect(empty.getByText(/This run is/).elements()).toHaveLength(0);
    await empty.unmount();

    const bare = await renderBoard(<BoardScreen columns={getColumns()} loadDetail={async () => getDetail({ sections: [{ title: 'Refinement', steps: [] }] })} />);
    await bare.getByRole('button', { name: /Open PAY-142/ }).click();
    await expect.element(bare.getByText('Nothing recorded.')).toBeVisible();
  });

  it('shows that the run is loading until its detail arrives, and keeps the latest selection', async () => {
    const pending: { resolve?: (detail: ReturnType<typeof getDetail>) => void } = {};
    const loadDetail = (key: string) =>
      key === 'PAY-142' ? new Promise<ReturnType<typeof getDetail>>((resolve) => void (pending.resolve = resolve)) : Promise.resolve(getDetail({ key: 'ENG-87', sections: [{ title: 'Run 1 of 3', steps: [] }] }));
    const columns = getColumns({ build: [getCard(), getCard({ key: 'ENG-87', title: 'Webhook retry policy' })] });
    const screen = await renderBoard(<BoardScreen columns={columns} loadDetail={loadDetail} />);

    await screen.getByRole('button', { name: /Open PAY-142/ }).click();
    await expect.element(screen.getByText('Loading the run…')).toBeVisible();
    await screen.getByRole('button', { name: /Open ENG-87/ }).click();
    await expect.element(screen.getByRole('heading', { name: 'Run 1 of 3' })).toBeVisible();
    pending.resolve?.(getDetail());
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect.element(screen.getByRole('heading', { name: 'Run 1 of 3' })).toBeVisible();
    expect(screen.getByText('Loading the run…').elements()).toHaveLength(0);
    await expect.element(screen.getByRole('complementary').getByRole('heading', { name: 'Webhook retry policy' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Attempt 1 of 5' }).elements()).toHaveLength(0);
  });

  it('shows another card in the open drawer when the person activates it', async () => {
    const columns = getColumns({ build: [getCard({ key: 'PAY-147', title: 'Invoice PDF footer' }), getCard({ key: 'PAY-151', title: 'Refund export' })] });
    const screen = await renderBoard(<BoardScreen columns={columns} loadDetail={noDetail} />);

    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    await screen.getByRole('button', { name: /Open PAY-151/ }).click();

    await expect.element(screen.getByRole('complementary', { name: 'Run detail' }).getByRole('heading', { name: 'Refund export' })).toBeVisible();
  });

  it('moves focus into the drawer on open, and back to the card on Escape or the close button', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns()} loadDetail={noDetail} />);
    const card = screen.getByRole('button', { name: /Open PAY-142/ });
    const drawer = screen.getByRole('complementary', { name: 'Run detail' });

    await card.click();
    await expect.poll(() => drawer.element().contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');

    await expect.element(drawer).not.toBeInTheDocument();
    await expect.element(card).toHaveFocus();

    await card.click();
    await drawer.getByRole('button', { name: 'Close run detail' }).click();

    await expect.element(drawer).not.toBeInTheDocument();
    await expect.element(card).toHaveFocus();
  });

  it('closes the drawer when a refresh no longer returns its ticket', async () => {
    const screen = await renderBoard(<BoardScreen columns={getColumns({ build: [getCard({ key: 'PIE-12' })] })} loadDetail={noDetail} />);
    await screen.getByRole('button', { name: /Open PIE-12/ }).click();
    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).toBeVisible();

    await screen.rerender(<BoardScreen columns={getColumns({ build: [getCard({ key: 'ENG-95' })] })} loadDetail={noDetail} />);

    await expect.element(screen.getByRole('complementary', { name: 'Run detail' })).not.toBeInTheDocument();
  });
});

function AddressedBoard(props: ComponentProps<typeof BoardScreen>) {
  return <BoardScreen {...props} address={useCardAddress()} />;
}

describe('the open card in the address', () => {
  const columns = getColumns({ build: [getCard({ key: 'PAY-147', title: 'Invoice PDF footer' }), getCard({ key: 'PAY-151', title: 'Refund export' })] });
  const drawerOf = (screen: Awaited<ReturnType<typeof renderBoard>>) => screen.getByRole('complementary', { name: 'Run detail' });

  it('adds the card on open, replaces it when switching cards, and closes the drawer on back', async () => {
    const screen = await renderBoard(<AddressedBoard columns={columns} loadDetail={noDetail} />, { entries: ['/needs-you', '/'] });

    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'PAY-147', column: 'build' });
    await screen.getByRole('button', { name: /Open PAY-151/ }).click();
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'PAY-151', column: 'build' });

    screen.router.history.back();

    await expect.element(drawerOf(screen)).not.toBeInTheDocument();
    await expect.element(screen.getByRole('heading', { name: 'Build 2' })).toBeVisible();
    expect(screen.router.state.location.search).toEqual({});

    screen.router.history.back();
    await expect.element(screen.getByRole('heading', { name: 'Needs you page' })).toBeVisible();
  });

  it('removes the card when the drawer is closed, so back does not reopen it', async () => {
    const screen = await renderBoard(<AddressedBoard columns={columns} loadDetail={noDetail} />, { entries: ['/needs-you', '/'] });

    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    await expect.element(drawerOf(screen)).toBeVisible();
    await userEvent.keyboard('{Escape}');

    await expect.element(drawerOf(screen)).not.toBeInTheDocument();
    await expect.poll(() => screen.router.state.location.search).toEqual({});

    screen.router.history.back();
    await expect.element(screen.getByRole('heading', { name: 'Needs you page' })).toBeVisible();
  });

  it('opens the card named in the address when the Board loads, and removes it on close', async () => {
    const screen = await renderBoard(<AddressedBoard columns={columns} loadDetail={noDetail} />, { entries: ['/needs-you', '/?card=PAY-147&column=build'] });

    await expect.element(drawerOf(screen).getByRole('heading', { name: 'Invoice PDF footer' })).toBeVisible();
    await drawerOf(screen).getByRole('button', { name: 'Close run detail' }).click();

    await expect.element(drawerOf(screen)).not.toBeInTheDocument();
    expect(screen.router.state.location.search).toEqual({});
    screen.router.history.back();
    await expect.element(screen.getByRole('heading', { name: 'Needs you page' })).toBeVisible();
  });

  it('removes the card from the address when a refresh no longer returns it, so it does not reopen when it comes back', async () => {
    const screen = await renderBoard(<AddressedBoard columns={columns} loadDetail={noDetail} />, { entries: ['/'] });
    await screen.getByRole('button', { name: /Open PAY-147/ }).click();
    await expect.element(drawerOf(screen)).toBeVisible();

    await screen.rerender(<AddressedBoard columns={getColumns({ build: [getCard({ key: 'PAY-151', title: 'Refund export' })] })} loadDetail={noDetail} />);

    await expect.element(drawerOf(screen)).not.toBeInTheDocument();
    await expect.poll(() => screen.router.state.location.search).toEqual({});

    await screen.rerender(<AddressedBoard columns={columns} loadDetail={noDetail} />);
    await expect.element(screen.getByRole('button', { name: /Open PAY-147/ })).toBeVisible();
    expect(drawerOf(screen).elements()).toHaveLength(0);
  });

  it('shows the Board with no drawer and no error when the card in the address is not on the Board', async () => {
    const loadDetail = vi.fn(noDetail);
    const screen = await renderBoard(<AddressedBoard columns={columns} loadDetail={loadDetail} />, { entries: ['/?card=PIE-99&column=build'] });

    await expect.element(screen.getByRole('heading', { name: 'Build 2' })).toBeVisible();
    expect(drawerOf(screen).elements()).toHaveLength(0);
    expect(screen.getByRole('alert').elements()).toHaveLength(0);
    expect(loadDetail).not.toHaveBeenCalled();
  });
});

describe('the column in the address', () => {
  const station = getCard({ key: 'PAY-155', title: 'Late fee reminder', note: 'Waiting for a developer', command: '/factory-run PAY-155' });
  const needsYouCard = getCard({ key: 'PAY-155', title: 'Late fee reminder', note: 'The ready gate passed. Waiting for approval.', command: 'factory approve PAY-155', category: 'approve' });
  const shownTwice = getColumns({ ready: [station], needs_you: [needsYouCard], build: [getCard({ key: 'PAY-147', title: 'Invoice PDF footer', note: 'Building attempt 2' })] });
  const items = [getItem({ key: 'PAY-155', why: 'Waiting for approval' })];
  const drawerOf = (screen: Awaited<ReturnType<typeof renderBoard>>) => screen.getByRole('complementary', { name: 'Run detail' });

  it('names the Needs you column when a ticket shown twice is opened from the strip, and reopens that card on reload', async () => {
    await page.viewport(1440, 900);
    const screen = await renderBoard(<AddressedBoard columns={shownTwice} needsYou={items} loadDetail={noDetail} />);

    await screen.getByRole('navigation', { name: 'Needs you' }).getByRole('button', { name: /PAY-155/ }).click();
    await expect.poll(() => screen.router.state.location.search).toEqual({ card: 'PAY-155', column: 'needs_you' });
    await screen.unmount();

    const reloaded = await renderBoard(<AddressedBoard columns={shownTwice} needsYou={items} loadDetail={noDetail} />, { entries: ['/?card=PAY-155&column=needs_you'] });

    await expect.element(drawerOf(reloaded).getByText('The ready gate passed. Waiting for approval.')).toBeVisible();
    await expect.element(drawerOf(reloaded).getByText('factory approve PAY-155')).toBeVisible();
  });

  it('opens the station card when the address names its station', async () => {
    const screen = await renderBoard(<AddressedBoard columns={shownTwice} loadDetail={noDetail} />, { entries: ['/?card=PAY-155&column=ready'] });

    await expect.element(drawerOf(screen).getByText('Waiting for a developer')).toBeVisible();
  });

  it.each([['/?card=PAY-155'], ['/?card=PAY-155&column=build'], ['/?card=PAY-155&column=nowhere']])('opens the Needs you card of a ticket shown twice when the column is missing, stale or unknown (%s)', async (entry) => {
    const screen = await renderBoard(<AddressedBoard columns={shownTwice} loadDetail={noDetail} />, { entries: [entry] });

    await expect.element(drawerOf(screen).getByText('The ready gate passed. Waiting for approval.')).toBeVisible();
  });

  it('opens the station card when the ticket has left Needs you', async () => {
    const screen = await renderBoard(<AddressedBoard columns={shownTwice} loadDetail={noDetail} />, { entries: ['/?card=PAY-147&column=needs_you'] });

    await expect.element(drawerOf(screen).getByText('Building attempt 2')).toBeVisible();
  });
});
