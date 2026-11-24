import type { CiResult, CommitStatus, PullRequest, RequiredChecks, SourceControl } from './source-control.js';

type Options = { readonly now: () => string };

type World = {
  readonly push: (branch: string, commit: string) => void;
  readonly merge: (number: number, by: string) => void;
  readonly setCi: (ref: string, job: string, result: Exclude<CiResult, 'missing'>) => void;
  readonly putFile: (commit: string, path: string, content: string) => void;
  readonly statusesOf: (commit: string) => readonly CommitStatus[];
  readonly requireChecks: (branch: string, contexts: RequiredChecks) => void;
  readonly close: (number: number) => void;
};

type State = {
  pullRequests: readonly PullRequest[];
  branches: Readonly<Record<string, string>>;
  ci: Readonly<Record<string, CiResult>>;
  files: Readonly<Record<string, string>>;
  statuses: readonly CommitStatus[];
  required: Readonly<Record<string, RequiredChecks>>;
};

const FIRST_NUMBER = 401;

export const createInMemorySourceControl = ({ now }: Options): { readonly sourceControl: SourceControl; readonly world: World } => {
  const state: State = { pullRequests: [], branches: {}, ci: {}, files: {}, statuses: [], required: {} };

  const find = (number: number): PullRequest | undefined => state.pullRequests.find((pullRequest) => pullRequest.number === number);

  const change = (number: number, update: Partial<PullRequest>): void => {
    state.pullRequests = state.pullRequests.map((pullRequest) =>
      pullRequest.number === number ? { ...pullRequest, ...update } : pullRequest,
    );
  };

  const add = (pullRequest: Omit<PullRequest, 'number' | 'url' | 'state' | 'autoMerge'>): PullRequest => {
    const number = FIRST_NUMBER + state.pullRequests.length;
    const created: PullRequest = { ...pullRequest, number, url: `memory://pull/${number}`, state: 'open', autoMerge: false };
    state.pullRequests = [...state.pullRequests, created];
    return created;
  };

  const sourceControl: SourceControl = {
    openPullRequest: async ({ branch, body }) => {
      const headCommit = state.branches[branch];
      if (headCommit === undefined) throw new Error(`Branch ${branch} has no commits`);
      return add({ branch, headCommit, body });
    },

    getPullRequest: async (number) => find(number),

    updatePullRequestBody: async ({ number, body }) => change(number, { body }),

    getCiResult: async ({ ref, job }) => state.ci[`${ref}\n${job}`] ?? 'missing',

    enableAutoMerge: async (number) => change(number, { autoMerge: true }),

    openRevertPullRequest: async (number) => {
      const original = find(number);
      if (original?.state !== 'merged') throw new Error(`Pull request ${number} is not merged`);
      return add({ branch: `revert-${number}`, headCommit: `revert-of-${original.headCommit}`, body: `Reverts #${number}`, reverts: number });
    },

    wasMergedAsIs: async ({ number, commit }) => {
      const pullRequest = find(number);
      return pullRequest?.state === 'merged' && pullRequest.headCommit === commit;
    },

    postStatus: async (status) => {
      state.statuses = [...state.statuses.filter((posted) => posted.commit !== status.commit || posted.context !== status.context), { ...status }];
    },

    readFileAt: async ({ path, commit }) => state.files[`${commit}\n${path}`],

    requiredChecks: async (branch) => state.required[branch] ?? [],

    changedFiles: async (number) => {
      const pullRequest = find(number);
      if (pullRequest === undefined) throw new Error(`Pull request ${number} does not exist`);
      const prefix = `${pullRequest.headCommit}\n`;
      return Object.keys(state.files).flatMap((key) => (key.startsWith(prefix) ? [key.slice(prefix.length)] : []));
    },
  };

  const world: World = {
    push: (branch, commit) => {
      state.branches = { ...state.branches, [branch]: commit };
      state.pullRequests = state.pullRequests.map((pullRequest) =>
        pullRequest.branch === branch && pullRequest.state === 'open' ? { ...pullRequest, headCommit: commit } : pullRequest,
      );
    },
    merge: (number, by) => change(number, { state: 'merged', mergedBy: by, mergedAt: now() }),
    setCi: (ref, job, result) => {
      state.ci = { ...state.ci, [`${ref}\n${job}`]: result };
    },
    putFile: (commit, path, content) => {
      state.files = { ...state.files, [`${commit}\n${path}`]: content };
    },
    statusesOf: (commit) => state.statuses.filter((status) => status.commit === commit),
    requireChecks: (branch, contexts) => {
      state.required = { ...state.required, [branch]: contexts };
    },
    close: (number) => change(number, { state: 'closed' }),
  };

  return { sourceControl, world };
};
