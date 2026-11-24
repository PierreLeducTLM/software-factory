import type { CommitStatus } from '../adapters/source-control.js';
import type { RunTasks } from '../record/ticket-record.js';

export type OpenTask = RunTasks['open'][number];

export type Acceptance = RunTasks['accepted'][number];

export type TaskList = { readonly total: number; readonly open: readonly OpenTask[] };

export type TasksStatus = { readonly state: 'success' | 'failure'; readonly description: string };

export type TaskState = { readonly total: number; readonly open: readonly OpenTask[]; readonly accepted: readonly Acceptance[] };

type Reading = TaskList & { readonly collecting: boolean };

const TASK_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/;
const INDENTED = /^\s+\S/;
const LIST_MARKER = /^[-*+]\s+/;
export const TASKS_CONTEXT = 'factory/tasks';
const SECTION = '## Open tasks';
const HEADING = '## ';

const withNote = (open: readonly OpenTask[], line: string): readonly OpenTask[] =>
  open.map((task, index) => {
    if (index !== open.length - 1) return task;
    const text = line.trim().replace(LIST_MARKER, '');
    return { ...task, note: task.note === undefined ? text : `${task.note}\n${text}` };
  });

const readLine = (reading: Reading, line: string): Reading => {
  const task = TASK_LINE.exec(line);
  if (task !== null) {
    const done = (task[1] ?? '').toLowerCase() === 'x';
    return { total: reading.total + 1, open: done ? reading.open : [...reading.open, { text: (task[2] ?? '').trim() }], collecting: !done };
  }
  if (!reading.collecting || !INDENTED.test(line)) return { ...reading, collecting: false };
  return { ...reading, open: withNote(reading.open, line) };
};

export const parseTasks = (markdown: string): TaskList => {
  const { total, open } = markdown
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .reduce<Reading>(readLine, { total: 0, open: [], collecting: false });
  return { total, open };
};

export const acceptanceOf = ({ accepted }: Pick<TaskState, 'accepted'>, task: OpenTask): Acceptance | undefined =>
  accepted.find((acceptance) => acceptance.text === task.text);

export const unacceptedTasks = (tasks: TaskState): readonly OpenTask[] => tasks.open.filter((task) => acceptanceOf(tasks, task) === undefined);

export const peopleList = (people: readonly string[]): string => {
  const unique = [...new Set(people)];
  const last = unique.at(-1) ?? '';
  return unique.length <= 1 ? last : `${unique.slice(0, -1).join(', ')} and ${last}`;
};

export const acceptorsOf = (tasks: TaskState): readonly string[] =>
  [...new Set(tasks.open.flatMap((task) => acceptanceOf(tasks, task)?.by ?? []))];

export const tasksStatus = (tasks: TaskState): TasksStatus => {
  const unaccepted = unacceptedTasks(tasks).length;
  if (unaccepted > 0) return { state: 'failure', description: `${unaccepted} of ${tasks.total} tasks open` };
  if (tasks.open.length === 0) return { state: 'success', description: `All ${tasks.total} tasks done` };
  return { state: 'success', description: `All open tasks accepted by ${peopleList(acceptorsOf(tasks))}` };
};

type ReadAt = { readonly path: string; readonly commit: string };

type PullRequestHead = { readonly url: string; readonly headCommit: string };

export const tasksCommitStatus = (tasks: TaskState, { url, headCommit }: PullRequestHead): CommitStatus => ({
  context: TASKS_CONTEXT,
  ...tasksStatus(tasks),
  link: url,
  commit: headCommit,
});

export const nextTasks = (previous: RunTasks | undefined, read: TaskList, { path, commit }: ReadAt): RunTasks => ({
  total: read.total,
  path,
  commit,
  open: read.open.map((task) => ({ ...task })),
  accepted: (previous?.accepted ?? []).filter((acceptance) => read.open.some((task) => task.text === acceptance.text)).map((acceptance) => ({ ...acceptance })),
});

export const sameTasks = (one: TaskState | undefined, other: TaskState): boolean =>
  one !== undefined && JSON.stringify([one.total, one.open, one.accepted]) === JSON.stringify([other.total, other.open, other.accepted]);

const itemLines = (task: OpenTask): readonly string[] => [`- ${task.text}`, ...(task.note === undefined ? [] : task.note.split('\n').map((line) => `  ${line}`))];

const sectionLines = (tasks: TaskState): readonly string[] => {
  const unaccepted = unacceptedTasks(tasks);
  if (unaccepted.length === 0) return [];
  const groups = acceptorsOf(tasks).map((by) => ({ by, tasks: tasks.open.filter((task) => acceptanceOf(tasks, task)?.by === by) }));
  return [SECTION, ...unaccepted.flatMap(itemLines), ...groups.flatMap((group) => ['', `Accepted open by ${group.by}:`, ...group.tasks.flatMap(itemLines)]), ''];
};

const trimEnd = (lines: readonly string[]): readonly string[] => {
  const last = lines.findLastIndex((line) => line.trim() !== '');
  return lines.slice(0, last + 1);
};

const withoutSection = (lines: readonly string[]): readonly string[] => {
  const start = lines.indexOf(SECTION);
  if (start === -1) return lines;
  const end = lines.findIndex((line, index) => index > start && line.startsWith(HEADING));
  return end === -1 ? trimEnd(lines.slice(0, start)) : [...lines.slice(0, start), ...lines.slice(end)];
};

export const withOpenTasksSection = (body: string, tasks: TaskState): string => {
  const rest = withoutSection(body.split('\n'));
  const section = sectionLines(tasks);
  if (section.length === 0) return rest.join('\n');
  const at = rest.findIndex((line) => line.startsWith(HEADING));
  if (at === -1) return [...trimEnd(rest), '', ...trimEnd(section)].join('\n');
  return [...rest.slice(0, at), ...section, ...rest.slice(at)].join('\n');
};
