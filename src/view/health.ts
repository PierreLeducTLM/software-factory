import type { FactoryConfig } from '../config/project-config.js';
import { parseComment, type Run, type TicketRecord } from '../record/ticket-record.js';
import type { ViewTicket } from './model.js';

export type HealthOptions = {
  readonly config: FactoryConfig;
  readonly now: string;
  readonly repository: string;
  readonly periodDays: number;
};

type Level = 'low' | 'medium' | 'high';

export type LevelHealth = {
  readonly level: Level;
  readonly merged: number;
  readonly mergedAsIs: number;
  readonly changed: number;
  readonly reverted: number;
  readonly streak: number;
  readonly threshold: number;
  readonly suggestion?: string;
};

export type ProviderHealth = {
  readonly provider: string;
  readonly merged: number;
  readonly firstPassRate?: number;
  readonly averageAttempts?: number;
  readonly sendBacks: number;
  readonly blocked: number;
  readonly failures: readonly { readonly gate: string; readonly count: number }[];
  readonly stations: readonly { readonly name: string; readonly medianSeconds: number }[];
  readonly levels: readonly LevelHealth[];
};

export type Health = { readonly periodDays: number; readonly providers: readonly ProviderHealth[] };

type Merged = { readonly record: TicketRecord; readonly index: number; readonly run: Run; readonly at: string; readonly level: Level | undefined };

const LEVELS: readonly Level[] = ['low', 'medium', 'high'];
const MS_PER_DAY = 86_400_000;
const REVERT_WINDOW_DAYS = 14;
const WAITING_FOR_MERGE = 'waiting for merge';

const recordOf = (ticket: ViewTicket, repository: string): TicketRecord | undefined => {
  const parsed = ticket.factoryComment === undefined ? undefined : parseComment(ticket.factoryComment, { trustEdited: false });
  return parsed?.status === 'ok' && parsed.record.repository === repository ? parsed.record : undefined;
};

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.slice(Math.ceil(sorted.length / 2) - 1, Math.floor(sorted.length / 2) + 1);
  return Math.round(middle.reduce((total, value) => total + value, 0) / middle.length);
};

const secondsBetween = (start: string, end: string): number => Math.round((Date.parse(end) - Date.parse(start)) / 1000);

const revertedSoon = ({ run, at }: Merged): boolean => run.revert !== undefined && Date.parse(run.revert.at) - Date.parse(at) <= REVERT_WINDOW_DAYS * MS_PER_DAY;

const agreed = (merged: Merged): boolean => merged.run.merge?.asIs === true && !revertedSoon(merged);

const levelHealth = (config: FactoryConfig, level: Level, merges: readonly Merged[]): LevelHealth => {
  const ofLevel = merges.filter((merged) => merged.level === level).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const firstDisagreement = ofLevel.findIndex((merged) => !agreed(merged));
  const streak = firstDisagreement === -1 ? ofLevel.length : firstDisagreement;
  const policy = config.risk[level];
  const automatic = policy.merge === 'auto' && !(policy.shadow ?? config.risk.shadow);
  return {
    level,
    merged: ofLevel.length,
    mergedAsIs: ofLevel.filter(({ run }) => run.merge?.asIs === true).length,
    changed: ofLevel.filter(({ run }) => run.merge?.asIs !== true).length,
    reverted: ofLevel.filter(revertedSoon).length,
    streak,
    threshold: config.risk.shadow_threshold,
    ...(streak >= config.risk.shadow_threshold && !automatic ? { suggestion: `/factory-workflow enable auto-merge for ${level} risk` } : {}),
  };
};

const providerHealth = (provider: string, records: readonly TicketRecord[], { config, now, periodDays }: HealthOptions): ProviderHealth => {
  const from = Date.parse(now) - periodDays * MS_PER_DAY;
  const inPeriod = (at: string): boolean => Date.parse(at) >= from;
  const merges = records.flatMap((record): readonly Merged[] => {
    const index = record.runs.findIndex((run) => run.merge?.at !== undefined && inPeriod(run.merge.at));
    const run = record.runs[index];
    const at = run?.merge?.at;
    return run === undefined || at === undefined ? [] : [{ record, index, run, at, level: run.risk?.level }];
  });
  const events = records.flatMap((record) => record.events).filter((event) => inPeriod(event.at));
  const runs = records.flatMap((record) => record.runs).filter((run) => inPeriod(run.startedAt));
  const failed = runs.flatMap((run) => run.attempts).flatMap((attempt) => attempt.outcomes).filter((outcome) => outcome.status === 'failed');
  const durations = [
    ...runs.flatMap((run) => run.steps).flatMap((step) => (step.endedAt === undefined ? [] : [{ name: step.name, seconds: secondsBetween(step.startedAt, step.endedAt) }])),
    ...merges.flatMap(({ run, at }) => {
      const opened = run.steps.at(-1)?.endedAt;
      return opened === undefined ? [] : [{ name: WAITING_FOR_MERGE, seconds: secondsBetween(opened, at) }];
    }),
  ];
  const attempts = merges.reduce((total, { record }) => total + record.runs.reduce((sum, run) => sum + run.attempt, 0), 0);
  const firstPass = merges.filter(({ index, run }) => index === 0 && run.attempt === 1).length;

  return {
    provider,
    merged: merges.length,
    ...(merges.length === 0 ? {} : { firstPassRate: firstPass / merges.length, averageAttempts: attempts / merges.length }),
    sendBacks: events.filter((event) => event.type === 'sent_back').length,
    blocked: events.filter((event) => event.type === 'run_ended' && event.detail === 'blocked').length,
    failures: [...new Set(failed.map((outcome) => outcome.id))]
      .map((gate) => ({ gate, count: failed.filter((outcome) => outcome.id === gate).length }))
      .toSorted((a, b) => b.count - a.count || a.gate.localeCompare(b.gate)),
    stations: [...new Set(durations.map(({ name }) => name))].map((name) => ({ name, medianSeconds: median(durations.filter((duration) => duration.name === name).map(({ seconds }) => seconds)) })),
    levels: LEVELS.map((level) => levelHealth(config, level, merges)),
  };
};

export const buildHealth = (tickets: readonly ViewTicket[], options: HealthOptions): Health => {
  const known = tickets.flatMap((ticket) => {
    const record = recordOf(ticket, options.repository);
    return record === undefined ? [] : [{ provider: ticket.provider, record }];
  });
  return {
    periodDays: options.periodDays,
    providers: [...new Set(tickets.map((ticket) => ticket.provider))].map((provider) =>
      providerHealth(provider, known.filter((entry) => entry.provider === provider).map(({ record }) => record), options),
    ),
  };
};
