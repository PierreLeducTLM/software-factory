import { describe, expect, it } from 'vitest';
import type { TicketProvider } from '../src/adapters/ticket-provider.js';
import { acceptTasks, checkTasks } from '../src/factory/merge.js';
import { PASS, getWorld, reachReview, type World } from './fakes/loop-world.js';

const PATH = 'openspec/changes/archive/2026-11-21-billing-export/tasks.md';
const DONE = ['1.1 Add the field', '1.2 Add the parser', '2.1 Record the tasks', '2.2 List them in the body', '3.1 Post the status', '3.2 Check on every push', '3.3 Accept tasks'];
const FIRST = '4.1 Run the end-to-end check';
const SECOND = '4.2 Open the board against live Linear';

type Line = { readonly text: string; readonly ticked: boolean; readonly note?: string };

const tasksFile = (lines: readonly Line[]): string =>
  ['# Tasks', '', ...lines.flatMap(({ text, ticked, note }) => [`- [${ticked ? 'x' : ' '}] ${text}`, ...(note === undefined ? [] : [`  - ${note}`])]), ''].join('\n');

const withOpen = (open: readonly string[], extra: readonly Line[] = []): string =>
  tasksFile([
    ...DONE.map((text) => ({ text, ticked: true })),
    { text: FIRST, ticked: !open.includes(FIRST), note: 'Not done: needs the released engine.' },
    { text: SECOND, ticked: !open.includes(SECOND) },
    ...extra,
  ]);

const getDelivered = async (tasks = withOpen([FIRST, SECOND])) => {
  const world = await getWorld({ branchTasks: tasks });
  await reachReview(world);
  await world.step({ verdicts: { reviewer: PASS } });
  world.git.putFile('commit-1', PATH, tasks);
  return world;
};

const push = (world: World, commit: string, tasks?: string): void => {
  if (tasks !== undefined) world.git.putFile(commit, PATH, tasks);
  world.git.push('factory/pay-142', commit);
};

const bodyOf = async (world: World, number = 401): Promise<string> => (await world.sourceControl.getPullRequest(number))?.body ?? '';

const called = (name: string) => async (): Promise<never> => {
  throw new Error(`the ticket provider was called: ${name}`);
};

const unreachable = (): TicketProvider => ({
  getTicket: called('getTicket'),
  transition: called('transition'),
  getFactoryComment: called('getFactoryComment'),
  putFactoryComment: called('putFactoryComment'),
  addAttachment: called('addAttachment'),
  listAttachments: called('listAttachments'),
  readAttachment: called('readAttachment'),
  search: called('search'),
  listStatuses: called('listStatuses'),
  checkAccess: called('checkAccess'),
  canReenter: called('canReenter'),
});

describe('checking the tasks of a pull request in CI', () => {
  it('passes once a push ticks the last open tasks, and records that no task is open (a push ticks the last open tasks)', async () => {
    const world = await getDelivered();
    push(world, 'commit-2', withOpen([]));

    const result = await checkTasks(world.deps, { pullRequest: 401 });

    expect(result).toEqual({ ok: true, action: 'checked', key: 'PAY-142', state: 'success', description: 'All 9 tasks done', saved: true });
    expect(world.git.statusesOf('commit-2')).toEqual([{ context: 'factory/tasks', state: 'success', description: 'All 9 tasks done', link: 'memory://pull/401', commit: 'commit-2' }]);
    expect((await world.record()).runs[0]?.tasks).toEqual({ total: 9, path: PATH, commit: 'commit-2', open: [], accepted: [] });
    expect(await bodyOf(world)).not.toContain('## Open tasks');
  });

  it('rewrites only the Open tasks section of the body (the body follows the ticks)', async () => {
    const world = await getDelivered();
    const before = await bodyOf(world);
    push(world, 'commit-2', withOpen([SECOND]));

    await checkTasks(world.deps, { pullRequest: 401 });

    const after = await bodyOf(world);
    expect(after).toContain(`## Open tasks\n- ${SECOND}\n\n## Decisions applied`);
    expect(after).not.toContain(FIRST);
    expect(after.replace(`## Open tasks\n- ${SECOND}\n\n`, '')).toBe(before.replace(/## Open tasks\n[\s\S]*?\n\n(?=## Decisions applied)/, ''));
  });

  it('posts the same status on the new head and saves nothing when the tasks did not change (a push that leaves the tasks unchanged)', async () => {
    const world = await getDelivered();
    const comment = await world.tickets.getFactoryComment('PAY-142');
    push(world, 'commit-2', withOpen([FIRST, SECOND]));

    const result = await checkTasks(world.deps, { pullRequest: 401 });

    expect(result).toMatchObject({ ok: true, state: 'failure', description: '2 of 9 tasks open', saved: false });
    expect(world.git.statusesOf('commit-2')).toEqual([{ context: 'factory/tasks', state: 'failure', description: '2 of 9 tasks open', link: 'memory://pull/401', commit: 'commit-2' }]);
    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(comment);
  });

  it('records the change and says so in an event when the tasks changed', async () => {
    const world = await getDelivered();
    push(world, 'commit-2', withOpen([SECOND]));

    await checkTasks(world.deps, { pullRequest: 401 });

    const record = await world.record();
    expect(record.events.at(-1)).toMatchObject({ by: 'pierre', type: 'tasks', detail: '1 of 9 tasks open' });
    expect(await world.summary()).toBe('Pull request #401 · 1 of 9 tasks open');
  });

  it('passes a pull request with no Ticket line without reading any ticket (pull request with no factory ticket)', async () => {
    const world = await getDelivered();
    world.git.push('docs/typo', 'd1');
    const other = await world.sourceControl.openPullRequest({ branch: 'docs/typo', base: 'main', title: 'Fix a typo', body: 'Fixes a typo in the README' });

    const result = await checkTasks({ ...world.deps, tickets: unreachable() }, { pullRequest: other.number });

    expect(result).toEqual({ ok: true, action: 'no_ticket' });
    expect(world.git.statusesOf('d1')).toEqual([{ context: 'factory/tasks', state: 'success', description: 'No factory ticket', link: other.url, commit: 'd1' }]);
  });

  it('fails, saying tasks.md could not be read, when the head commit has no tasks.md (the change folder is missing)', async () => {
    const world = await getDelivered();
    push(world, 'commit-2');

    const result = await checkTasks(world.deps, { pullRequest: 401 });

    expect(result).toEqual({ ok: false, reason: 'unreadable', message: 'tasks.md of PAY-142 could not be read at commit-2' });
    expect(world.git.statusesOf('commit-2')).toEqual([
      { context: 'factory/tasks', state: 'failure', description: 'tasks.md of PAY-142 could not be read at commit-2', link: 'memory://pull/401', commit: 'commit-2' },
    ]);
  });

  it('fails when no run of the ticket is linked to the pull request', async () => {
    const world = await getDelivered();
    world.git.push('factory/pay-142-again', 'e1');
    const other = await world.sourceControl.openPullRequest({ branch: 'factory/pay-142-again', base: 'main', title: 'PAY-142 again', body: 'Ticket: PAY-142' });

    const result = await checkTasks(world.deps, { pullRequest: other.number });

    expect(result).toEqual({ ok: false, reason: 'unreadable', message: `No run of PAY-142 is linked to pull request ${other.number}` });
    expect(world.git.statusesOf('e1')).toMatchObject([{ state: 'failure', description: `No run of PAY-142 is linked to pull request ${other.number}` }]);
  });

  it('fails when the ticket record cannot be read', async () => {
    const world = await getDelivered();
    const comment = (await world.tickets.getFactoryComment('PAY-142')) ?? '';
    await world.tickets.putFactoryComment('PAY-142', comment.replace('"total":9', '"total":8'));
    push(world, 'commit-2', withOpen([]));

    const result = await checkTasks(world.deps, { pullRequest: 401 });

    expect(result).toEqual({ ok: false, reason: 'unreadable', message: 'The factory record of PAY-142 could not be read' });
    expect(world.git.statusesOf('commit-2')).toMatchObject([{ state: 'failure', description: 'The factory record of PAY-142 could not be read' }]);
  });

  it('cannot check a pull request that does not exist', async () => {
    const world = await getDelivered();

    expect(await checkTasks(world.deps, { pullRequest: 999 })).toEqual({ ok: false, reason: 'unreadable', message: 'Pull request 999 could not be read' });
  });
});

describe('accepting open tasks', () => {
  it('records who accepted each open task and when, and passes the status (accept two open tasks)', async () => {
    const world = await getDelivered();
    world.clock.seconds = 600;

    const result = await acceptTasks(world.deps, 'PAY-142');

    const tasks = (await world.record()).runs[0]?.tasks;
    expect(result).toEqual({ ok: true, key: 'PAY-142', accepted: [FIRST, SECOND], description: 'All open tasks accepted by pierre' });
    expect(tasks?.accepted).toEqual([
      { text: FIRST, by: 'pierre', at: '2026-11-21T08:10:00Z' },
      { text: SECOND, by: 'pierre', at: '2026-11-21T08:10:00Z' },
    ]);
    expect(world.git.statusesOf('commit-1')).toEqual([
      { context: 'factory/tasks', state: 'success', description: 'All open tasks accepted by pierre', link: 'memory://pull/401', commit: 'commit-1' },
    ]);
    expect(await bodyOf(world)).not.toContain('## Open tasks');
    expect((await world.record()).events.at(-1)).toMatchObject({ by: 'pierre', type: 'tasks_accepted', detail: `${FIRST}; ${SECOND}` });
  });

  it('accepts the tasks open at the head commit, not those recorded at delivery', async () => {
    const world = await getDelivered();
    push(world, 'commit-2', withOpen([SECOND]));

    const result = await acceptTasks(world.deps, 'PAY-142');

    expect(result).toMatchObject({ ok: true, accepted: [SECOND] });
    expect((await world.record()).runs[0]?.tasks).toMatchObject({ commit: 'commit-2', open: [{ text: SECOND }], accepted: [{ text: SECOND }] });
    expect(world.git.statusesOf('commit-2')).toMatchObject([{ state: 'success' }]);
  });

  it('fails the status again for a task added open after the acceptance (a new open task after an acceptance)', async () => {
    const world = await getDelivered();
    await acceptTasks(world.deps, 'PAY-142');
    push(world, 'commit-2', withOpen([FIRST, SECOND], [{ text: '5.1 Tell the team', ticked: false }]));

    await checkTasks(world.deps, { pullRequest: 401 });

    expect(world.git.statusesOf('commit-2')).toMatchObject([{ state: 'failure', description: '1 of 10 tasks open' }]);
    expect(await bodyOf(world)).toContain(`## Open tasks\n- 5.1 Tell the team\n\nAccepted open by pierre:\n- ${FIRST}\n  Not done: needs the released engine.\n- ${SECOND}\n\n## Decisions applied`);
  });

  it('does not let an acceptance cover a reworded task (a reworded accepted task)', async () => {
    const world = await getDelivered();
    await acceptTasks(world.deps, 'PAY-142');
    push(world, 'commit-2', withOpen([FIRST, SECOND]).replace(FIRST, `${FIRST} on staging`));

    await checkTasks(world.deps, { pullRequest: 401 });

    expect(world.git.statusesOf('commit-2')).toMatchObject([{ state: 'failure', description: '1 of 9 tasks open' }]);
  });

  it('keeps passing when an accepted task is ticked, with one task still open and accepted (ticking an accepted task)', async () => {
    const world = await getDelivered();
    await acceptTasks(world.deps, 'PAY-142');
    push(world, 'commit-2', withOpen([SECOND]));

    await checkTasks(world.deps, { pullRequest: 401 });

    expect(world.git.statusesOf('commit-2')).toMatchObject([{ state: 'success', description: 'All open tasks accepted by pierre' }]);
    expect((await world.record()).runs[0]?.tasks).toMatchObject({ open: [{ text: SECOND }], accepted: [{ text: SECOND, by: 'pierre' }] });
  });

  it('blocks again when an accepted task is ticked and then reopened', async () => {
    const world = await getDelivered();
    await acceptTasks(world.deps, 'PAY-142');
    push(world, 'commit-2', withOpen([SECOND]));
    await checkTasks(world.deps, { pullRequest: 401 });
    push(world, 'commit-3', withOpen([FIRST, SECOND]));

    await checkTasks(world.deps, { pullRequest: 401 });

    expect(world.git.statusesOf('commit-3')).toMatchObject([{ state: 'failure', description: '1 of 9 tasks open' }]);
  });

  it('refuses when every task is ticked or accepted, changing nothing (nothing to accept)', async () => {
    const world = await getDelivered();
    await acceptTasks(world.deps, 'PAY-142');
    const comment = await world.tickets.getFactoryComment('PAY-142');

    const result = await acceptTasks(world.deps, 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'nothing_open', message: 'No task of PAY-142 is open and not accepted' });
    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(comment);
  });

  it('refuses when the pull request is merged, changing nothing (pull request already merged)', async () => {
    const world = await getDelivered();
    world.git.merge(401, 'sam');
    const comment = await world.tickets.getFactoryComment('PAY-142');

    const result = await acceptTasks(world.deps, 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'merged', message: 'The pull request of PAY-142 is merged' });
    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(comment);
    expect(world.git.statusesOf('commit-1')).toMatchObject([{ state: 'failure' }]);
  });

  it('refuses when the pull request is closed', async () => {
    const world = await getDelivered();
    world.git.close(401);

    expect(await acceptTasks(world.deps, 'PAY-142')).toEqual({ ok: false, reason: 'closed', message: 'The pull request of PAY-142 is closed' });
  });

  it('refuses a ticket whose latest run opened no pull request', async () => {
    const world = await getWorld();

    expect(await acceptTasks(world.deps, 'PAY-142')).toEqual({ ok: false, reason: 'no_pull_request', message: 'The latest run of PAY-142 has no pull request' });
  });

  it('refuses a ticket with no record', async () => {
    const world = await getWorld();

    expect(await acceptTasks(world.deps, 'PAY-999')).toEqual({ ok: false, reason: 'no_run', message: 'PAY-999 has no factory run' });
  });

  it('refuses when tasks.md cannot be read at the head commit', async () => {
    const world = await getDelivered();
    push(world, 'commit-2');

    expect(await acceptTasks(world.deps, 'PAY-142')).toEqual({ ok: false, reason: 'unreadable', message: 'tasks.md of PAY-142 could not be read at commit-2' });
  });
});
