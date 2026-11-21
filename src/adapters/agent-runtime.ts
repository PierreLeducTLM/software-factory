export type Worktree = {
  readonly id: string;
  readonly path: string;
  readonly branch: string;
  readonly host: string;
};

export type SessionReference = {
  readonly worktreeId: string;
  readonly host: string;
  readonly surface: string;
  readonly handle?: string;
};

export type SessionCost = { readonly known: true; readonly usd: number } | { readonly known: false };

export interface AgentRuntime {
  currentWorktree(): Promise<Worktree | undefined>;
  createWorktree(request: { readonly name: string; readonly branch: string; readonly reference?: string }): Promise<Worktree>;
  startSession(request: { readonly worktree: Worktree; readonly agent: string; readonly prompt: string }): Promise<SessionReference>;
  postProgress(request: { readonly worktree: Worktree; readonly text: string }): Promise<void>;
  sessionCost(session: SessionReference): Promise<SessionCost>;
}
