import { ForceRefresh } from './ForceRefresh';
import { Freshness } from './Freshness';

type Props = Parameters<typeof Freshness>[0] & { readonly reload: () => Promise<unknown>; readonly refresh: () => Promise<unknown> };

export function HeaderStatus({ reload, refresh, ...freshness }: Props) {
  return (
    <div className="top__status" role="group" aria-label="Board freshness">
      <Freshness {...freshness} />
      <ForceRefresh reload={reload} refresh={refresh} />
    </div>
  );
}
