import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Health, PERIODS, type Period } from '../components/Health';
import { fetchHealth } from '../server/functions';

const DEFAULT_PERIOD: Period = 7;

const periodOf = (value: unknown): Period => PERIODS.find((days) => days === Number(value)) ?? DEFAULT_PERIOD;

export const Route = createFileRoute('/health')({
  validateSearch: (search: Record<string, unknown>) => ({ days: periodOf(search['days']) }),
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ deps }) => fetchHealth({ data: deps.days }),
  component: HealthRoute,
});

function HealthRoute() {
  const result = Route.useLoaderData();
  const navigate = useNavigate({ from: '/health' });
  if (!result.ok) {
    return (
      <main className="screen screen--list">
        <h2 className="list__title">Health</h2>
        <p role="alert">{result.message}</p>
      </main>
    );
  }
  return <Health health={result.data} onPeriod={(days) => void navigate({ search: { days } })} />;
}
