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

export interface SourceControl {
  openPullRequest(request: OpenPullRequest): Promise<PullRequest>;
  getPullRequest(number: number): Promise<PullRequest | undefined>;
  updatePullRequestBody(request: { readonly number: number; readonly body: string }): Promise<void>;
  getCiResult(request: { readonly ref: string; readonly job: string }): Promise<CiResult>;
  enableAutoMerge(number: number): Promise<void>;
  openRevertPullRequest(number: number): Promise<PullRequest>;
  wasMergedAsIs(request: { readonly number: number; readonly commit: string }): Promise<boolean>;
}
