import { useState } from 'react';
import type { StartRequest, StartResult } from '../../../src/view/source.js';

type Props = { readonly runKey: string; readonly command: string; readonly start: (request: StartRequest) => Promise<StartResult> };

type State = { readonly kind: 'idle' } | { readonly kind: 'starting' } | { readonly kind: 'started'; readonly worktree: string } | { readonly kind: 'failed'; readonly message: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function StartInOrca({ runKey, command, start }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const press = () => {
    setState({ kind: 'starting' });
    void start({ key: runKey, command })
      .catch((error: unknown): StartResult => ({ ok: false, message: `Orca could not start ${runKey}: ${messageOf(error)}` }))
      .then((result) => setState(result.ok ? { kind: 'started', worktree: result.worktree } : { kind: 'failed', message: result.message }));
  };
  return (
    <div className="command">
      <button type="button" className="button start-in-orca" disabled={state.kind === 'starting' || state.kind === 'started'} onClick={press}>
        {state.kind === 'starting' ? 'Starting in Orca…' : 'Start in Orca'}
      </button>
      {state.kind === 'started' ? <p className="start-in-orca__status" role="status">Started in Orca: {state.worktree}</p> : null}
      {state.kind === 'failed' ? <p className="start-in-orca__status" role="status">{state.message}</p> : null}
    </div>
  );
}
