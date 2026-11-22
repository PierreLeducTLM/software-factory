import { stringify } from 'yaml';
import { z } from 'zod';
import { parseAdaptersConfig, parseFactoryConfig, type AdaptersConfig } from '../config/project-config.js';
import { CATEGORIES, type Category } from './detect.js';
import { engineFiles, LAUNCHER_PATH } from './engine-files.js';

const DURATION = z.string().regex(/^\d+(s|m|h)$/, 'Use a number followed by s, m or h, such as 90s or 6m');
const NAME = z.string().min(1);

const ChosenCheckSchema = z.object({
  id: NAME,
  category: z.enum(CATEGORIES),
  source: z.enum(['local', 'ci']),
  run: NAME.optional(),
  job: NAME.optional(),
  blocking: z.boolean(),
  timeout: DURATION,
});

const InstallAnswersSchema = z.object({
  engine: NAME,
  repository: NAME,
  mainBranch: NAME,
  states: z.object({ to_refine: NAME, spec_review: NAME, ready_for_dev: NAME, in_development: NAME, in_review: NAME, blocked: NAME, done: NAME }),
  labels: z.object({ auto: NAME, no_automerge: NAME }).optional(),
  checks: z.array(ChosenCheckSchema),
  sensitivePaths: z.array(NAME),
  ticketProvider: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('jira'), baseUrl: NAME, filter: NAME, tokenEnv: NAME, emailEnv: NAME }),
    z.object({ kind: z.literal('linear'), team: NAME, project: NAME.optional(), tokenEnv: NAME }),
  ]),
  sourceControl: z.object({ kind: z.enum(['github', 'bitbucket']), tokenEnv: NAME, usernameEnv: NAME.optional() }),
  ci: z.object({ system: z.enum(['github-actions', 'bitbucket-pipelines', 'none']), workflow: NAME.optional() }),
  watch: z.object({ checks: z.array(NAME).min(1), duration: DURATION, interval: DURATION, environment: NAME }).optional(),
});

const ConnectionSchema = InstallAnswersSchema.pick({ repository: true, mainBranch: true, ticketProvider: true, sourceControl: true });

export type ChosenCheck = z.infer<typeof ChosenCheckSchema>;
export type InstallAnswers = z.infer<typeof InstallAnswersSchema>;
export type Connection = z.infer<typeof ConnectionSchema>;

export type Install = { readonly files: Readonly<Record<string, string>>; readonly executable: readonly string[]; readonly manual: readonly string[]; readonly secrets: readonly string[] };

const STATIONS: Readonly<Record<Category, string>> = { tests: 'quality', lint: 'quality', types: 'quality', format: 'quality', build: 'quality', security: 'review', e2e: 'review' };
const DEFAULT_LABELS = { auto: 'factory-auto', no_automerge: 'factory:no-automerge' };
const FACTORY_YAML = '.factory/factory.yaml';
const ADAPTERS_YAML = '.factory/adapters.yaml';
const WORKFLOW_FILE = '.github/workflows/factory.yml';
const BITBUCKET_FILE = 'bitbucket-pipelines.yml';

const RUBRICS_README = `# Agent check rubrics

Each agent check in \`factory.yaml\` names a rubric file in this folder with its \`criteria\` field.
A rubric says, in plain language, what the reviewing agent must check and what proof it must attach.

Add a check with \`/factory-workflow\`. It writes the rubric, validates the configuration and opens a pull request.
`;

const REPO_TOKEN = 'FACTORY_REPO_TOKEN';
const FACTORY = '.factory/bin/factory';

const secretName = (env: string): string => `FACTORY_${env}`;

const factoryYaml = ({ engine, mainBranch, states, labels, checks, sensitivePaths, watch }: InstallAnswers): string =>
  stringify({
    schema: 1,
    engine,
    main_branch: mainBranch,
    states,
    labels: labels ?? DEFAULT_LABELS,
    checks: checks.map(({ id, category, source, run, job, blocking, timeout }) => ({
      id,
      station: STATIONS[category],
      kind: 'script',
      source,
      blocking,
      timeout,
      ...(run === undefined ? {} : { run }),
      ...(job === undefined ? {} : { job }),
    })),
    ...(watch === undefined ? {} : { watch: { enabled: true, checks: [...watch.checks], duration: watch.duration, interval: watch.interval } }),
    risk: {
      low: { merge: 'auto' },
      medium: { merge: 'human', reviewers: 1 },
      high: { merge: 'human', reviewers: 2 },
      sensitive_paths: [...sensitivePaths],
      shadow: true,
    },
  });

const ticketProviderEntry = (provider: Connection['ticketProvider']) =>
  provider.kind === 'jira'
    ? { kind: provider.kind, base_url: provider.baseUrl, filter: provider.filter, token_env: provider.tokenEnv, email_env: provider.emailEnv }
    : { kind: provider.kind, team: provider.team, project: provider.project, token_env: provider.tokenEnv };

const adaptersYaml = ({ repository, ticketProvider, sourceControl }: Connection): string =>
  stringify({
    repository,
    ticket_providers: [ticketProviderEntry(ticketProvider)],
    source_control: {
      kind: sourceControl.kind,
      repo: repository,
      token_env: sourceControl.tokenEnv,
      ...(sourceControl.usernameEnv === undefined ? {} : { username_env: sourceControl.usernameEnv }),
    },
    agent_runtime: { kind: 'orca' },
  });

const providerEnvs = ({ ticketProvider }: InstallAnswers): readonly string[] =>
  ticketProvider.kind === 'jira' ? [ticketProvider.tokenEnv, ticketProvider.emailEnv] : [ticketProvider.tokenEnv];

const githubJob = (condition: string, command: string): readonly string[] => [
  `    if: ${condition}`,
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '        with:',
  '          fetch-depth: 0',
  '      - uses: actions/setup-node@v4',
  '        with:',
  '          node-version: 22',
  `      - run: ${FACTORY} ${command}`,
];

const githubWorkflow = (answers: InstallAnswers): string => {
  const { mainBranch, sourceControl, ci, watch } = answers;
  return [
    'name: Factory',
    'on:',
    '  push:',
    `    branches: [${mainBranch}]`,
    ...(ci.workflow === undefined ? [] : ['  workflow_run:', `    workflows: [${JSON.stringify(ci.workflow)}]`, '    types: [completed]', `    branches: [${mainBranch}]`]),
    ...(watch === undefined ? [] : ['  deployment_status:']),
    'permissions:',
    '  contents: write',
    '  pull-requests: write',
    'env:',
    `  ${REPO_TOKEN}: \${{ secrets.${REPO_TOKEN} }}`,
    ...providerEnvs(answers).map((env) => `  ${env}: \${{ secrets.${secretName(env)} }}`),
    `  ${sourceControl.tokenEnv}: \${{ secrets.GITHUB_TOKEN }}`,
    'jobs:',
    '  record-merge:',
    ...githubJob("github.event_name == 'push'", 'record-merge --commit ${{ github.sha }}'),
    ...(ci.workflow === undefined
      ? []
      : ['  revert:', ...githubJob("github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'failure'", 'revert --commit ${{ github.event.workflow_run.head_sha }}')]),
    ...(watch === undefined
      ? []
      : [
          '  watch:',
          ...githubJob(
            `github.event_name == 'deployment_status' && github.event.deployment_status.state == 'success' && github.event.deployment.environment == '${watch.environment}'`,
            'watch --commit ${{ github.event.deployment.sha }}',
          ),
        ]),
    '',
  ].join('\n');
};

const bitbucketSteps = ({ mainBranch, watch }: InstallAnswers): readonly string[] => [
  `Add this step to ${BITBUCKET_FILE}, under pipelines > branches > ${mainBranch}:\n- step:\n    name: Factory record-merge\n    script:\n      - ${FACTORY} record-merge --commit $BITBUCKET_COMMIT`,
  `Add this after-script to the step that builds ${mainBranch}:\nafter-script:\n  - if [ "$BITBUCKET_EXIT_CODE" != "0" ]; then ${FACTORY} revert --commit $BITBUCKET_COMMIT; fi`,
  ...(watch === undefined ? [] : [`Add this step after the deployment to ${watch.environment}:\n- step:\n    name: Factory watch\n    script:\n      - ${FACTORY} watch --commit $BITBUCKET_COMMIT`]),
];

const checked = (path: string, text: string, issues: readonly { readonly path: string; readonly message: string }[] | undefined): string => {
  if (issues !== undefined) throw new Error(issues.map((issue) => `${path}: ${issue.path}: ${issue.message}`).join('\n'));
  return text;
};

export const buildInstall = (answers: InstallAnswers): Install => {
  const factory = factoryYaml(answers);
  const adapters = adaptersYaml(answers);
  const parsedFactory = parseFactoryConfig(factory);
  const parsedAdapters = parseAdaptersConfig(adapters);
  const { system, workflow } = answers.ci;
  const github = system === 'github-actions';
  return {
    files: {
      [FACTORY_YAML]: checked(FACTORY_YAML, factory, parsedFactory.ok ? undefined : parsedFactory.issues),
      [ADAPTERS_YAML]: checked(ADAPTERS_YAML, adapters, parsedAdapters.ok ? undefined : parsedAdapters.issues),
      '.factory/checks/README.md': RUBRICS_README,
      ...engineFiles(answers.engine),
      ...(github ? { [WORKFLOW_FILE]: githubWorkflow(answers) } : {}),
    },
    executable: [LAUNCHER_PATH],
    manual: [
      ...(system === 'bitbucket-pipelines' ? bitbucketSteps(answers) : []),
      ...(system === 'none' ? ['No CI system was found. Run "factory record-merge" on every merge to the main branch, and "factory revert" when the main build fails, from whatever builds this project.'] : []),
      ...(github && workflow === undefined ? ['The revert step was left out: name the workflow that builds the main branch, then run the install again.'] : []),
    ],
    secrets: system === 'none' ? [] : [REPO_TOKEN, ...(github ? providerEnvs(answers).map(secretName) : [...providerEnvs(answers), answers.sourceControl.tokenEnv, ...(answers.sourceControl.usernameEnv === undefined ? [] : [answers.sourceControl.usernameEnv])])],
  };
};

export const adaptersFor = (connection: Connection): AdaptersConfig => {
  const parsed = parseAdaptersConfig(adaptersYaml(connection));
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${ADAPTERS_YAML}: ${issue.path}: ${issue.message}`).join('\n'));
  return parsed.value;
};
