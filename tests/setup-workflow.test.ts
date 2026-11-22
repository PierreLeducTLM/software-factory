import { describe, expect, it } from 'vitest';
import type { OpenPullRequest } from '../src/adapters/source-control.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { createInMemoryProjectFiles, type PublishedChange } from '../src/setup/project-files.js';
import { proposeWorkflowChange } from '../src/setup/workflow.js';

const MAIN = `schema: 1
engine: 0.1.0
main_branch: develop
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm run test }
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`;

const WITH_TYPECHECK = MAIN.replace('checks:\n', 'checks:\n  - { id: typecheck, station: quality, kind: script, blocking: true, timeout: 2m, run: pnpm run typecheck }\n');
const WITH_UI_REVIEW = `${MAIN.replace('risk:', '  - { id: ui-design, station: review, kind: agent, blocking: true, timeout: 10m, criteria: .factory/checks/ui-design.md, evidence: screenshots }\nrisk:')}`;
const RUBRIC = '# UI design\n\nEvery screen follows the design system.\n';

type World = { readonly working?: Readonly<Record<string, string>>; readonly main?: string; readonly mainRubrics?: Readonly<Record<string, string>>; readonly runs?: Readonly<Record<string, ScriptRun>> };

const propose = async (world: World, options: Partial<Parameters<typeof proposeWorkflowChange>[1]> = {}) => {
  const commands: string[] = [];
  const published: PublishedChange[] = [];
  const opened: OpenPullRequest[] = [];
  const result = await proposeWorkflowChange(
    {
      files: createInMemoryProjectFiles(world.working ?? {}),
      mainFile: async (path) => ({ ...world.mainRubrics, '.factory/factory.yaml': world.main })[path],
      runScript: async (command) => {
        commands.push(command);
        return world.runs?.[command] ?? { exitCode: 0, output: 'ok', timedOut: false };
      },
      publishFiles: async (change) => void published.push(change),
      openPullRequest: async (request) => {
        opened.push(request);
        return { url: 'https://github.com/acme/billing-service/pull/9' };
      },
    },
    { title: 'Add a type check', preview: false, ...options },
  );
  return { result, commands, published, opened };
};

describe('changing the factory workflow', () => {
  it('shows the new pipeline and the change, runs the new check on main, and opens a pull request', async () => {
    const { result, commands, published, opened } = await propose({ working: { '.factory/factory.yaml': WITH_TYPECHECK }, main: MAIN });

    expect(result).toMatchObject({
      ok: true,
      action: 'opened',
      url: 'https://github.com/acme/billing-service/pull/9',
      diff: { added: ['typecheck'], changed: [], removed: [] },
      trials: [{ id: 'typecheck', blocking: true, status: 'pass' }],
    });
    expect(result.ok && result.pipeline).toContain('  - typecheck: blocking, pnpm run typecheck, timeout 2m');
    expect(commands).toEqual(['pnpm run typecheck']);
    expect(published).toEqual([{ branch: 'factory/workflow-add-a-type-check', base: 'develop', files: { '.factory/factory.yaml': WITH_TYPECHECK }, message: 'chore: Add a type check' }]);
    expect(opened[0]).toMatchObject({ branch: 'factory/workflow-add-a-type-check', base: 'develop', title: 'chore: Add a type check' });
    expect(opened[0]?.body).toBe(
      [
        'Changes the factory workflow: Add a type check.',
        '',
        'Added: typecheck',
        '',
        'Tried on main:',
        '- typecheck: pass',
        '',
        'The new pipeline:',
        '```',
        ...(result.ok ? result.pipeline : []),
        '```',
      ].join('\n'),
    );
  });

  it('stops before the pull request when a new blocking check fails on main', async () => {
    const { result, published, opened } = await propose({
      working: { '.factory/factory.yaml': WITH_TYPECHECK },
      main: MAIN,
      runs: { 'pnpm run typecheck': { exitCode: 2, output: 'src/a.ts(3,1): error TS2304', timedOut: false } },
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'failing_check',
      message: 'The blocking check typecheck fails on main. Fix main, or make the check advisory, then try again. No pull request was opened.',
      trials: [{ id: 'typecheck', status: 'fail', detail: 'src/a.ts(3,1): error TS2304' }],
    });
    expect([...published, ...opened]).toEqual([]);
  });

  it('names every blocking check that fails, and only those', async () => {
    const many = MAIN.replace(
      'checks:\n',
      [
        'checks:',
        '  - { id: typecheck, station: quality, kind: script, blocking: true, timeout: 2m, run: pnpm run typecheck }',
        '  - { id: e2e, station: review, kind: script, blocking: true, timeout: 9m, run: pnpm run e2e }',
        '  - { id: lint, station: quality, kind: script, blocking: false, timeout: 1m, run: pnpm run lint }',
        '  - { id: format, station: quality, kind: script, blocking: true, timeout: 1m, run: pnpm run format }',
        '',
      ].join('\n'),
    );
    const failed: ScriptRun = { exitCode: 1, output: 'failed', timedOut: false };

    const { result } = await propose({ working: { '.factory/factory.yaml': many }, main: MAIN, runs: { 'pnpm run typecheck': failed, 'pnpm run e2e': failed, 'pnpm run lint': failed } }, { preview: true });

    expect(result).toMatchObject({
      ok: false,
      message: 'The blocking checks typecheck, e2e fail on main. Fix main, or make the checks advisory, then try again. No pull request was opened.',
      diff: { added: ['typecheck', 'e2e', 'lint', 'format'] },
    });
  });

  it('lists every added check in the pull request', async () => {
    const two = WITH_TYPECHECK.replace('checks:\n', 'checks:\n  - { id: lint, station: quality, kind: script, blocking: false, timeout: 1m, run: pnpm run lint }\n');

    const { opened } = await propose({ working: { '.factory/factory.yaml': two }, main: MAIN });

    expect(opened[0]?.body.split('\n').slice(2, 3)).toEqual(['Added: lint, typecheck']);
  });

  it('names the branch after the title, in plain words', async () => {
    const { published } = await propose({ working: { '.factory/factory.yaml': WITH_TYPECHECK }, main: MAIN }, { title: '  Add a type check -- now! ' });

    expect(published[0]?.branch).toBe('factory/workflow-add-a-type-check-now');
  });

  it('lets a new advisory check fail on main', async () => {
    const advisory = WITH_TYPECHECK.replace('id: typecheck, station: quality, kind: script, blocking: true', 'id: typecheck, station: quality, kind: script, blocking: false');

    const { result } = await propose({ working: { '.factory/factory.yaml': advisory }, main: MAIN, runs: { 'pnpm run typecheck': { exitCode: 2, output: 'error', timedOut: false } } });

    expect(result).toMatchObject({ ok: true, action: 'opened', trials: [{ id: 'typecheck', blocking: false, status: 'fail' }] });
  });

  it('shows everything without opening anything when asked for a preview', async () => {
    const { result, published, opened } = await propose({ working: { '.factory/factory.yaml': WITH_TYPECHECK }, main: MAIN }, { preview: true });

    expect(result).toMatchObject({ ok: true, action: 'preview', diff: { added: ['typecheck'] }, trials: [{ id: 'typecheck', status: 'pass' }] });
    expect([...published, ...opened]).toEqual([]);
  });

  it('ships the rubric of a new agent check with the configuration, and refuses one whose rubric is missing', async () => {
    const shipped = await propose({ working: { '.factory/factory.yaml': WITH_UI_REVIEW, '.factory/checks/ui-design.md': RUBRIC }, main: MAIN }, { title: 'Review the UI' });
    const missing = await propose({ working: { '.factory/factory.yaml': WITH_UI_REVIEW }, main: MAIN });

    expect(shipped.published[0]?.files).toEqual({ '.factory/factory.yaml': WITH_UI_REVIEW, '.factory/checks/ui-design.md': RUBRIC });
    expect(shipped.result).toMatchObject({ ok: true, trials: [{ id: 'ui-design', status: 'agent' }] });
    expect(missing.result).toEqual({ ok: false, reason: 'missing_rubric', message: 'Write the rubric of check ui-design in .factory/checks/ui-design.md, then try again.' });
  });

  it('proposes a rubric that changed alone', async () => {
    const files: Readonly<Record<string, string>> = { '.factory/factory.yaml': WITH_UI_REVIEW, '.factory/checks/ui-design.md': `${RUBRIC}Buttons use the primary color.\n` };

    const { result, published, opened } = await propose({ working: files, main: WITH_UI_REVIEW }, { title: 'Check button colors' });

    expect(result).toMatchObject({ ok: true, diff: { added: [], changed: [], removed: [] }, rubrics: ['.factory/checks/ui-design.md'], trials: [] });
    expect(published[0]?.files).toEqual({ '.factory/checks/ui-design.md': files['.factory/checks/ui-design.md'] });
    expect(opened[0]?.body.split('\n').slice(2, 3)).toEqual(['Rubrics: .factory/checks/ui-design.md']);
    expect((await propose({ working: files, main: WITH_UI_REVIEW, mainRubrics: files })).result).toMatchObject({ ok: false, reason: 'no_change' });
  });

  it('describes changed and removed checks', async () => {
    const slower = MAIN.replace('timeout: 6m', 'timeout: 9m');

    const changed = await propose({ working: { '.factory/factory.yaml': slower }, main: MAIN });
    const removed = await propose({ working: { '.factory/factory.yaml': MAIN }, main: WITH_TYPECHECK });

    expect(changed.result).toMatchObject({ ok: true, diff: { added: [], changed: ['unit-tests'], removed: [] } });
    expect(changed.opened[0]?.body.split('\n').slice(2, 3)).toEqual(['Changed: unit-tests']);
    expect(removed.result).toMatchObject({ ok: true, diff: { removed: ['typecheck'] }, trials: [] });
    expect(removed.opened[0]?.body.split('\n').slice(2, 6)).toEqual(['Removed: typecheck', '', 'The new pipeline:', '```']);
  });

  it('refuses a configuration the factory would not accept, naming each field', async () => {
    const { result, commands } = await propose({ working: { '.factory/factory.yaml': WITH_TYPECHECK.replace('timeout: 2m', 'timeout: soon').replace('station: quality, kind: script, blocking: true, timeout: 6m', 'station: quality, kind: script, blocking: maybe, timeout: 6m') }, main: MAIN });

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(result.ok ? [] : result.message.split('\n')).toEqual(['.factory/factory.yaml: checks.0.timeout: Use a number followed by s, m or h, such as 90s or 6m', expect.stringMatching(/^\.factory\/factory\.yaml: checks\.1\.blocking: /)]);
    expect(commands).toEqual([]);
  });

  it('refuses when nothing changed, or when the project has no configuration yet', async () => {
    const same = await propose({ working: { '.factory/factory.yaml': MAIN }, main: MAIN });
    const none = await propose({ working: {} });

    expect(same.result).toEqual({ ok: false, reason: 'no_change', message: '.factory/factory.yaml is the same as on main: there is nothing to propose.' });
    expect(none.result).toEqual({ ok: false, reason: 'invalid', message: '.factory/factory.yaml is missing. Run /factory-init' });
  });
});
