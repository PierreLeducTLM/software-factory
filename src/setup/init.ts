import type { OpenPullRequest } from '../adapters/source-control.js';
import type { TicketProvider } from '../adapters/ticket-provider.js';
import { TICKET_PROVIDER_NAMES, type AdaptersConfig } from '../config/project-config.js';
import type { ScriptRun } from '../factory/checks.js';
import { ENGINE_VERSION } from '../version.js';
import type { FactoryState } from '../record/ticket-record.js';
import { BITBUCKET_PIPELINES_FILE, detectProject, FACTORY_WORKFLOWS, mainBuildWorkflow, type Category, type Detection } from './detect.js';
import { adaptersFor, buildInstall, type ChosenCheck, type Connection, type InstallAnswers } from './install.js';
import { matchStatuses } from './match-statuses.js';
import type { ProjectFiles, PublishedChange } from './project-files.js';
import { verifyChecks, type Verification } from './verify.js';

export type InitDeps = {
  readonly files: ProjectFiles;
  readonly remoteUrl: () => Promise<string | undefined>;
  readonly defaultBranch: () => Promise<string | undefined>;
  readonly runScript: (command: string, options: { readonly timeoutSeconds: number }) => Promise<ScriptRun>;
  readonly now: () => string;
  readonly tickets: (adapters: AdaptersConfig) => Pick<TicketProvider, 'listStatuses' | 'checkAccess' | 'canReenter'>;
  readonly sourceControl: (adapters: AdaptersConfig) => { readonly openPullRequest: (request: OpenPullRequest) => Promise<{ readonly url: string }> };
  readonly publishFiles: (change: PublishedChange) => Promise<void>;
};

export type InitDetection = { readonly engine: string; readonly detection: Detection; readonly verification: readonly Verification[] };

export type InstallResult =
  | { readonly ok: true; readonly url: string; readonly secrets: readonly string[]; readonly manual: readonly string[] }
  | { readonly ok: false; readonly reason: 'service_account' | 'claim_lock'; readonly message: string };

const INSTALL_BRANCH = 'factory/install';
const INSTALL_TITLE = 'chore: install the software factory';

export const detectForInit = async (deps: InitDeps, { verify }: { readonly verify: boolean }): Promise<InitDetection> => {
  const remoteUrl = await deps.remoteUrl();
  const mainBranch = await deps.defaultBranch();
  const detection = await detectProject({ files: deps.files, ...(remoteUrl === undefined ? {} : { remoteUrl }), ...(mainBranch === undefined ? {} : { mainBranch }) });
  return { engine: ENGINE_VERSION, detection, verification: verify ? await verifyChecks(deps, detection.candidates) : [] };
};

const installBody = (secrets: readonly string[], manual: readonly string[]): string =>
  [
    'Installs the software factory in this project.',
    '',
    ...(secrets.length === 0 ? [] : ['Before merging, store these secrets in the CI secret store:', ...secrets.map((secret) => `- ${secret}`), '']),
    ...(manual.length === 0 ? [] : ['Then, by hand:', ...manual.map((step) => `- ${step}`), '']),
    'Every risk level starts in shadow mode: a person merges each factory pull request until the factory has earned auto-merge.',
  ].join('\n');

export const installFactory = async (deps: InitDeps, answers: InstallAnswers, { ticket }: { readonly ticket: string }): Promise<InstallResult> => {
  const adapters = adaptersFor(answers);
  const tickets = deps.tickets(adapters);
  const provider = TICKET_PROVIDER_NAMES[answers.ticketProvider.kind];
  const access = await tickets.checkAccess(ticket);
  const missing = [...(access.comment ? [] : ['comment on']), ...(access.transition ? [] : ['change the status of'])];
  if (missing.length > 0) {
    return { ok: false, reason: 'service_account', message: `The service account cannot ${missing.join(' or ')} ${ticket}. Grant the missing permission in ${provider}, then run the install again. No pull request was opened.` };
  }
  const claimed = answers.states.in_development;
  if (await tickets.canReenter({ key: ticket, status: claimed })) {
    return {
      ok: false,
      reason: 'claim_lock',
      message: `The ${provider} workflow lets a ticket move from "${claimed}" to "${claimed}", so two developers could claim the same ticket. Remove that transition, then run the install again. No pull request was opened.`,
    };
  }
  const { files, executable, secrets, manual } = buildInstall(answers);
  await deps.publishFiles({ branch: INSTALL_BRANCH, base: answers.mainBranch, files, executable, message: INSTALL_TITLE });
  const { url } = await deps.sourceControl(adapters).openPullRequest({ branch: INSTALL_BRANCH, base: answers.mainBranch, title: INSTALL_TITLE, body: installBody(secrets, manual) });
  return { ok: true, url, secrets, manual };
};

export type InitInput = {
  readonly ticket: string;
  readonly verify: boolean;
  readonly team?: string;
  readonly project?: string;
  readonly baseUrl?: string;
  readonly filter?: string;
  readonly tokenEnv?: string;
  readonly emailEnv?: string;
  readonly repository?: string;
  readonly mainBranch?: string;
  readonly sourceControl?: 'github' | 'bitbucket';
  readonly sourceTokenEnv?: string;
  readonly sourceUsernameEnv?: string;
  readonly sourceAccessToken?: boolean;
  readonly statuses?: Readonly<Partial<Record<FactoryState, string>>>;
  readonly sensitivePaths?: readonly string[];
};

export type InitResult =
  | (Extract<InstallResult, { readonly ok: true }> & { readonly summary: readonly string[] })
  | Extract<InstallResult, { readonly ok: false }>
  | { readonly ok: false; readonly reason: 'missing'; readonly missing: readonly string[]; readonly message: string }
  | { readonly ok: false; readonly reason: 'statuses'; readonly unmatched: readonly FactoryState[]; readonly available: readonly string[]; readonly message: string };

const TIMEOUTS: Readonly<Record<Category, string>> = { tests: '10m', lint: '5m', types: '5m', format: '2m', security: '10m', build: '10m', e2e: '15m' };
const CI_TIMEOUT = '15m';

const ticketProviderOf = (input: InitInput): Connection['ticketProvider'] | readonly string[] => {
  const { team, baseUrl, filter, project, tokenEnv, emailEnv } = input;
  if (team !== undefined && baseUrl !== undefined) return ['--team or --base-url, not both'];
  if (team !== undefined) return { kind: 'linear', team, ...(project === undefined ? {} : { project }), tokenEnv: tokenEnv ?? 'LINEAR_API_KEY' };
  if (baseUrl === undefined) return ['--team (Linear), or --base-url and --filter (Jira)'];
  if (filter === undefined) return ['--filter (Jira)'];
  return { kind: 'jira', baseUrl, filter, tokenEnv: tokenEnv ?? 'JIRA_TOKEN', emailEnv: emailEnv ?? 'JIRA_EMAIL' };
};

const sourceControlOf = (input: InitInput, detection: Detection): Connection['sourceControl'] | undefined => {
  const kind = input.sourceControl ?? detection.remote?.kind;
  if (kind === undefined) return undefined;
  if (kind === 'github') return { kind, tokenEnv: input.sourceTokenEnv ?? 'GH_TOKEN' };
  if (input.sourceAccessToken === true) return { kind, tokenEnv: input.sourceTokenEnv ?? 'BITBUCKET_TOKEN' };
  return { kind, tokenEnv: input.sourceTokenEnv ?? 'BITBUCKET_TOKEN', usernameEnv: input.sourceUsernameEnv ?? 'BITBUCKET_USERNAME' };
};

const completeStates = (found: Readonly<Partial<Record<FactoryState, string>>>): InstallAnswers['states'] | undefined => {
  const { to_refine, spec_review, ready_for_dev, in_development, in_review, blocked, done } = found;
  if (to_refine === undefined || spec_review === undefined || ready_for_dev === undefined || in_development === undefined || in_review === undefined || blocked === undefined || done === undefined) return undefined;
  return { to_refine, spec_review, ready_for_dev, in_development, in_review, blocked, done };
};

const checksOf = (detection: Detection, verification: readonly Verification[]): readonly ChosenCheck[] =>
  detection.candidates.filter((candidate, index) => detection.candidates.findIndex((other) => other.id === candidate.id) === index).map(({ id, category, source, run, job }) => {
    const measured = verification.find((check) => check.id === id);
    return {
      id,
      category,
      source,
      ...(run === undefined ? {} : { run }),
      ...(job === undefined ? {} : { job }),
      blocking: measured === undefined || measured.status === 'pass' || measured.status === 'not_run',
      timeout: measured?.timeout ?? (source === 'ci' ? CI_TIMEOUT : TIMEOUTS[category]),
    };
  });

const ciSystemOf = (detection: Detection, sourceControl: Connection['sourceControl']): InstallAnswers['ci']['system'] => {
  const builds = detection.ci.jobs.some((job) => !FACTORY_WORKFLOWS.includes(job.file));
  if (sourceControl.kind === 'github' && !builds) return 'none';
  const pipelines = detection.ci.jobs.some((job) => job.file === BITBUCKET_PIPELINES_FILE);
  return sourceControl.kind === 'bitbucket' && pipelines ? 'bitbucket-pipelines' : detection.ci.system;
};

const summaryOf = (answers: InstallAnswers, advisory: readonly string[]): readonly string[] => {
  const { ticketProvider: tracker, sourceControl, repository, mainBranch, checks, states } = answers;
  const blocking = checks.filter((check) => !advisory.includes(check.id)).map((check) => check.id).join(', ');
  return [
    tracker.kind === 'linear' ? `Tracker: Linear, team ${tracker.team}, key in ${tracker.tokenEnv}` : `Tracker: Jira, ${tracker.baseUrl}, key in ${tracker.tokenEnv}`,
    `Repository: ${repository} on ${sourceControl.kind}, branch ${mainBranch}, token in ${sourceControl.tokenEnv}`,
    advisory.length === 0
      ? `Checks, all blocking: ${blocking}`
      : `Checks, blocking: ${blocking}. Advisory, because they fail or are flaky on this branch: ${advisory.join(', ')}`,
    `Statuses: ${Object.entries(states).map(([state, status]) => `${state}=${status}`).join(', ')}`,
    'Every risk level starts in shadow mode, with no sensitive paths and no staging watch. Change them later with /factory-workflow.',
  ];
};

export const initProject = async (deps: InitDeps, input: InitInput): Promise<InitResult> => {
  const { detection } = await detectForInit(deps, { verify: false });
  const ticketProvider = ticketProviderOf(input);
  const sourceControl = sourceControlOf(input, detection);
  const repository = input.repository ?? detection.remote?.repository;
  const mainBranch = input.mainBranch ?? detection.mainBranch;
  const missing = [
    ...('kind' in ticketProvider ? [] : ticketProvider),
    ...(repository === undefined ? ['--repository'] : []),
    ...(sourceControl === undefined ? ['--source-control github|bitbucket'] : []),
    ...(mainBranch === undefined ? ['--main-branch'] : []),
  ];
  if (!('kind' in ticketProvider) || repository === undefined || sourceControl === undefined || mainBranch === undefined) return { ok: false, reason: 'missing', missing, message: `Missing: ${missing.join('; ')}` };

  const connection: Connection = { repository, mainBranch, ticketProvider, sourceControl };
  const statuses = await deps.tickets(adaptersFor(connection)).listStatuses();
  const available = statuses.map((status) => status.name);
  const chosen = input.statuses ?? {};
  const unknown = Object.values(chosen).find((name) => !available.includes(name));
  if (unknown !== undefined) {
    return { ok: false, reason: 'statuses', unmatched: [], available, message: `The tracker has no status "${unknown}". It has: ${available.join(', ')}.` };
  }
  const match = matchStatuses(statuses);
  const unmatched = match.unmatched.filter((state) => !(state in chosen));
  const states = completeStates({ ...match.matched, ...chosen });
  if (states === undefined) {
    const flag = unmatched.map((state) => `${state}=<status>`).join(';');
    return { ok: false, reason: 'statuses', unmatched, available, message: `No status matches ${unmatched.join(', ')}. Choose one for each with --statuses "${flag}". The tracker has: ${available.join(', ')}.` };
  }

  const verification = input.verify ? await verifyChecks(deps, detection.candidates) : [];
  const workflow = await mainBuildWorkflow(deps.files, detection);
  const answers: InstallAnswers = {
    engine: ENGINE_VERSION,
    repository,
    mainBranch,
    states,
    checks: [...checksOf(detection, verification)],
    sensitivePaths: [...(input.sensitivePaths ?? [])],
    ticketProvider,
    sourceControl,
    ci: { system: ciSystemOf(detection, sourceControl), ...(workflow === undefined ? {} : { workflow }) },
  };
  const installed = await installFactory(deps, answers, { ticket: input.ticket });
  if (!installed.ok) return installed;
  const advisory = verification.filter((check) => check.status === 'fail' || check.status === 'flaky').map((check) => check.id);
  return { ...installed, summary: summaryOf(answers, advisory) };
};
