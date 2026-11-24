import { describe, expect, it } from 'vitest';
import { nextTasks, parseTasks, tasksStatus, withOpenTasksSection } from '../src/factory/open-tasks.js';
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

  it('removes the section once no open task is left unaccepted', () => {
    const listed = withOpenTasksSection(BODY, getMockTasks());
    const accepted = getMockTasks({ accepted: getMockTasks().open.map(({ text }) => ({ text, by: 'Pierre', at: 't' })) });

    expect(withOpenTasksSection(listed, getMockTasks({ open: [] }))).toBe(BODY);
    expect(withOpenTasksSection(listed, accepted)).toBe(BODY);
  });

  it('adds the section at the end of a body with no section', () => {
    expect(withOpenTasksSection('Ticket: PIE-47', getMockTasks({ open: [{ text: '4.2 Update the docs' }] }))).toBe('Ticket: PIE-47\n\n## Open tasks\n- 4.2 Update the docs');
  });

  it('removes a section that ends the body', () => {
    expect(withOpenTasksSection('Ticket: PIE-47\n\n## Open tasks\n- 4.2 Update the docs', getMockTasks({ open: [] }))).toBe('Ticket: PIE-47');
  });
});
