import type { CiResult, PullRequest, SourceControl } from './source-control.js';

type Options = { readonly now: () => string };

type World = {
  readonly push: (branch: string, commit: string) => void;
  readonly merge: (number: number, by: string) => void;
  readonly setCi: (ref: string, job: string, result: Exclude<CiResult, 'missing'>) => void;
};

type State = {
  pullRequests: readonly PullRequest[];
  branches: Readonly<Record<string, string>>;
  ci: Readonly<Record<string, CiResult>>;
};

const FIRST_NUMBER = 401;

export const createInMemorySourceControl = ({ now }: Options): { readonly sourceControl: SourceControl; readonly world: World } => {
  const state: State = { pullRequests: [], branches: {}, ci: {} };

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
  };

  return { sourceControl, world };
};
