import { clockTime } from '../format';

type Props = {
  readonly loadedAt: string;
  readonly refreshedAt?: string;
  readonly staleSince?: string;
  readonly problem?: string;
  readonly running: number;
  readonly needsYou: number;
};

export function Freshness({ loadedAt, refreshedAt, staleSince, problem, running, needsYou }: Props) {
  if (staleSince !== undefined) {
    return (
      <p className="freshness freshness--stale" role="status">
        <span className="dot dot--waiting" aria-hidden="true" />
        Stale since {clockTime(staleSince)} UTC{problem === undefined ? '' : ` · ${problem}`} · retrying
      </p>
    );
  }
  const seconds = refreshedAt === undefined ? 0 : Math.max(Math.round((Date.parse(loadedAt) - Date.parse(refreshedAt)) / 1000), 0);
  return (
    <p className="freshness" role="status">
      <span className="dot dot--pass" aria-hidden="true" />
      Updated {seconds} s ago · {running} running · {needsYou} need you
    </p>
  );
}
