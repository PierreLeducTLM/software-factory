export type PullRequest = {
  readonly number: number;
  readonly url: string;
  readonly branch: string;
  readonly state: 'open' | 'merged' | 'closed';
  readonly headCommit: string;
  readonly body: string;
  readonly autoMerge: boolean;
  readonly mergedAt?: string;
  readonly mergedBy?: string;
  readonly reverts?: number;
};

export type CiResult = 'passed' | 'failed' | 'pending' | 'missing';

export type OpenPullRequest = {
  readonly branch: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
};

export type CommitStatus = {
  readonly context: string;
  readonly state: 'success' | 'failure';
  readonly description: string;
  readonly link: string;
  readonly commit: string;
};

export type RequiredChecks = readonly string[] | 'unreadable';

export const EVERY_CHECK = '*';

export const requiresCheck = (required: readonly string[], context: string): boolean => required.includes(context) || required.includes(EVERY_CHECK);

export interface SourceControl {
  openPullRequest(request: OpenPullRequest): Promise<PullRequest>;
  getPullRequest(number: number): Promise<PullRequest | undefined>;
  updatePullRequestBody(request: { readonly number: number; readonly body: string }): Promise<void>;
  getCiResult(request: { readonly ref: string; readonly job: string }): Promise<CiResult>;
  enableAutoMerge(number: number): Promise<void>;
  openRevertPullRequest(number: number): Promise<PullRequest>;
  wasMergedAsIs(request: { readonly number: number; readonly commit: string }): Promise<boolean>;
  postStatus(status: CommitStatus): Promise<void>;
  readFileAt(request: { readonly path: string; readonly commit: string }): Promise<string | undefined>;
  requiredChecks(branch: string): Promise<RequiredChecks>;
  changedFiles(number: number): Promise<readonly string[]>;
}
