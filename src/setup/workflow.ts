import type { OpenPullRequest } from '../adapters/source-control.js';
import { parseFactoryConfig, type FactoryConfig } from '../config/project-config.js';
import type { ScriptRun } from '../factory/checks.js';
import { describePipeline, diffChecks, tryChecks, type Trial } from './pipeline.js';
import type { ProjectFiles, PublishedChange } from './project-files.js';

export type WorkflowDeps = {
  readonly files: ProjectFiles;
  readonly mainFile: (path: string, branch: string) => Promise<string | undefined>;
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly publishFiles: (change: PublishedChange) => Promise<void>;
  readonly openPullRequest: (request: OpenPullRequest) => Promise<{ readonly url: string }>;
};

type Diff = { readonly added: readonly string[]; readonly changed: readonly string[]; readonly removed: readonly string[] };

export type Proposal = { readonly pipeline: readonly string[]; readonly diff: Diff; readonly rubrics: readonly string[]; readonly trials: readonly Trial[] };

export type WorkflowResult =
  | ({ readonly ok: true; readonly action: 'preview' } & Proposal)
  | ({ readonly ok: true; readonly action: 'opened'; readonly url: string } & Proposal)
  | ({ readonly ok: false; readonly reason: 'failing_check'; readonly message: string } & Proposal)
  | { readonly ok: false; readonly reason: 'invalid' | 'missing_rubric' | 'no_change'; readonly message: string };

const FACTORY_YAML = '.factory/factory.yaml';

const parsed = (text: string | undefined): FactoryConfig | undefined => {
  const result = text === undefined ? undefined : parseFactoryConfig(text);
  return result?.ok ? result.value : undefined;
};

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const listed = (label: string, items: readonly string[]): readonly string[] => (items.length === 0 ? [] : [`${label}: ${items.join(', ')}`]);

export const changeLines = ({ diff, rubrics }: Pick<Proposal, 'diff' | 'rubrics'>): readonly string[] => [
  ...listed('Added', diff.added),
  ...listed('Changed', diff.changed),
  ...listed('Removed', diff.removed),
  ...listed('Rubrics', rubrics),
];

const body = (title: string, proposal: Proposal): string =>
  [
    `Changes the factory workflow: ${title}.`,
    '',
    ...changeLines(proposal),
    '',
    ...(proposal.trials.length === 0 ? [] : ['Tried on main:', ...proposal.trials.map((trial) => `- ${trial.id}: ${trial.status}`), '']),
    'The new pipeline:',
    '```',
    ...proposal.pipeline,
    '```',
  ].join('\n');

export const proposeWorkflowChange = async (deps: WorkflowDeps, { title, preview }: { readonly title: string; readonly preview: boolean }): Promise<WorkflowResult> => {
  const text = await deps.files.read(FACTORY_YAML);
  if (text === undefined) return { ok: false, reason: 'invalid', message: `${FACTORY_YAML} is missing. Run /factory-init` };
  const proposed = parseFactoryConfig(text);
  if (!proposed.ok) return { ok: false, reason: 'invalid', message: proposed.issues.map((issue) => `${FACTORY_YAML}: ${issue.path}: ${issue.message}`).join('\n') };
  const after = proposed.value;

  const agentChecks = after.checks.flatMap((check) => (check.kind === 'agent' ? [check] : []));
  const rubricTexts = await Promise.all(agentChecks.map(async (check) => ({ check, text: await deps.files.read(check.criteria), main: await deps.mainFile(check.criteria, after.main_branch) })));
  const missing = rubricTexts.find((rubric) => rubric.text === undefined);
  if (missing !== undefined) return { ok: false, reason: 'missing_rubric', message: `Write the rubric of check ${missing.check.id} in ${missing.check.criteria}, then try again.` };
  const rubrics = rubricTexts.flatMap(({ check, text: rubric, main }) => (rubric !== undefined && rubric !== main ? [[check.criteria, rubric] as const] : []));

  const mainText = await deps.mainFile(FACTORY_YAML, after.main_branch);
  const configChanged = text !== mainText;
  if (!configChanged && rubrics.length === 0) return { ok: false, reason: 'no_change', message: `${FACTORY_YAML} is the same as on main: there is nothing to propose.` };

  const checks = diffChecks(parsed(mainText), after);
  const { ok, trials } = await tryChecks(deps, [...checks.added, ...checks.changed]);
  const proposal: Proposal = {
    pipeline: describePipeline(after),
    diff: { added: checks.added.map((check) => check.id), changed: checks.changed.map((check) => check.id), removed: checks.removed },
    rubrics: rubrics.map(([path]) => path),
    trials,
  };
  if (!ok) {
    const failing = trials.filter((trial) => trial.blocking && trial.status === 'fail').map((trial) => trial.id);
    const one = failing.length === 1;
    const checks = one ? 'check' : 'checks';
    const message = `The blocking ${checks} ${failing.join(', ')} ${one ? 'fails' : 'fail'} on main. Fix main, or make the ${checks} advisory, then try again. No pull request was opened.`;
    return { ok: false, reason: 'failing_check', message, ...proposal };
  }
  if (preview) return { ok: true, action: 'preview', ...proposal };

  const branch = `factory/workflow-${slug(title)}`;
  const message = `chore: ${title}`;
  await deps.publishFiles({ branch, base: after.main_branch, files: { ...(configChanged ? { [FACTORY_YAML]: text } : {}), ...Object.fromEntries(rubrics) }, message });
  const { url } = await deps.openPullRequest({ branch, base: after.main_branch, title: message, body: body(title, proposal) });
  return { ok: true, action: 'opened', url, ...proposal };
};
