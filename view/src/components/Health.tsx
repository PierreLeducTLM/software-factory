import type { Health as HealthData, ProviderHealth } from '../../../src/view/health.js';
import { duration } from '../format';
import { CopyCommand } from './CopyCommand';

export const PERIODS = [7, 30, 90] as const;

export type Period = (typeof PERIODS)[number];

type Props = { readonly health: HealthData; readonly onPeriod: (days: Period) => void; readonly copy?: (text: string) => Promise<void> };

const NONE = '–';

const capitalised = (text: string): string => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}

function Provider({ health, copy }: { readonly health: ProviderHealth; readonly copy: Props['copy'] }) {
  const id = `health-${health.provider.replace(/\W+/g, '-')}`;
  return (
    <section className="health" aria-labelledby={id}>
      <h3 className="health__provider" id={id}>
        {health.provider}
      </h3>
      <dl className="stats" role="group" aria-label="Totals">
        <Stat label="Merged" value={String(health.merged)} />
        <Stat label="First-pass rate" value={health.firstPassRate === undefined ? NONE : `${Math.round(health.firstPassRate * 100)}%`} />
        <Stat label="Average attempts" value={health.averageAttempts === undefined ? NONE : health.averageAttempts.toFixed(1)} />
        <Stat label="Send-backs" value={String(health.sendBacks)} />
        <Stat label="Blocked" value={String(health.blocked)} />
        <Stat label="Cost per merge" value="Not reported" />
      </dl>
      <p className="health__note">The agent runtime does not report cost.</p>
      <div className="health__tables">
        <div>
          <table className="table" aria-label="Failure reasons by gate">
            <thead>
              <tr>
                <th scope="col">Gate</th>
                <th scope="col">Failures</th>
              </tr>
            </thead>
            <tbody>
              {health.failures.map(({ gate, count }) => (
                <tr key={gate}>
                  <td>{gate}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {health.failures.length === 0 ? <p className="health__note">No gate failed in this period.</p> : null}
        </div>
        <div>
          <table className="table" aria-label="Median time per station">
            <thead>
              <tr>
                <th scope="col">Station</th>
                <th scope="col">Median</th>
              </tr>
            </thead>
            <tbody>
              {health.stations.map(({ name, medianSeconds }) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{duration(medianSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {health.stations.length === 0 ? <p className="health__note">No step finished in this period.</p> : null}
        </div>
      </div>
      <table className="table" aria-label="Shadow mode by risk level">
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">Merged</th>
            <th scope="col">Merged as is</th>
            <th scope="col">Changed by a person</th>
            <th scope="col">Reverted within 2 weeks</th>
            <th scope="col">In a row</th>
          </tr>
        </thead>
        <tbody>
          {health.levels.map((level) => (
            <tr key={level.level}>
              <td>{level.level}</td>
              <td>{level.merged}</td>
              <td>{level.mergedAsIs}</td>
              <td>{level.changed}</td>
              <td>{level.reverted}</td>
              <td>
                {level.streak} of {level.threshold}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {health.levels.map((level) =>
        level.suggestion === undefined ? null : (
          <div className="health__suggestion" key={level.level}>
            <p>
              {capitalised(level.level)} risk reached {level.streak} changes in a row with no disagreement and no revert. To turn auto-merge on, run:
            </p>
            <CopyCommand command={level.suggestion} {...(copy === undefined ? {} : { copy })} />
          </div>
        ),
      )}
    </section>
  );
}

export function Health({ health, onPeriod, copy }: Props) {
  return (
    <main className="screen screen--list">
      <h2 className="list__title">Health</h2>
      <p className="list__lead">
        Computed from the run records of tickets updated in the last {health.periodDays} days, read from the ticket provider each time. Nothing is stored.
      </p>
      <div className="filters" role="group" aria-label="Period">
        {PERIODS.map((days) => (
          <button type="button" className="filter" key={days} aria-pressed={health.periodDays === days} onClick={() => onPeriod(days)}>
            {days} days
          </button>
        ))}
      </div>
      {health.providers.length === 0 ? <p className="list__empty">No ticket with a factory record changed in the last {health.periodDays} days.</p> : null}
      {health.providers.map((provider) => (
        <Provider health={provider} copy={copy} key={provider.provider} />
      ))}
    </main>
  );
}
