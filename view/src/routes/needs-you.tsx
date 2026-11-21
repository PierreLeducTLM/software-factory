import { createFileRoute, useLoaderData } from '@tanstack/react-router';
import { NeedsYou } from '../components/NeedsYou';

export const Route = createFileRoute('/needs-you')({ component: NeedsYouRoute });

function NeedsYouRoute() {
  const view = useLoaderData({ from: '__root__' });
  if (!view.ok) return null;
  return <NeedsYou items={view.data.needsYou} now={view.data.loadedAt} />;
}
