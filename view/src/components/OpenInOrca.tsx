import { useState } from 'react';
import type { OpenResult } from '../../../src/view/source.js';

type Props = { readonly runKey: string; readonly open: (key: string) => Promise<OpenResult> };

type State = { readonly kind: 'idle' } | { readonly kind: 'opened' } | { readonly kind: 'failed'; readonly message: string };

export function OpenInOrca({ runKey, open }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  return (
    <div className="command">
      <button type="button" className="button button--primary" onClick={() => open(runKey).then((result) => setState(result.ok ? { kind: 'opened' } : { kind: 'failed', message: result.message }))}>
        Open in Orca
      </button>
      {state.kind === 'opened' ? <p>Opened in Orca.</p> : null}
      {state.kind === 'failed' ? <p>{state.message}</p> : null}
    </div>
  );
}
