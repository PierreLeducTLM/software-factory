import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { BoardScreen } from '../components/BoardScreen';
import { fetchDetail, openRun } from '../server/functions';

export const Route = createFileRoute('/')({ component: BoardRoute });

function BoardRoute() {
  const view = useLoaderData({ from: '__root__' });
  const loadDetail = useServerFn(fetchDetail);
  const open = useServerFn(openRun);
  if (!view.ok) return null;
  return <BoardScreen columns={view.data.columns} loadDetail={async (key) => (await loadDetail({ data: key })) ?? undefined} openInOrca={(key) => open({ data: key })} />;
}
