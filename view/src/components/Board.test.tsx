import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { BoardScreen } from './BoardScreen';
import { textOf, getCard, getColumns, getDetail } from './fixtures';

const noDetail = async () => undefined;

describe('board', () => {
  it('shows the nine columns, in pipeline order, with how many tickets each holds', async () => {
    const screen = await render(<BoardScreen columns={getColumns({ build: [getCard()], ready: [getCard({ key: 'PAY-151' }), getCard({ key: 'ENG-90' })] })} loadDetail={noDetail} />);

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
    expect(screen.getByText('Nothing here').elements()).toHaveLength(7);
  });

  it('shows who claimed a run, its run and attempt, the risk, the time and a chip per gate', async () => {
    const screen = await render(<BoardScreen columns={getColumns()} loadDetail={noDetail} />);
    const card = screen.getByRole('button', { name: 'Open PAY-142 Bulk invoice export' });

    expect(textOf(card)).toContain('pierre · run 1 of 3');
    expect(textOf(card)).toContain('Low risk (predicted)');
    expect(textOf(card)).toContain('attempt 2/5 · 14m');
    expect(textOf(card)).toContain('Building');
    expect(textOf(screen.getByLabelText('Attempt 1'))).toContain('A1build passedgate failedverify not startedreview not started');
    expect(textOf(screen.getByLabelText('Attempt 2'))).toContain('A2build runninggate not startedverify not startedreview not started');
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
    const screen = await render(<BoardScreen columns={getColumns({ build: cards })} loadDetail={noDetail} />);

    expect(textOf(screen.getByRole('button', { name: /Open PAY-151/ }))).toBe('PAY-151JiraBulk invoice exportUnclaimedWaiting for a developer');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-95/ }))).toContain('+1 earlier attempt');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-95/ }))).toContain('1h 12m');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-96/ }))).toContain('+3 earlier attempts');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-96/ }))).toContain('Record edited outside the factory');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-96/ }))).toContain('40s');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-97/ }))).toContain('1h');
    expect(textOf(screen.getByRole('button', { name: /Open ENG-97/ }))).toContain('High risk (predicted)');
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
    const screen = await render(<BoardScreen columns={columns} loadDetail={noDetail} />);
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

  it('opens the card that was clicked when a ticket shows in its station and in Needs you', async () => {
    const station = getCard({ key: 'PAY-170', note: 'Waiting for a developer', command: '/factory-run PAY-170' });
    const needsYou = getCard({ key: 'PAY-170', note: 'Used 3 of 3 runs.', command: '/factory-run PAY-170 --over-limit', category: 'run_limit' });
    const screen = await render(<BoardScreen columns={getColumns({ ready: [station], needs_you: [needsYou] })} loadDetail={async () => getDetail()} />);
    const [inReady, inNeedsYou] = screen.getByRole('button', { name: /Open PAY-170/ }).all();

    await inNeedsYou?.click();

    await expect.element(screen.getByRole('complementary').getByText('/factory-run PAY-170 --over-limit')).toBeVisible();
    expect([inReady?.element().getAttribute('aria-pressed'), inNeedsYou?.element().getAttribute('aria-pressed')]).toEqual(['false', 'true']);

    await inReady?.click();

    await expect.element(screen.getByRole('complementary').getByText('/factory-run PAY-170', { exact: true })).toBeVisible();
    expect([inReady?.element().getAttribute('aria-pressed'), inNeedsYou?.element().getAttribute('aria-pressed')]).toEqual(['true', 'false']);
  });

  it('keeps the run detail open when a refresh moves the ticket to another column', async () => {
    const screen = await render(<BoardScreen columns={getColumns({ ready: [getCard({ note: 'Waiting for a developer' })] })} loadDetail={async () => getDetail()} />);
    await screen.getByRole('button', { name: /Open PAY-142/ }).click();

    await screen.rerender(<BoardScreen columns={getColumns({ build: [getCard({ note: 'Building' })] })} loadDetail={async () => getDetail()} />);

    await expect.element(screen.getByRole('complementary', { name: 'Run detail' }).getByText('Building')).toBeVisible();
  });

  it('tells the person to select the text when the browser refuses the clipboard', async () => {
    const screen = await render(<BoardScreen columns={getColumns({ ready: [getCard({ command: '/factory-run PAY-142' })] })} loadDetail={noDetail} />);
    await screen.getByRole('button', { name: /Open PAY-142/ }).click();

    await screen.getByRole('button', { name: 'Copy command' }).click();

    await expect.element(screen.getByRole('button', { name: 'Copy failed: select the text' })).toBeVisible();
    await expect.element(screen.getByText('/factory-run PAY-142')).toBeVisible();
  });

  it('opens the run detail of the card that is selected, and closes it again', async () => {
    const loadDetail = vi.fn(async () => getDetail());
    const screen = await render(<BoardScreen columns={getColumns()} loadDetail={loadDetail} />);

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
    const screen = await render(<BoardScreen columns={getColumns({ build: [getCard(), getCard({ key: 'ENG-95' })] })} loadDetail={async () => getDetail()} openInOrca={openInOrca} />);

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
    const screen = await render(<BoardScreen columns={getColumns({ build: [card] })} loadDetail={async () => getDetail()} copy={copy} />);

    await screen.getByRole('button', { name: /Open PAY-142/ }).click();
    await screen.getByRole('button', { name: 'Copy command' }).click();

    await expect.element(screen.getByText("This run is in maya's Orca.")).toBeVisible();
    await expect.element(screen.getByRole('link', { name: 'Open pull request' })).toHaveAttribute('href', 'https://github.test/pull/412');
    await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(copy).toHaveBeenCalledWith('/factory-run PAY-142');
    expect(screen.getByRole('button', { name: 'Open in Orca' }).elements()).toHaveLength(0);
  });

  it('says so when the ticket has no factory record, or the record holds nothing for a section', async () => {
    const { claimant: _claimant, ...unclaimed } = getCard({ rows: [] });
    const empty = await render(<BoardScreen columns={getColumns({ ready: [unclaimed] })} loadDetail={noDetail} />);
    await empty.getByRole('button', { name: /Open PAY-142/ }).click();
    await expect.element(empty.getByText('This ticket has no factory record yet.')).toBeVisible();
    expect(empty.getByText(/This run is/).elements()).toHaveLength(0);
    await empty.unmount();

    const bare = await render(<BoardScreen columns={getColumns()} loadDetail={async () => getDetail({ sections: [{ title: 'Refinement', steps: [] }] })} />);
    await bare.getByRole('button', { name: /Open PAY-142/ }).click();
    await expect.element(bare.getByText('Nothing recorded.')).toBeVisible();
  });

  it('shows that the run is loading until its detail arrives, and keeps the latest selection', async () => {
    const pending: { resolve?: (detail: ReturnType<typeof getDetail>) => void } = {};
    const loadDetail = (key: string) =>
      key === 'PAY-142' ? new Promise<ReturnType<typeof getDetail>>((resolve) => void (pending.resolve = resolve)) : Promise.resolve(getDetail({ key: 'ENG-87', sections: [{ title: 'Run 1 of 3', steps: [] }] }));
    const columns = getColumns({ build: [getCard(), getCard({ key: 'ENG-87', title: 'Webhook retry policy' })] });
    const screen = await render(<BoardScreen columns={columns} loadDetail={loadDetail} />);

    await screen.getByRole('button', { name: /Open PAY-142/ }).click();
    await expect.element(screen.getByText('Loading the run…')).toBeVisible();
    await screen.getByRole('button', { name: /Open ENG-87/ }).click();
    pending.resolve?.(getDetail());

    await expect.element(screen.getByRole('heading', { name: 'Run 1 of 3' })).toBeVisible();
    await expect.element(screen.getByRole('complementary').getByRole('heading', { name: 'Webhook retry policy' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Attempt 1 of 5' }).elements()).toHaveLength(0);
  });
});
