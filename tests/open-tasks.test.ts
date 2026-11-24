import { describe, expect, it } from 'vitest';
import { findTasksPath, nextTasks, parseTasks, tasksStatus, withOpenTasksSection } from '../src/factory/open-tasks.js';
import type { RunTasks } from '../src/record/ticket-record.js';

const getMockTasks = (overrides?: Partial<RunTasks>): RunTasks => ({
  total: 9,
  path: 'openspec/changes/archive/2026-11-21-x/tasks.md',
  commit: 'c1',
  open: [{ text: '4.1 Run the end-to-end check', note: 'Not done: needs the release' }, { text: '4.2 Update the docs' }],
  accepted: [],
  ...overrides,
});

describe('reading tasks.md', () => {
  it('counts ticked tasks as done and unchecked ones as open, in order', () => {
    const tasks = parseTasks(['# Tasks', '', '## 1. Record', '', '- [x] 1.1 Add the field', '- [ ] 1.2 Add the parser', '- [X] 1.3 Add the adapters', '- [ ] 1.4 Wire it'].join('\n'));

    expect(tasks).toEqual({ total: 4, open: [{ text: '1.2 Add the parser' }, { text: '1.4 Wire it' }] });
  });

  it('takes the indented lines directly under an unchecked task as its note', () => {
    const tasks = parseTasks(
      ['- [ ] 7.1 Run the end-to-end check', '  - Not done: needs the released engine.', '    It cannot be published from a run.', '- [ ] 7.2 Tell the team', '', '  - Not a note: a blank line came first'].join('\n'),
    );

    expect(tasks.open).toEqual([
      { text: '7.1 Run the end-to-end check', note: 'Not done: needs the released engine.\nIt cannot be published from a run.' },
      { text: '7.2 Tell the team' },
    ]);
  });

  it('gives a ticked task no note, even when lines are indented under it', () => {
    expect(parseTasks('- [x] 1.1 Done\n  - Verified by the tests').open).toEqual([]);
  });

  it('counts a padded tick as done, as OpenSpec does', () => {
    expect(parseTasks('- [ x] 1.1 Done\n- [ ] 1.2 Open')).toEqual({ total: 2, open: [{ text: '1.2 Open' }] });
  });

  it('ignores lines without a checkbox, such as links and plain bullets', () => {
    expect(parseTasks('- See [the design](./design.md)\n- [design](./design.md)\nSome prose\n- [ ] 1.1 Open')).toEqual({ total: 1, open: [{ text: '1.1 Open' }] });
  });

  it('counts an indented sub-task as a task, not as a note', () => {
    expect(parseTasks('- [ ] 1.1 Parent\n  - [x] 1.1.1 Child')).toEqual({ total: 2, open: [{ text: '1.1 Parent' }] });
  });

  it.each([
    ['1. [ ] 1.1 Ordered', { total: 1, open: [{ text: '1.1 Ordered' }] }],
    ['10) [ ] 1.1 Ordered with a parenthesis', { total: 1, open: [{ text: '1.1 Ordered with a parenthesis' }] }],
    ['+ [ ] 1.1 Plus bullet', { total: 1, open: [{ text: '1.1 Plus bullet' }] }],
    ['-[ ] 1.1 No space after the bullet', { total: 1, open: [{ text: '1.1 No space after the bullet' }] }],
    ['- [] 1.1 Empty box', { total: 1, open: [{ text: '1.1 Empty box' }] }],
    ['- [  ] 1.1 Wide box', { total: 1, open: [{ text: '1.1 Wide box' }] }],
    ['- [~] 1.1 Other marker', { total: 1, open: [{ text: '1.1 Other marker' }] }],
    ['- [ x ] 1.1 Padded on both sides', { total: 1, open: [] }],
    ['- [x]1.1 No space after the box', { total: 1, open: [] }],
    ['- [ ]   1.1 Spaced out   ', { total: 1, open: [{ text: '1.1 Spaced out' }] }],
    ['- [A](https://example.test) a link', { total: 0, open: [] }],
    ['a. [ ] not a list item', { total: 0, open: [] }],
    ['See - [ ] in prose', { total: 0, open: [] }],
  ])('reads %j the way OpenSpec counts it', (line, expected) => {
    expect(parseTasks(line)).toEqual(expected);
  });

  it('ends a note at a line that is not indented or holds only spaces', () => {
    const tasks = parseTasks(['- [ ] 1.1 Open', ' Not done: one space is enough', 'Prose with spaces', '- [ ] 1.2 Open', '   ', '  - Not a note of 1.2'].join('\n'));

    expect(tasks.open).toEqual([{ text: '1.1 Open', note: 'Not done: one space is enough' }, { text: '1.2 Open' }]);
  });

  it('removes only the list marker that starts a note line', () => {
    expect(parseTasks('- [ ] 1.1 Open\n  -   Not done - see 4.1').open).toEqual([{ text: '1.1 Open', note: 'Not done - see 4.1' }]);
    expect(parseTasks('- [ ] 1.1 Open\n  Not done - see 4.1').open).toEqual([{ text: '1.1 Open', note: 'Not done - see 4.1' }]);
  });

  it('reads a CRLF file like any other', () => {
    expect(parseTasks('- [ ] 1.1 Open\r\n  - Not done: later\r\n- [x] 1.2 Done\r\n')).toEqual({ total: 2, open: [{ text: '1.1 Open', note: 'Not done: later' }] });
  });
});

describe('the tasks status', () => {
  it('fails while an open task is not accepted, counting only those', () => {
    expect(tasksStatus(getMockTasks())).toEqual({ state: 'failure', description: '2 of 9 tasks open' });
    expect(tasksStatus(getMockTasks({ accepted: [{ text: '4.2 Update the docs', by: 'pierre', at: 't' }] }))).toEqual({ state: 'failure', description: '1 of 9 tasks open' });
  });

  it('passes when no task is open', () => {
    expect(tasksStatus(getMockTasks({ total: 6, open: [] }))).toEqual({ state: 'success', description: 'All 6 tasks done' });
  });

  it('passes when every open task is accepted, naming who accepted them', () => {
    const first = { text: '4.1 Run the end-to-end check', by: 'Pierre', at: 't' };
    const second = { text: '4.2 Update the docs', by: 'Pierre', at: 't' };

    expect(tasksStatus(getMockTasks({ accepted: [first, second] }))).toEqual({ state: 'success', description: 'All open tasks accepted by Pierre' });
    expect(tasksStatus(getMockTasks({ accepted: [first, { ...second, by: 'Maya' }] })).description).toBe('All open tasks accepted by Pierre and Maya');
    expect(
      tasksStatus(getMockTasks({ open: [...getMockTasks().open, { text: '4.3 Tell the team' }], accepted: [first, { ...second, by: 'Maya' }, { text: '4.3 Tell the team', by: 'Sam', at: 't' }] })).description,
    ).toBe('All open tasks accepted by Pierre, Maya and Sam');
  });

  it('does not let an acceptance cover a reworded task', () => {
    const tasks = getMockTasks({ open: [{ text: '4.1 Run the end-to-end check on staging' }], accepted: [{ text: '4.1 Run the end-to-end check', by: 'Pierre', at: 't' }] });

    expect(tasksStatus(tasks)).toEqual({ state: 'failure', description: '1 of 9 tasks open' });
  });
});

describe('the next task state', () => {
  it('keeps the acceptances of tasks still open and drops those of tasks no longer open', () => {
    const previous = getMockTasks({
      accepted: [
        { text: '4.1 Run the end-to-end check', by: 'Pierre', at: 't1' },
        { text: '4.2 Update the docs', by: 'Pierre', at: 't1' },
      ],
    });

    const next = nextTasks(previous, { total: 9, open: [{ text: '4.2 Update the docs' }] }, { path: 'tasks.md', commit: 'c2' });

    expect(next).toEqual({ total: 9, path: 'tasks.md', commit: 'c2', open: [{ text: '4.2 Update the docs' }], accepted: [{ text: '4.2 Update the docs', by: 'Pierre', at: 't1' }] });
  });

  it('starts with no acceptance when there was no task state', () => {
    expect(nextTasks(undefined, { total: 2, open: [] }, { path: 'tasks.md', commit: 'c1' })).toEqual({ total: 2, path: 'tasks.md', commit: 'c1', open: [], accepted: [] });
  });
});

const BODY = ['Ticket: PIE-47', 'Spec: approved by pierre at t', '', '## Decisions applied', '- D-001', '', '## Merge', 'Merged by a person'].join('\n');

describe('the Open tasks section of the pull request body', () => {
  it('lists each open task with its note before the first section', () => {
    expect(withOpenTasksSection(BODY, getMockTasks())).toBe(
      [
        'Ticket: PIE-47',
        'Spec: approved by pierre at t',
        '',
        '## Open tasks',
        '- 4.1 Run the end-to-end check',
        '  Not done: needs the release',
        '- 4.2 Update the docs',
        '',
        '## Decisions applied',
        '- D-001',
        '',
        '## Merge',
        'Merged by a person',
      ].join('\n'),
    );
  });

  it('replaces the section when the tasks change, leaving the rest of the body as it was', () => {
    const listed = withOpenTasksSection(BODY, getMockTasks());

    const after = withOpenTasksSection(listed, getMockTasks({ open: [{ text: '4.2 Update the docs' }] }));

    expect(after).toBe(BODY.replace('## Decisions applied', '## Open tasks\n- 4.2 Update the docs\n\n## Decisions applied'));
  });

  it('lists accepted tasks apart, under who accepted them', () => {
    const tasks = getMockTasks({ accepted: [{ text: '4.1 Run the end-to-end check', by: 'Pierre', at: 't' }] });

    expect(withOpenTasksSection(BODY, tasks)).toContain(
      ['## Open tasks', '- 4.2 Update the docs', '', 'Accepted open by Pierre:', '- 4.1 Run the end-to-end check', '  Not done: needs the release', '', '## Decisions applied'].join('\n'),
    );
  });

  it('lists the accepted tasks under each person who accepted them', () => {
    const tasks = getMockTasks({
      open: [...getMockTasks().open, { text: '4.3 Tell the team' }],
      accepted: [
        { text: '4.1 Run the end-to-end check', by: 'Pierre', at: 't' },
        { text: '4.3 Tell the team', by: 'Maya', at: 't' },
      ],
    });

    expect(withOpenTasksSection('Ticket: PIE-47', tasks)).toBe(
      ['Ticket: PIE-47', '', '## Open tasks', '- 4.2 Update the docs', '', 'Accepted open by Pierre:', '- 4.1 Run the end-to-end check', '  Not done: needs the release', '', 'Accepted open by Maya:', '- 4.3 Tell the team'].join('\n'),
    );
  });

  it('removes the section once no open task is left unaccepted', () => {
    const listed = withOpenTasksSection(BODY, getMockTasks());
    const accepted = getMockTasks({ accepted: getMockTasks().open.map(({ text }) => ({ text, by: 'Pierre', at: 't' })) });

    expect(withOpenTasksSection(listed, getMockTasks({ open: [] }))).toBe(BODY);
    expect(withOpenTasksSection(listed, accepted)).toBe(BODY);
  });

  it('adds the section at the end of a body with no section', () => {
    expect(withOpenTasksSection('Ticket: PIE-47\n  ', getMockTasks({ open: [{ text: '4.2 Update the docs' }] }))).toBe('Ticket: PIE-47\n\n## Open tasks\n- 4.2 Update the docs');
  });

  it('replaces the section of a body edited in a browser, keeping its CRLF line endings', () => {
    const edited = withOpenTasksSection(BODY, getMockTasks()).replaceAll('\n', '\r\n');

    const after = withOpenTasksSection(edited, getMockTasks({ open: [{ text: '4.2 Update the docs' }] }));

    expect(after).toBe(BODY.replace('## Decisions applied', '## Open tasks\n- 4.2 Update the docs\n\n## Decisions applied').replaceAll('\n', '\r\n'));
  });

  it('removes a section that ends the body', () => {
    expect(withOpenTasksSection('Ticket: PIE-47\n\n## Open tasks\n- 4.2 Update the docs', getMockTasks({ open: [] }))).toBe('Ticket: PIE-47');
  });
});

describe('finding the tasks.md of a change among the files of a pull request', () => {
  const SPEC = ['proposal.md', 'design.md', 'tasks.md', 'specs/billing/spec.md'];
  const folder = (path: string, files: readonly string[] = SPEC): readonly string[] => files.map((file) => `${path}/${file}`);

  it('takes the only tasks.md of a change folder, archived or not', () => {
    expect(findTasksPath(['src/x.ts', ...folder('openspec/changes/archive/2026-11-21-billing-export')], SPEC)).toBe('openspec/changes/archive/2026-11-21-billing-export/tasks.md');
    expect(findTasksPath(['src/x.ts', 'tasks.md', ...folder('openspec/changes/billing-export')], SPEC)).toBe('openspec/changes/billing-export/tasks.md');
  });

  it('picks the change whose files are the spec of the ticket when the pull request holds several', () => {
    const files = [...folder('openspec/changes/archive/2026-11-20-force-refresh', ['proposal.md', 'tasks.md']), ...folder('openspec/changes/archive/2026-11-21-billing-export')];

    expect(findTasksPath(files, SPEC)).toBe('openspec/changes/archive/2026-11-21-billing-export/tasks.md');
    expect(findTasksPath([...files, 'openspec/changes/archive/2026-11-21-billing-export/.openspec.yaml'], SPEC)).toBe('openspec/changes/archive/2026-11-21-billing-export/tasks.md');
  });

  it('finds nothing when no change folder holds a tasks.md, or several match the spec', () => {
    expect(findTasksPath(['src/x.ts', 'openspec/specs/billing/spec.md'], SPEC)).toBeUndefined();
    expect(findTasksPath([...folder('openspec/changes/archive/2026-11-20-billing-export'), ...folder('openspec/changes/archive/2026-11-21-billing-export')], SPEC)).toBeUndefined();
  });
});
