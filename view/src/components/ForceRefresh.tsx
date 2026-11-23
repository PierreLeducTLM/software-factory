import { useState } from 'react';

type Props = { readonly reload: () => Promise<unknown>; readonly refresh: () => Promise<unknown> };

export function ForceRefresh({ reload, refresh }: Props) {
  const [running, setRunning] = useState(false);
  const start = () => {
    setRunning(true);
    void reload()
      .catch(() => undefined)
      .then(refresh)
      .catch(() => undefined)
      .finally(() => setRunning(false));
  };
  return (
    <button type="button" className="button force-refresh" disabled={running} onClick={start}>
      {running ? 'Refreshing…' : 'Force refresh'}
    </button>
  );
}
