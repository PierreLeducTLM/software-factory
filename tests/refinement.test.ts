import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInMemoryAgentRuntime } from '../src/adapters/in-memory-agent-runtime.js';
import type { CommandRunner } from '../src/adapters/orca-agent-runtime.js';
import { createSpecValidator } from '../src/cli/inputs.js';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import type { Ticket, TicketProvider } from '../src/adapters/ticket-provider.js';
import { parseFactoryConfig, type FactoryConfig } from '../src/config/project-config.js';
import {
  approve,
  approvalPreview,
  pullSpecFiles,
  pushSpecFiles,
  refinementStatus,
  revalidate,
  runReadyGate,
  startRefinement,
  type RefinementDeps,
} from '../src/factory/refinement.js';
import { runTicket } from '../src/factory/run-lifecycle.js';
import { loadRecord } from '../src/record/record-store.js';
import { createRecord, renderComment, type TicketRecord } from '../src/record/ticket-record.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const getConfig = (overrides?: { readonly lowMerge?: 'auto' | 'human'; readonly shadow?: boolean }): FactoryConfig => {
  const parsed = parseFactoryConfig(`
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks: []
risk:
  low: { merge: ${overrides?.lowMerge ?? 'auto'} }
  medium: { merge: human }
  high: { merge: human }
  sensitive_paths: []
  shadow: ${overrides?.shadow ?? true}
`);
  if (!parsed.ok) throw new Error('invalid test config');
  return parsed.value;
};

const SPEC_FILES: Readonly<Record<string, string>> = {
  'proposal.md': '# Proposal\n\n## Why\nExport invoices in bulk.\n\n## Affected paths\n- `src/billing/**`\n- src/export/csv.ts\n',
  'design.md': '# Design\n\n## Decisions\n- D-001: chunks of 10,000 rows.\n\n## Open Questions\nNone\n',
  'tasks.md': '# Tasks\n\n## 1. Export\n- [ ] 1.1 Add the exporter and verify the chunking test passes\n- [ ] 1.2 Wire the endpoint; verified by the API test\n',
  'specs__billing__spec.md': '# Spec Delta\n\n## ADDED Requirements\n### Requirement: Bulk export\nThe system SHALL export.\n',
};

type World = { readonly tickets: TicketProvider; readonly clock: { now: string }; readonly changedOnMain: string[] };

const getWorld = async (ticket: Ticket, files: Readonly<Record<string, string>> = SPEC_FILES): Promise<World> => {
  const clock = { now: '2026-11-20T15:00:00Z' };
  const tickets = createInMemoryTicketProvider({ tickets: [ticket], now: () => clock.now });
  await Object.entries(files).reduce(
    async (previous, [name, content]) => {
      await previous;
      await tickets.addAttachment({ key: ticket.key, name, content });
    },
    Promise.resolve(),
  );
  return { tickets, clock, changedOnMain: [] };
};

const depsFor = (world: World, overrides?: Partial<RefinementDeps>): RefinementDeps => ({
  tickets: world.tickets,
  runtime: createInMemoryAgentRuntime({ worktree: { id: 'wt-1', path: '/work/pay-142', branch: 'factory/pay-142', host: 'pierre-mbp' } }),
  config: getConfig(),
  user: 'pierre',
  now: () => world.clock.now,
  recordBudget: 100_000,
  machine: 'pierre-mbp',
  validateSpec: async () => [],
  predictRisk: async () => 'low',
  mainCommit: async () => 'a41c9e2',
  changedFilesSince: async () => world.changedOnMain,
  ...overrides,
});

const recordOf = async (world: World): Promise<TicketRecord> => {
  const loaded = await loadRecord(world.tickets, 'PAY-142');
  if (loaded.status !== 'ok') throw new Error(`no record: ${loaded.status}`);
  return loaded.record;
};

const statusOf = async (world: World): Promise<string | undefined> => (await world.tickets.getTicket('PAY-142'))?.status;

const toRefine = (): Ticket => getMockTicket({ status: 'To refine' });
const inSpecReview = (): Ticket => getMockTicket({ status: 'Spec review' });

const summaryOf = async (world: World): Promise<string | undefined> => (await world.tickets.getFactoryComment('PAY-142'))?.split('\n')[0];

const gateWith = async (files: Readonly<Record<string, string>>) => {
  const world = await getWorld(inSpecReview(), { ...SPEC_FILES, ...files });
  const result = await runReadyGate(depsFor(world), 'PAY-142');
  return result.ok ? result.findings : ['refused'];
};

const DECISIONS = '# Design\n\n## Decisions\n- D-001: chunks.\n';

const getApprovedWorld = async (): Promise<World> => {
  const world = await getWorld(inSpecReview());
  await runReadyGate(depsFor(world), 'PAY-142');
  world.clock.now = '2026-11-20T16:00:00Z';
  await approve(depsFor(world), 'PAY-142');
  return world;
};

const getRunningWorld = async (): Promise<World> => {
  const world = await getApprovedWorld();
  world.clock.now = '2026-11-21T08:00:00Z';
  await runTicket(depsFor(world), 'PAY-142');
  return world;
};

describe('starting refinement', () => {
  it('moves a ticket with attached spec files to Spec review and creates its record', async () => {
    const world = await getWorld(toRefine());

    const result = await startRefinement(depsFor(world), 'PAY-142');

    const record = await recordOf(world);
    expect(result).toEqual({ ok: true });
    expect(await statusOf(world)).toBe('Spec review');
    expect(record.state).toBe('spec_review');
    expect(record.repository).toBe('acme/billing-service');
    expect(record.runs).toEqual([]);
  });

  it('refuses a ticket with no spec files attached, even with a description, and leaves its status alone', async () => {
    const world = await getWorld(toRefine(), {});

    const result = await startRefinement(depsFor(world), 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'no_spec', message: 'PAY-142 has no OpenSpec files attached. A draft spec is required' });
    expect(await statusOf(world)).toBe('To refine');
    expect(await world.tickets.getFactoryComment('PAY-142')).toBeUndefined();
  });

  it('does not count attachments that are not markdown as spec files', async () => {
    const world = await getWorld(toRefine(), { 'screenshot.png': 'binary', 'factory-record-archive-1.json': '{}' });

    expect((await startRefinement(depsFor(world), 'PAY-142')).ok).toBe(false);
  });

  it('keeps the existing record and status when a sent-back ticket is refined again', async () => {
    const world = await getWorld(inSpecReview());
    await runReadyGate(depsFor(world), 'PAY-142');
    const before = await recordOf(world);

    await startRefinement(depsFor(world), 'PAY-142');

    const after = await recordOf(world);
    expect(await statusOf(world)).toBe('Spec review');
    expect(after.refinement.readyGate).toEqual(before.refinement.readyGate);
    expect(after.state).toBe('spec_review');
  });

  it('records the move to Spec review once, however often refinement is started', async () => {
    const world = await getWorld(toRefine());

    await startRefinement(depsFor(world), 'PAY-142');
    await startRefinement(depsFor(world), 'PAY-142');

    expect((await recordOf(world)).events.filter((event) => event.type === 'state')).toHaveLength(1);
  });

  it('refuses a preview or a revalidation on a ticket with no spec files', async () => {
    const world = await getWorld(inSpecReview(), {});

    expect(await approvalPreview(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'no_spec' });
    expect(await revalidate(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'no_spec' });
  });

  it('refuses a ticket that does not exist', async () => {
    const world = await getWorld(toRefine());

    expect(await startRefinement(depsFor(world), 'PAY-999')).toEqual({ ok: false, reason: 'not_found', message: 'PAY-999 does not exist' });
  });
});

describe('ready gate', () => {
  it('passes a complete spec, creating the record at the first refine session', async () => {
    const world = await getWorld(inSpecReview());

    const result = await runReadyGate(depsFor(world), 'PAY-142');

    const record = await recordOf(world);
    expect(result).toEqual({ ok: true, passed: true, findings: [] });
    expect(record.schema).toBe(1);
    expect(record.runs).toEqual([]);
    expect(record.refinement.readyGate).toMatchObject({ passed: true, findings: [], at: '2026-11-20T15:00:00Z' });
    expect(record.refinement.readyGate?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await statusOf(world)).toBe('Spec review');
  });

  it('fails a spec containing a TBD marker, naming where each one is', async () => {
    const world = await getWorld(inSpecReview(), {
      ...SPEC_FILES,
      'design.md': '# Design\n\n## Decisions\n- D-001: TBD\n\nRetries: TBD.\n',
    });

    const result = await runReadyGate(depsFor(world), 'PAY-142');

    expect(result).toEqual({ ok: true, passed: false, findings: ['design.md:4 contains a TBD marker', 'design.md:6 contains a TBD marker'] });
    expect((await recordOf(world)).refinement.readyGate?.passed).toBe(false);
    expect(await statusOf(world)).toBe('Spec review');
  });

  it('does not mistake a word that merely contains TBD for a marker', async () => {
    const world = await getWorld(inSpecReview(), { ...SPEC_FILES, 'proposal.md': `${SPEC_FILES['proposal.md']}\nSee the TBDX library.\n` });

    expect(await runReadyGate(depsFor(world), 'PAY-142')).toMatchObject({ passed: true });
  });

  it.each([
    ['proposal.md', ['proposal.md is not attached', 'No Affected paths section lists a path']],
    ['design.md', ['design.md is not attached']],
    ['tasks.md', ['tasks.md is not attached']],
    ['specs__billing__spec.md', ['No delta spec is attached (specs__<capability>__spec.md)']],
  ] as const)('fails when %s is missing', async (missing, findings) => {
    const { [missing]: _removed, ...rest } = SPEC_FILES;
    const world = await getWorld(inSpecReview(), rest);

    const result = await runReadyGate(depsFor(world), 'PAY-142');

    expect(result.ok && result.findings).toEqual(findings);
    expect(result.ok && result.passed).toBe(false);
  });

  it('fails a design with no Decisions section', async () => {
    const world = await getWorld(inSpecReview(), { ...SPEC_FILES, 'design.md': '# Design\n\n## Context\nNothing decided.\n' });

    expect(await runReadyGate(depsFor(world), 'PAY-142')).toEqual({ ok: true, passed: false, findings: ['design.md has no Decisions section'] });
  });

  it('fails when no Affected paths section lists a path', async () => {
    const world = await getWorld(inSpecReview(), { ...SPEC_FILES, 'proposal.md': '# Proposal\n\n## Affected paths\n\nTo be listed.\n\n## Impact\n- `src/other/**`\n' });

    expect(await runReadyGate(depsFor(world), 'PAY-142')).toEqual({ ok: true, passed: false, findings: ['No Affected paths section lists a path'] });
  });

  it('fails a design that still has open questions', async () => {
    const world = await getWorld(inSpecReview(), {
      ...SPEC_FILES,
      'design.md': '# Design\n\n## Decisions\n- D-001: chunks.\n\n## Open Questions\n- Which currency for mixed invoices?\n',
    });

    expect(await runReadyGate(depsFor(world), 'PAY-142')).toEqual({ ok: true, passed: false, findings: ['design.md still has open questions'] });
  });

  it('accepts an Open Questions section that is empty, and a design with none', async () => {
    const empty = await getWorld(inSpecReview(), { ...SPEC_FILES, 'design.md': '# Design\n\n## Decisions\n- D-001: chunks.\n\n## Open Questions\n\n## Risks\n- Slow exports.\n' });
    const none = await getWorld(inSpecReview(), { ...SPEC_FILES, 'design.md': '# Design\n\n## Decisions\n- D-001: chunks.\n' });

    expect(await runReadyGate(depsFor(empty), 'PAY-142')).toMatchObject({ passed: true });
    expect(await runReadyGate(depsFor(none), 'PAY-142')).toMatchObject({ passed: true });
  });

  it('fails a task that does not say how it is verified, and a task list with no tasks', async () => {
    const unverifiable = await getWorld(inSpecReview(), { ...SPEC_FILES, 'tasks.md': '# Tasks\n\n- [ ] 1.1 Add the exporter and verify the test passes\n- [x] 1.2 Wire the endpoint\n' });
    const noTasks = await getWorld(inSpecReview(), { ...SPEC_FILES, 'tasks.md': '# Tasks\n\nComing soon.\n' });

    expect(await runReadyGate(depsFor(unverifiable), 'PAY-142')).toEqual({ ok: true, passed: false, findings: ['tasks.md:4 does not say how it is verified'] });
    expect(await runReadyGate(depsFor(noTasks), 'PAY-142')).toEqual({ ok: true, passed: false, findings: ['tasks.md has no tasks'] });
  });

  it('fails when the spec itself is not valid, with the validator\'s findings', async () => {
    const world = await getWorld(inSpecReview());
    const seen: string[][] = [];
    const validateSpec: RefinementDeps['validateSpec'] = async (files) => {
      seen.push(files.map((file) => file.name));
      return ['specs/billing/spec.md: requirement "Bulk export" has no scenario'];
    };

    const result = await runReadyGate(depsFor(world, { validateSpec }), 'PAY-142');

    expect(result).toEqual({ ok: true, passed: false, findings: ['specs/billing/spec.md: requirement "Bulk export" has no scenario'] });
    expect(seen).toEqual([['design.md', 'proposal.md', 'specs__billing__spec.md', 'tasks.md']]);
  });

  it('fails with the finding of a delta that would not apply to the canonical specs on main', async () => {
    const world = await getWorld(inSpecReview());
    const refusal = 'Archive would refuse this delta: billing MODIFIED failed for header "### Requirement: Bulk export" - not found';
    const openspec: CommandRunner = async (_args, options) => {
      const checksCanonical = existsSync(join(options?.cwd ?? '', 'openspec/specs/billing/spec.md'));
      const issues = checksCanonical ? [{ level: 'INFO', path: 'billing/spec.md', message: refusal }] : [];
      return { stdout: JSON.stringify({ items: [{ id: 'candidate', valid: true, issues }] }) };
    };
    const validateSpec = createSpecValidator({ run: openspec, canonicalSpecs: async () => [{ path: 'billing/spec.md', content: '# billing Specification\n' }] });

    const result = await runReadyGate(depsFor(world, { validateSpec }), 'PAY-142');

    expect(result).toEqual({ ok: true, passed: false, findings: [`billing/spec.md: ${refusal}`] });
  });

  it('reads the newest copy when a spec file was attached again', async () => {
    const world = await getWorld(inSpecReview(), { ...SPEC_FILES, 'design.md': '# Design\n\n## Decisions\n- D-001: TBD\n' });
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'design.md', content: SPEC_FILES['design.md'] ?? '' });

    expect(await runReadyGate(depsFor(world), 'PAY-142')).toMatchObject({ passed: true });
  });

  it('refuses a ticket with no spec files attached', async () => {
    const world = await getWorld(inSpecReview(), {});

    expect(await runReadyGate(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'no_spec' });
  });
});

describe('how the ready gate reads spec files', () => {
  it('only counts a file named exactly specs__<capability>__spec.md as a delta spec', async () => {
    const { 'specs__billing__spec.md': _removed, ...rest } = SPEC_FILES;
    const world = await getWorld(inSpecReview(), { ...rest, 'notes-specs__billing__spec.md': 'x', 'specs__billing__spec.md.old.md': 'x' });

    const result = await runReadyGate(depsFor(world), 'PAY-142');

    expect(result.ok && result.findings).toEqual(['No delta spec is attached (specs__<capability>__spec.md)']);
  });

  it('counts an indented task, and not a line that merely mentions a checkbox', async () => {
    expect(await gateWith({ 'tasks.md': '# Tasks\n\n  - [ ] 1.1 Add the exporter\n' })).toEqual(['tasks.md:3 does not say how it is verified']);
    expect(await gateWith({ 'tasks.md': '# Tasks\nUse - [ ] marks below\n- [ ] 1.1 Add it and verify the test passes\n' })).toEqual([]);
  });

  it('reads an indented path with extra spaces, and not a sentence with a dash in it', async () => {
    expect(await gateWith({ 'proposal.md': '# Proposal\n\n## Affected paths\n  -   `src/billing/**`\n' })).toEqual([]);
    expect(await gateWith({ 'proposal.md': '# Proposal\n\n## Affected paths\nPaths - none yet\n' })).toEqual(['No Affected paths section lists a path']);
  });

  it('reads a path on the last line of a file, and one after a line that mentions a heading marker', async () => {
    expect(await gateWith({ 'proposal.md': '# Proposal\n\n## Affected paths\n- `src/billing/**`' })).toEqual([]);
    expect(await gateWith({ 'proposal.md': '# Proposal\n\n## Affected paths\nSee the ## Impact part too\n- `src/billing/**`\n' })).toEqual([]);
  });

  it('only treats a line that starts with the heading as the section', async () => {
    expect(await gateWith({ 'proposal.md': '# Proposal\n\nThere is no ## Affected paths section\n- `src/billing/**`\n' })).toEqual(['No Affected paths section lists a path']);
    expect(await gateWith({ 'design.md': '# Design\n\nAs said under ## Decisions elsewhere.\n' })).toEqual(['design.md has no Decisions section']);
    expect(await gateWith({ 'design.md': `${DECISIONS}\nThe ## Open Questions heading was removed\n- leftover bullet\n` })).toEqual([]);
  });

  it('accepts "None" with spaces around it, but not a sentence that contains the word', async () => {
    expect(await gateWith({ 'design.md': `${DECISIONS}\n## Open Questions\n   \n  None.  \n` })).toEqual([]);
    expect(await gateWith({ 'design.md': `${DECISIONS}\n## Open Questions\nNone of these are settled\n` })).toEqual(['design.md still has open questions']);
    expect(await gateWith({ 'design.md': `${DECISIONS}\n## Open Questions\nProbably none\n` })).toEqual(['design.md still has open questions']);
  });
});

describe('what refinement writes for people', () => {
  it('summarises each step at the top of the factory comment', async () => {
    const world = await getWorld(toRefine());
    const seen: (string | undefined)[] = [];

    await startRefinement(depsFor(world), 'PAY-142');
    seen.push(await summaryOf(world));
    await runReadyGate(depsFor(world), 'PAY-142');
    seen.push(await summaryOf(world));
    await approve(depsFor(world), 'PAY-142');
    seen.push(await summaryOf(world));

    expect(seen).toEqual(['Refinement started', 'Ready gate passed', 'Approved by pierre · Low risk, would auto-merge']);
  });

  it('says the gate failed, whether it was run directly or by an approval', async () => {
    const broken = { 'design.md': '# Design\n\n## Context\nTBD\n' };
    const direct = await getWorld(inSpecReview(), { ...SPEC_FILES, ...broken });
    const viaApproval = await getWorld(inSpecReview(), { ...SPEC_FILES, ...broken });

    await runReadyGate(depsFor(direct), 'PAY-142');
    const refused = await approve(depsFor(viaApproval), 'PAY-142');

    expect(await summaryOf(direct)).toBe('Ready gate failed');
    expect(await summaryOf(viaApproval)).toBe('Ready gate failed');
    expect(refused).toMatchObject({ message: 'The ready gate fails: design.md:4 contains a TBD marker; design.md has no Decisions section' });
  });

  it('says the ticket was sent back', async () => {
    const world = await getRunningWorld();
    world.changedOnMain.push('src/billing/a.ts', 'src/billing/b.ts');

    const result = await revalidate(depsFor(world), 'PAY-142');

    expect(await summaryOf(world)).toBe('Sent back to refinement');
    expect(result).toMatchObject({ findings: ['Changed on main since approval: src/billing/a.ts, src/billing/b.ts'] });
  });
});

describe('approval', () => {
  it('leaves the merge ceiling out of the stamp when none is set', async () => {
    const world = await getApprovedWorld();

    expect('mergeCeiling' in ((await recordOf(world)).refinement.approval ?? {})).toBe(false);
  });

  it('treats a record that is not a factory record as edited', async () => {
    const world = await getWorld(inSpecReview());
    const forged = renderComment({ record: { ...createRecord({ repository: 'x' }), schema: 2 } as unknown as TicketRecord, summary: 'x' });
    await world.tickets.putFactoryComment('PAY-142', forged);

    expect(await approve(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'record_edited' });
  });

  it('does not try to move a ticket that is already in Spec review when refinement starts again', async () => {
    const world = await getWorld(inSpecReview());
    const moves: string[] = [];
    const tickets: TicketProvider = {
      ...world.tickets,
      transition: async (request) => {
        moves.push(request.to);
        return world.tickets.transition(request);
      },
    };

    await startRefinement(depsFor(world, { tickets }), 'PAY-142');

    expect(moves).toEqual([]);
  });

  it('writes the approval stamp, shows the merge route and moves the ticket to Ready for Dev', async () => {
    const world = await getWorld(inSpecReview());
    const gate = await runReadyGate(depsFor(world), 'PAY-142');
    world.clock.now = '2026-11-20T16:00:00Z';

    const result = await approve(depsFor(world), 'PAY-142');

    const record = await recordOf(world);
    expect(gate).toMatchObject({ passed: true });
    expect(result).toEqual({ ok: true, risk: 'low', route: 'Low risk, would auto-merge' });
    expect(await statusOf(world)).toBe('Ready for Dev');
    expect(record.state).toBe('ready_for_dev');
    expect(record.refinement.approval).toEqual({
      approver: 'pierre',
      at: '2026-11-20T16:00:00Z',
      mainCommit: 'a41c9e2',
      fingerprint: record.refinement.readyGate?.fingerprint,
      predictedRisk: 'low',
    });
  });

  it.each([
    [{ shadow: true }, 'low', 'Low risk, would auto-merge'],
    [{ shadow: false }, 'low', 'Low risk, will auto-merge'],
    [{ lowMerge: 'human' as const }, 'low', 'Low risk, merged by a person'],
    [{}, 'medium', 'Medium risk, merged by a person'],
    [{}, 'high', 'High risk, merged by a person'],
  ] as const)('states the merge route before anything is recorded (%o, %s)', async (config, risk, route) => {
    const world = await getWorld(inSpecReview());
    await runReadyGate(depsFor(world), 'PAY-142');
    const before = await world.tickets.getFactoryComment('PAY-142');

    const preview = await approvalPreview(depsFor(world, { config: getConfig(config), predictRisk: async () => risk }), 'PAY-142');

    expect(preview).toEqual({ ok: true, risk, route });
    expect(await world.tickets.getFactoryComment('PAY-142')).toBe(before);
    expect(await statusOf(world)).toBe('Spec review');
  });

  it('stores a merge ceiling and says a person will merge', async () => {
    const world = await getWorld(inSpecReview());
    await runReadyGate(depsFor(world), 'PAY-142');

    const result = await approve(depsFor(world), 'PAY-142', { mergeCeiling: 'human' });

    expect(result).toEqual({ ok: true, risk: 'low', route: 'Low risk, merged by a person' });
    expect((await recordOf(world)).refinement.approval?.mergeCeiling).toBe('human');
  });

  it('reruns the ready gate when the spec changed since the last run, and refuses if it now fails', async () => {
    const world = await getWorld(inSpecReview());
    await runReadyGate(depsFor(world), 'PAY-142');
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'design.md', content: '# Design\n\n## Decisions\n- D-001: TBD\n' });

    const result = await approve(depsFor(world), 'PAY-142');

    const record = await recordOf(world);
    expect(result).toEqual({ ok: false, reason: 'not_ready', message: 'The ready gate fails: design.md:4 contains a TBD marker' });
    expect(record.refinement.readyGate?.passed).toBe(false);
    expect(record.refinement.approval).toBeUndefined();
    expect(await statusOf(world)).toBe('Spec review');
  });

  it('reruns a ready gate that failed last time, and approves if it now passes', async () => {
    const world = await getWorld(inSpecReview(), { ...SPEC_FILES, 'design.md': '# Design\n\n## Decisions\n- D-001: TBD\n' });
    await runReadyGate(depsFor(world), 'PAY-142');
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'design.md', content: SPEC_FILES['design.md'] ?? '' });

    expect(await approve(depsFor(world), 'PAY-142')).toMatchObject({ ok: true });
    expect((await recordOf(world)).refinement.readyGate?.passed).toBe(true);
  });

  it('does not rerun a gate that passed on the same spec', async () => {
    const world = await getWorld(inSpecReview());
    const calls = { count: 0 };
    const validateSpec: RefinementDeps['validateSpec'] = async () => {
      calls.count += 1;
      return [];
    };
    await runReadyGate(depsFor(world, { validateSpec }), 'PAY-142');

    await approve(depsFor(world, { validateSpec }), 'PAY-142');

    expect(calls.count).toBe(1);
  });

  it('runs the gate itself when it was never run', async () => {
    const world = await getWorld(inSpecReview());

    expect(await approve(depsFor(world), 'PAY-142')).toMatchObject({ ok: true });
    expect((await recordOf(world)).refinement.readyGate?.passed).toBe(true);
  });

  it('refuses a ticket that is not in Spec review, writing no stamp', async () => {
    const world = await getWorld(getMockTicket({ status: 'To refine' }));
    await runReadyGate(depsFor(world), 'PAY-142');

    const result = await approve(depsFor(world), 'PAY-142');

    expect(result).toEqual({ ok: false, reason: 'not_in_spec_review', message: 'PAY-142 is in "To refine", not "Spec review"' });
    expect((await recordOf(world)).refinement.approval).toBeUndefined();
  });

  it('refuses a record edited by hand', async () => {
    const world = await getWorld(inSpecReview());
    await runReadyGate(depsFor(world), 'PAY-142');
    const comment = (await world.tickets.getFactoryComment('PAY-142')) ?? '';
    await world.tickets.putFactoryComment('PAY-142', comment.replace('"passed":true', '"passed":false'));

    expect(await approve(depsFor(world), 'PAY-142')).toEqual({ ok: false, reason: 'record_edited', message: 'The record on PAY-142 was edited outside the factory' });
    expect(await runReadyGate(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'record_edited' });
    expect(await startRefinement(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'record_edited' });
  });
});

describe('moving spec files between the ticket and a folder', () => {
  it('pulls the newest copy of each attached spec file', async () => {
    const world = await getWorld(inSpecReview());
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'design.md', content: 'newer design' });
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'screenshot.png', content: 'binary' });

    const pulled = await pullSpecFiles(depsFor(world), 'PAY-142');

    expect(pulled.ok && pulled.files.map((file) => file.name)).toEqual(['design.md', 'proposal.md', 'specs__billing__spec.md', 'tasks.md']);
    expect(pulled.ok && pulled.files[0]?.content).toBe('newer design');
  });

  it('refuses to pull from a ticket with no spec files', async () => {
    const world = await getWorld(inSpecReview(), {});

    expect(await pullSpecFiles(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'no_spec' });
  });

  it('attaches only the files that changed or are new', async () => {
    const world = await getWorld(inSpecReview());
    const files = [
      { name: 'design.md', content: 'edited design' },
      { name: 'proposal.md', content: SPEC_FILES['proposal.md'] ?? '' },
      { name: 'specs__export__spec.md', content: 'new delta' },
    ];

    const pushed = await pushSpecFiles(depsFor(world), 'PAY-142', files);

    const pulled = await pullSpecFiles(depsFor(world), 'PAY-142');
    expect(pushed).toEqual({ ok: true, attached: ['design.md', 'specs__export__spec.md'] });
    expect((await world.tickets.listAttachments('PAY-142')).length).toBe(Object.keys(SPEC_FILES).length + 2);
    expect(pulled.ok && pulled.files.find((file) => file.name === 'design.md')?.content).toBe('edited design');
  });

  it('attaches draft files to a ticket that has none yet', async () => {
    const world = await getWorld(toRefine(), {});

    const pushed = await pushSpecFiles(depsFor(world), 'PAY-142', [{ name: 'proposal.md', content: 'draft' }]);

    expect(pushed).toEqual({ ok: true, attached: ['proposal.md'] });
  });

  it('never treats the factory\'s own attachments as spec files', async () => {
    const world = await getWorld(inSpecReview());
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'factory-failure-report-run-1.md', content: '# Failure report' });

    const pulled = await pullSpecFiles(depsFor(world), 'PAY-142');
    const pushed = await pushSpecFiles(depsFor(world), 'PAY-142', [{ name: 'factory-notes.md', content: 'x' }]);

    expect(pulled.ok && pulled.files.map((file) => file.name)).toEqual(['design.md', 'proposal.md', 'specs__billing__spec.md', 'tasks.md']);
    expect(pushed).toMatchObject({ ok: false, reason: 'no_spec', message: 'factory-notes.md is not a spec file. Spec files end in .md and do not start with factory-' });
  });

  it('refuses to push to a ticket that does not exist, or a file that is not markdown', async () => {
    const world = await getWorld(inSpecReview());

    expect(await pushSpecFiles(depsFor(world), 'PAY-999', [{ name: 'proposal.md', content: 'x' }])).toEqual({ ok: false, reason: 'not_found', message: 'PAY-999 does not exist' });
    expect(await pushSpecFiles(depsFor(world), 'PAY-142', [{ name: 'notes.txt', content: 'x' }])).toEqual({
      ok: false,
      reason: 'no_spec',
      message: 'notes.txt is not a spec file. Spec files end in .md and do not start with factory-',
    });
    expect((await world.tickets.listAttachments('PAY-142')).length).toBe(Object.keys(SPEC_FILES).length);
  });
});

describe('refinement status', () => {
  it('shows the state, the last gate, the approval and any questions from a send-back', async () => {
    const world = await getRunningWorld();
    world.changedOnMain.push('src/billing/rounding.ts');
    await revalidate(depsFor(world), 'PAY-142');

    const status = await refinementStatus(depsFor(world), 'PAY-142');

    expect(status).toEqual({
      ok: true,
      status: 'Spec review',
      gate: { passed: true, findings: [], current: true },
      approval: { approver: 'pierre', at: '2026-11-20T16:00:00Z', predictedRisk: 'low' },
      questions: [
        {
          question: 'These files changed on main after the spec was approved: src/billing/rounding.ts. Does the spec still hold?',
          recommended: 'Review the changes, update the spec if needed, and approve again.',
        },
      ],
    });
  });

  it('says the gate result is out of date once the spec files changed', async () => {
    const world = await getWorld(inSpecReview());
    await runReadyGate(depsFor(world), 'PAY-142');
    await pushSpecFiles(depsFor(world), 'PAY-142', [{ name: 'design.md', content: 'edited' }]);

    const status = await refinementStatus(depsFor(world), 'PAY-142');

    expect(status).toMatchObject({ ok: true, gate: { passed: true, current: false }, questions: [] });
    expect(status.ok && 'approval' in status).toBe(false);
  });

  it('shows a ticket the factory has not touched yet as having no gate, approval or questions', async () => {
    const world = await getWorld(toRefine());

    expect(await refinementStatus(depsFor(world), 'PAY-142')).toEqual({ ok: true, status: 'To refine', questions: [] });
  });

  it('refuses a ticket with no spec files', async () => {
    const world = await getWorld(toRefine(), {});

    expect(await refinementStatus(depsFor(world), 'PAY-142')).toMatchObject({ ok: false, reason: 'no_spec' });
  });
});

describe('revalidation at the start of development', () => {
  it('passes when the spec is unchanged and nothing relevant changed on main', async () => {
    const world = await getRunningWorld();
    world.changedOnMain.push('README.md', 'src/billingx/unrelated.ts', 'src/export/csv.test.ts');
    const asked: string[] = [];
    const changedFilesSince: RefinementDeps['changedFilesSince'] = async (commit) => {
      asked.push(commit);
      return world.changedOnMain;
    };

    const result = await revalidate(depsFor(world, { changedFilesSince }), 'PAY-142');

    expect(result).toEqual({ ok: true, passed: true, findings: [] });
    expect(asked).toEqual(['a41c9e2']);
    expect(await statusOf(world)).toBe('In development');
    expect((await recordOf(world)).runs[0]?.status).toBe('running');
  });

  it.each([
    ['src/billing/rounding.ts'],
    ['src/billing/deep/nested/rules.ts'],
    ['src/export/csv.ts'],
    ['openspec/specs/billing/spec.md'],
  ])('sends the ticket back when %s changed on main since approval', async (changed) => {
    const world = await getRunningWorld();
    world.changedOnMain.push('README.md', changed);
    world.clock.now = '2026-11-21T08:01:00Z';

    const result = await revalidate(depsFor(world), 'PAY-142');

    const record = await recordOf(world);
    expect(result).toEqual({ ok: true, passed: false, findings: [`Changed on main since approval: ${changed}`] });
    expect(await statusOf(world)).toBe('Spec review');
    expect(record.state).toBe('spec_review');
    expect(record.runs[0]?.status).toBe('sent_back');
    expect(record.refinement.sendBack).toEqual({
      at: '2026-11-21T08:01:00Z',
      questions: [
        {
          question: `These files changed on main after the spec was approved: ${changed}. Does the spec still hold?`,
          recommended: 'Review the changes, update the spec if needed, and approve again.',
        },
      ],
    });
  });

  it.each([
    ['src/export', 'src/export/csv/writer.ts', true],
    ['src/export', 'lib/src/export/writer.ts', false],
    ['src/*.config.ts', 'src/vite.config.ts', true],
    ['src/*.config.ts', 'src/viteXconfig.ts', false],
    ['src/*.config.ts', 'src/app/vite.config.ts', false],
  ])('watches %s: a change to %s is drift? %s', async (pattern, changed, drift) => {
    const base = await getWorld(inSpecReview(), { ...SPEC_FILES, 'proposal.md': `# Proposal\n\n## Affected paths\n- \`${pattern}\`\n` });
    await approve(depsFor(base), 'PAY-142');
    base.clock.now = '2026-11-21T08:00:00Z';
    await runTicket(depsFor(base), 'PAY-142');
    base.changedOnMain.push(changed);

    const result = await revalidate(depsFor(base), 'PAY-142');

    expect(result.ok && result.passed).toBe(!drift);
  });

  it('watches the canonical spec of a nested capability', async () => {
    const { 'specs__billing__spec.md': delta, ...rest } = SPEC_FILES;
    const base = await getWorld(inSpecReview(), { ...rest, 'specs__identity__user-auth__spec.md': delta ?? '' });
    await approve(depsFor(base), 'PAY-142');
    await runTicket(depsFor(base), 'PAY-142');
    base.changedOnMain.push('openspec/specs/identity/user-auth/spec.md');

    expect(await revalidate(depsFor(base), 'PAY-142')).toMatchObject({ passed: false });
  });

  it('sends the ticket back when the spec was edited after approval', async () => {
    const world = await getRunningWorld();
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'design.md', content: '# Design\n\n## Decisions\n- D-001: chunks of 500 rows.\n' });

    const result = await revalidate(depsFor(world), 'PAY-142');

    expect(result).toEqual({ ok: true, passed: false, findings: ['The approved spec changed after approval'] });
    expect(await statusOf(world)).toBe('Spec review');
    expect((await recordOf(world)).refinement.sendBack?.questions).toEqual([
      { question: 'The spec was edited after it was approved. Should the edited spec be built?', recommended: 'Run the ready gate and approve the edited spec.' },
    ]);
  });

  it('lets a new approval replace the stamp after a send-back, clearing the questions', async () => {
    const world = await getRunningWorld();
    world.changedOnMain.push('src/billing/rounding.ts');
    await revalidate(depsFor(world), 'PAY-142');
    const first = (await recordOf(world)).refinement.approval;
    await world.tickets.addAttachment({ key: 'PAY-142', name: 'design.md', content: '# Design\n\n## Decisions\n- D-001: chunks of 10,000 rows.\n- D-002: per-line rounding.\n' });
    world.clock.now = '2026-11-22T09:00:00Z';

    const result = await approve(depsFor(world, { mainCommit: async () => 'b52d0f3' }), 'PAY-142');

    const record = await recordOf(world);
    expect(result).toMatchObject({ ok: true });
    expect(record.refinement.approval?.mainCommit).toBe('b52d0f3');
    expect(record.refinement.approval?.fingerprint).not.toBe(first?.fingerprint);
    expect(record.refinement.sendBack).toBeUndefined();
    expect(await statusOf(world)).toBe('Ready for Dev');
  });

  it('refuses a ticket with no run in progress', async () => {
    const world = await getApprovedWorld();

    expect(await revalidate(depsFor(world), 'PAY-142')).toEqual({ ok: false, reason: 'no_run', message: 'PAY-142 has no run in progress' });
  });
});
