import { createInMemoryAgentRuntime } from '../../src/adapters/in-memory-agent-runtime.js';
import { createInMemorySourceControl } from '../../src/adapters/in-memory-source-control.js';
import { createInMemoryTicketProvider } from '../../src/adapters/in-memory-ticket-provider.js';
import type { SourceControl } from '../../src/adapters/source-control.js';
import type { Ticket } from '../../src/adapters/ticket-provider.js';
import { parseFactoryConfig, type FactoryConfig } from '../../src/config/project-config.js';
import { advance, type AdvanceInput, type LoopDeps } from '../../src/factory/build-loop.js';
import type { ScriptRun } from '../../src/factory/checks.js';
import { approve } from '../../src/factory/refinement.js';
import { runTicket } from '../../src/factory/run-lifecycle.js';
import { loadRecord } from '../../src/record/record-store.js';
import type { TicketRecord } from '../../src/record/ticket-record.js';
import { getMockTicket } from '../contracts/ticket-provider-contract.js';

export const DEFAULT_RISK = 'risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [src/auth/**] }';

export const getConfig = (attempts = 5, risk = DEFAULT_RISK): FactoryConfig => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
limits: { attempts: ${attempts}, runs: 3 }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm test }
  - { id: lint, station: quality, kind: script, blocking: false, timeout: 90s, run: pnpm lint }
  - { id: security-scan, station: review, kind: script, blocking: true, timeout: 5m, run: pnpm audit }
  - { id: risk-notes, station: risk, kind: agent, blocking: true, timeout: 5m, criteria: .factory/checks/risk.md, evidence: notes }
  - { id: ui-design, station: review, kind: agent, blocking: true, timeout: 10m, applies_when: "changed: src/ui/**", criteria: .factory/checks/ui-design.md, evidence: screenshots }
${risk}
`);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
};

const SPEC_FILES: Readonly<Record<string, string>> = {
  'proposal.md': '# Proposal\n\n## Affected paths\n- `src/billing/**`\n',
  'design.md': '# Design\n\n## Decisions\n- D-001: chunks.\n',
  'tasks.md': '# Tasks\n\n- [ ] 1.1 Add the exporter and verify the test passes\n',
  'specs__billing__spec.md': '# Spec Delta\n',
};

export const PASS = JSON.stringify({ verdict: 'pass', findings: [], evidence: [] });
export const fail = (...findings: readonly string[]): string => JSON.stringify({ verdict: 'fail', findings, evidence: [] });
export const FAILING: ScriptRun = { exitCode: 1, output: 'export.test.ts › splits files: expected 2, got 1', timedOut: false };
export const BUILT: AdvanceInput = { built: { changed: 'Added the exporter', decisions: ['D-001'] } };

export type WorldOptions = {
  readonly attempts?: number;
  readonly changedFiles?: readonly string[];
  readonly risk?: string;
  readonly labels?: readonly string[];
  readonly lines?: number;
  readonly ceiling?: 'human';
  readonly others?: readonly Ticket[];
  readonly refuseAutoMerge?: Error | string;
  readonly specs?: Readonly<Record<string, string>>;
  readonly commits?: Readonly<Record<string, string>>;
};

export const getWorld = async (options?: WorldOptions) => {
  const clock = { seconds: 0 };
  const now = (): string => new Date(Date.UTC(2026, 10, 21, 8, 0, clock.seconds)).toISOString().replace('.000Z', 'Z');
  const tickets = createInMemoryTicketProvider({ tickets: [getMockTicket({ status: 'Spec review', labels: options?.labels ?? [] }), ...(options?.others ?? [])], now });
  await Object.entries({ ...SPEC_FILES, ...options?.specs }).reduce(async (previous, [name, content]) => {
    await previous;
    await tickets.addAttachment({ key: 'PAY-142', name, content });
  }, Promise.resolve());
  const { sourceControl: memory, world: git } = createInMemorySourceControl({ now });
  const refusal = options?.refuseAutoMerge;
  const sourceControl: SourceControl =
    refusal === undefined
      ? memory
      : {
          ...memory,
          enableAutoMerge: async () => {
            throw refusal;
          },
        };
  const scripts: Record<string, ScriptRun[]> = {};
  const commands: string[] = [];
  const pushes: string[] = [];
  const commits: Record<string, string> = { ...options?.commits };
  const changedOnMain: string[] = [];
  const deps: LoopDeps = {
    tickets,
    runtime: createInMemoryAgentRuntime({ worktree: { id: 'wt-1', path: '/work/pay-142', branch: 'factory/pay-142', host: 'pierre-mbp' } }),
    config: getConfig(options?.attempts, options?.risk),
    user: 'pierre',
    now,
    recordBudget: 100_000,
    machine: 'pierre-mbp',
    validateSpec: async () => [],
    predictRisk: async () => 'low',
    mainCommit: async () => 'a41c9e2',
    changedFilesSince: async () => changedOnMain,
    sourceControl,
    runScript: async (command) => {
      commands.push(command);
      clock.seconds += 10;
      return scripts[command]?.shift() ?? { exitCode: 0, output: 'ok', timedOut: false };
    },
    sleep: async () => undefined,
    changedFilesOnBranch: async () => options?.changedFiles ?? ['src/billing/export.ts'],
    linesChangedOnBranch: async () => options?.lines ?? 40,
    commitMessage: async (commit) => commits[commit] ?? `Commit ${commit}`,
    pushBranch: async (branch) => {
      pushes.push(branch);
      git.push(branch, `commit-${pushes.length}`);
    },
  };
  await approve(deps, 'PAY-142', options?.ceiling === undefined ? {} : { mergeCeiling: options.ceiling });
  await runTicket(deps, 'PAY-142');
  const record = async (): Promise<TicketRecord> => {
    const loaded = await loadRecord(tickets, 'PAY-142');
    if (loaded.status !== 'ok') throw new Error(`no record: ${loaded.status}`);
    return loaded.record;
  };
  return {
    deps,
    tickets,
    sourceControl,
    git,
    commits,
    clock,
    scripts,
    commands,
    pushes,
    changedOnMain,
    record,
    status: async () => (await tickets.getTicket('PAY-142'))?.status,
    step: (input: AdvanceInput = {}) => advance(deps, 'PAY-142', input),
    summary: async () => (await tickets.getFactoryComment('PAY-142'))?.split('\n')[0],
  };
};

export type World = Awaited<ReturnType<typeof getWorld>>;

export const reachReview = async (world: World) => {
  await world.step();
  await world.step(BUILT);
  return world.step({ verdicts: { 'openspec-verify': PASS } });
};

