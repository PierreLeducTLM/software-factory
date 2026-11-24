import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { BoardScreen, cardSearch, useCardAddress } from '../components/BoardScreen';
import { fetchDetail, openRun, startRun } from '../server/functions';

export const Route = createFileRoute('/')({ validateSearch: cardSearch, component: BoardRoute });

function BoardRoute() {
  const view = useLoaderData({ from: '__root__' });
  const loadDetail = useServerFn(fetchDetail);
  const open = useServerFn(openRun);
  const start = useServerFn(startRun);
  const address = useCardAddress();
  if (!view.ok) return null;
  return (
    <BoardScreen
      address={address}
      columns={view.data.columns}
      needsYou={view.data.needsYou}
      providers={view.data.providers.length}
      loadDetail={async (key) => (await loadDetail({ data: key })) ?? undefined}
      openInOrca={(key) => open({ data: key })}
      startInOrca={(request) => start({ data: request })}
    />
  );
}
