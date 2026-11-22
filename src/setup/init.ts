import type { OpenPullRequest } from '../adapters/source-control.js';
import type { ProviderStatus, TicketProvider } from '../adapters/ticket-provider.js';
import { TICKET_PROVIDER_NAMES, type AdaptersConfig } from '../config/project-config.js';
import type { ScriptRun } from '../factory/checks.js';
import { ENGINE_VERSION } from '../version.js';
import { detectProject, type Detection } from './detect.js';
import { adaptersFor, buildInstall, type Connection, type InstallAnswers } from './install.js';
import { matchStatuses, type StatusMatch } from './match-statuses.js';
import type { ProjectFiles, PublishedChange } from './project-files.js';
import { verifyChecks, type Verification } from './verify.js';

export type InitDeps = {
  readonly files: ProjectFiles;
  readonly remoteUrl: () => Promise<string | undefined>;
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
  const detection = await detectProject({ files: deps.files, ...(remoteUrl === undefined ? {} : { remoteUrl }) });
  return { engine: ENGINE_VERSION, detection, verification: verify ? await verifyChecks(deps, detection.candidates) : [] };
};

export const matchProjectStatuses = async (deps: InitDeps, connection: Connection): Promise<StatusMatch & { readonly statuses: readonly ProviderStatus[] }> => {
  const statuses = await deps.tickets(adaptersFor(connection)).listStatuses();
  return { statuses, ...matchStatuses(statuses) };
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

export const openCheckPullRequest = async (deps: InitDeps, connection: Connection, request: { readonly branch: string; readonly title: string; readonly body: string }): Promise<string> =>
  (await deps.sourceControl(adaptersFor(connection)).openPullRequest({ ...request, base: connection.mainBranch })).url;
