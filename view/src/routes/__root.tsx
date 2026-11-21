import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Freshness } from '../components/Freshness';
import { fetchView } from '../server/functions';
import styles from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Software factory' }],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  loader: () => fetchView(),
  component: RootComponent,
});

const DEFAULT_POLL_SECONDS = 60;

function RootComponent() {
  const view = Route.useLoaderData();
  const router = useRouter();
  const pollSeconds = view.ok ? view.data.pollSeconds : DEFAULT_POLL_SECONDS;

  useEffect(() => {
    const timer = setInterval(() => void router.invalidate(), pollSeconds * 1000);
    return () => clearInterval(timer);
  }, [router, pollSeconds]);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header className="top">
          <div>
            <h1 className="top__title">Software factory</h1>
            {view.ok ? (
              <p className="top__sub">
                {view.data.repository} · read from {view.data.providers.join(', ')} · read-only
              </p>
            ) : null}
            <nav className="tabs" aria-label="Views">
              <Link to="/" className="tab" activeProps={{ className: 'tab tab--active' }} activeOptions={{ exact: true }}>
                Board
              </Link>
              <Link to="/needs-you" className="tab" activeProps={{ className: 'tab tab--active' }}>
                Needs you{view.ok ? ` · ${view.data.needsYou.length}` : ''}
              </Link>
            </nav>
          </div>
          {view.ok ? (
            <Freshness
              loadedAt={view.data.loadedAt}
              running={view.data.running}
              needsYou={view.data.needsYou.length}
              {...(view.data.refreshedAt === undefined ? {} : { refreshedAt: view.data.refreshedAt })}
              {...(view.data.staleSince === undefined ? {} : { staleSince: view.data.staleSince })}
              {...(view.data.problem === undefined ? {} : { problem: view.data.problem })}
            />
          ) : null}
        </header>
        <div className="rule" />
        {view.ok ? (
          <Outlet />
        ) : (
          <main className="screen screen--list">
            <h2 className="list__title">The factory view could not start</h2>
            <p role="alert">{view.message}</p>
          </main>
        )}
        <Scripts />
      </body>
    </html>
  );
}
