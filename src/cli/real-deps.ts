import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createBitbucketSourceControl } from '../adapters/bitbucket-source-control.js';
import { createGitHubSourceControl } from '../adapters/github-source-control.js';
import { createFetchHttp, sleep, withRateLimitRetry, type Http } from '../adapters/http.js';
import { createJiraTicketProvider } from '../adapters/jira-ticket-provider.js';
import { createCommandRunner, createOrcaAgentRuntime, type CommandRunner } from '../adapters/orca-agent-runtime.js';
import type { SourceControl } from '../adapters/source-control.js';
import type { TicketProvider } from '../adapters/ticket-provider.js';
import { parseAdaptersConfig, parseFactoryConfig, sampleFactoryConfig, type AdaptersConfig, type ConfigResult } from '../config/project-config.js';
import type { LoopDeps } from '../factory/build-loop.js';
import { assessSpec } from '../factory/risk.js';
import { createDemoViewSource } from '../view/demo.js';
import { createViewSource, type ViewSource } from '../view/source.js';
import { createProjectFiles } from '../setup/project-files.js';
import { enginePinMatches, enginePinMessage } from '../version.js';
import type { SetupDeps } from './setup-command.js';
import { createFilePublisher, createGitInputs, createRepositoryReader, createScriptRunner, createSpecValidator } from './inputs.js';

type Options = { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> };

const RECORD_BUDGET = 30_000;
const MAX_RETRIES = 3;
const CI_USER = 'factory-ci';

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const loadConfig = async <T>(cwd: string, name: string, parse: (text: string) => ConfigResult<T>): Promise<T> => {
  const path = `.factory/${name}`;
  const text = await readFile(join(cwd, path), 'utf8').catch(() => undefined);
  if (text === undefined) throw new Error(`${path} is missing. Run /factory-init`);
  const parsed = parse(text);
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${path}: ${issue.path}: ${issue.message}`).join('\n'));
  return parsed.value;
};

const fromEnv = (env: Options['env'], name: string): string => {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`Set the ${name} environment variable`);
  return value;
};

const GITHUB_API = 'https://api.github.com';
const BITBUCKET_API = 'https://api.bitbucket.org/2.0';

const createSourceControl = ({ source_control: source }: AdaptersConfig, env: Options['env'], http: Http): SourceControl => {
  if (source.token_env === undefined) throw new Error(`The ${source.kind} source control needs token_env in .factory/adapters.yaml`);
  const token = fromEnv(env, source.token_env);
  if (source.kind === 'github') return createGitHubSourceControl({ apiUrl: source.api_url ?? GITHUB_API, repository: source.repo, token, http });
  return createBitbucketSourceControl({
    apiUrl: source.api_url ?? BITBUCKET_API,
    repository: source.repo,
    token,
    http,
    ...(source.username_env === undefined ? {} : { username: fromEnv(env, source.username_env) }),
  });
};

const createTicketProvider = (adapters: AdaptersConfig, env: Options['env'], http: Http): TicketProvider => {
  const provider = adapters.ticket_providers.find((candidate) => candidate.kind === 'jira');
  if (provider === undefined) throw new Error('No supported ticket provider is configured. Only jira is supported so far');
  const { base_url: baseUrl, filter, token_env: tokenEnv, email_env: emailEnv } = provider;
  if (baseUrl === undefined || filter === undefined || tokenEnv === undefined || emailEnv === undefined) {
    throw new Error('The jira ticket provider needs base_url, filter, token_env and email_env in .factory/adapters.yaml');
  }
  return createJiraTicketProvider({
    baseUrl,
    filter,
    email: fromEnv(env, emailEnv),
    token: fromEnv(env, tokenEnv),
    repository: adapters.repository,
    http,
    now,
  });
};

export const createSampleViewSource = (): ViewSource => createDemoViewSource({ config: sampleFactoryConfig(), now });

export const createProjectViewSource = async ({ cwd, env }: Options): Promise<ViewSource> => {
  const config = await loadConfig(cwd, 'factory.yaml', parseFactoryConfig);
  const adapters = await loadConfig(cwd, 'adapters.yaml', parseAdaptersConfig);
  const http = withRateLimitRetry(createFetchHttp(), { sleep, maxRetries: MAX_RETRIES });
  return createViewSource({
    providers: [{ name: 'Jira', provider: createTicketProvider(adapters, env, http) }],
    config,
    repository: adapters.repository,
    machine: hostname(),
    now,
  });
};

export const createRealDeps = async ({ cwd, env }: Options): Promise<LoopDeps> => {
  const config = await loadConfig(cwd, 'factory.yaml', parseFactoryConfig);
  if (!enginePinMatches(config.engine)) throw new Error(enginePinMessage(config.engine));
  const adapters = await loadConfig(cwd, 'adapters.yaml', parseAdaptersConfig);
  const http = withRateLimitRetry(createFetchHttp(), { sleep, maxRetries: MAX_RETRIES });
  const tickets = createTicketProvider(adapters, env, http);
  const sourceControl = createSourceControl(adapters, env, http);
  const runGit = createCommandRunner('git');
  const git = createGitInputs({ run: (args) => runGit(args, { cwd }), mainBranch: config.main_branch });

  return {
    tickets,
    runtime: createOrcaAgentRuntime({ run: createCommandRunner('orca') }),
    config,
    user: (await git.userName()) || CI_USER,
    machine: hostname(),
    now,
    recordBudget: RECORD_BUDGET,
    validateSpec: createSpecValidator({ run: createCommandRunner('openspec') }),
    predictRisk: async (files) => assessSpec(config.risk, files).level,
    mainCommit: git.mainCommit,
    changedFilesSince: git.changedFilesSince,
    sourceControl,
    runScript: createScriptRunner({ cwd }),
    sleep,
    changedFilesOnBranch: git.changedFilesOnBranch,
    linesChangedOnBranch: git.linesChangedOnBranch,
    pushBranch: git.pushBranch,
    commitMessage: git.commitMessage,
  };
};

export const createSetupDeps = ({ cwd, env }: Options): SetupDeps => {
  const http = withRateLimitRetry(createFetchHttp(), { sleep, maxRetries: MAX_RETRIES });
  const runGit = createCommandRunner('git');
  const git: CommandRunner = (args) => runGit(args, { cwd });
  const adapters = (): Promise<AdaptersConfig> => loadConfig(cwd, 'adapters.yaml', parseAdaptersConfig);
  const repository = createRepositoryReader({ run: git });
  return {
    files: createProjectFiles(cwd),
    runScript: createScriptRunner({ cwd }),
    now,
    checkAccess: async (key) => createTicketProvider(await adapters(), env, http).checkAccess(key),
    publishFiles: createFilePublisher({ run: git }),
    readFile: (path) => readFile(join(cwd, path), 'utf8'),
    remoteUrl: repository.remoteUrl,
    mainFile: repository.mainFile,
    tickets: (connection) => createTicketProvider(connection, env, http),
    sourceControl: (connection) => createSourceControl(connection, env, http),
    openPullRequest: async (request) => createSourceControl(await adapters(), env, http).openPullRequest(request),
  };
};
