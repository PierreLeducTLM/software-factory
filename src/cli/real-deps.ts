import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFetchHttp, sleep, withRateLimitRetry } from '../adapters/http.js';
import { createJiraTicketProvider } from '../adapters/jira-ticket-provider.js';
import { createCommandRunner, createOrcaAgentRuntime } from '../adapters/orca-agent-runtime.js';
import type { TicketProvider } from '../adapters/ticket-provider.js';
import { parseAdaptersConfig, parseFactoryConfig, type AdaptersConfig, type ConfigResult } from '../config/project-config.js';
import type { RefinementDeps } from '../factory/refinement.js';
import { createGitInputs, createSpecValidator } from './inputs.js';

type Options = { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> };

const RECORD_BUDGET = 30_000;
const MAX_RETRIES = 3;

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

const createTicketProvider = (adapters: AdaptersConfig, env: Options['env']): TicketProvider => {
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
    http: withRateLimitRetry(createFetchHttp(), { sleep, maxRetries: MAX_RETRIES }),
    now,
  });
};

export const createRealDeps = async ({ cwd, env }: Options): Promise<RefinementDeps> => {
  const config = await loadConfig(cwd, 'factory.yaml', parseFactoryConfig);
  const adapters = await loadConfig(cwd, 'adapters.yaml', parseAdaptersConfig);
  const tickets = createTicketProvider(adapters, env);
  const runGit = createCommandRunner('git');
  const git = createGitInputs({ run: (args) => runGit(args, { cwd }), mainBranch: config.main_branch });

  return {
    tickets,
    runtime: createOrcaAgentRuntime({ run: createCommandRunner('orca') }),
    config,
    user: await git.userName(),
    now,
    recordBudget: RECORD_BUDGET,
    validateSpec: createSpecValidator({ run: createCommandRunner('openspec') }),
    predictRisk: async () => 'high',
    mainCommit: git.mainCommit,
    changedFilesSince: git.changedFilesSince,
  };
};
