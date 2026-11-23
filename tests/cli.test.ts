import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryAgentRuntime } from '../src/adapters/in-memory-agent-runtime.js';
import { createInMemorySourceControl } from '../src/adapters/in-memory-source-control.js';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import type { Ticket } from '../src/adapters/ticket-provider.js';
import { parseAdaptersConfig, parseFactoryConfig } from '../src/config/project-config.js';
import { runCli } from '../src/cli/cli.js';
import { createSpecFolder } from '../src/cli/inputs.js';
import { createProjectViewSource, createRealDeps, createSampleViewSource, createSetupDeps } from '../src/cli/real-deps.js';
import type { SourceControl } from '../src/adapters/source-control.js';
import type { LoopDeps } from '../src/factory/build-loop.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const FACTORY_YAML = `
schema: 1
engine: 0.2.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
labels: { auto: factory-auto, no_automerge: "factory:no-automerge" }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm test }
risk:
  low: { merge: auto }
  medium: { merge: human }
  high: { merge: human }
  sensitive_paths: []
`;

const ADAPTERS_YAML = `
repository: acme/billing-service
ticket_providers:
  - kind: jira
    base_url: https://acme.atlassian.net
    filter: project = PAY
    token_env: JIRA_TOKEN
    email_env: JIRA_EMAIL
source_control: { kind: github, repo: acme/billing-service, token_env: GH_TOKEN }
agent_runtime: { kind: orca }
`;

const SPEC_FILES: Readonly<Record<string, string>> = {
  'proposal.md': '# Proposal\n\n## Affected paths\n- `src/billing/**`\n',
  'design.md': '# Design\n\n## Decisions\n- D-001: chunks.\n',
  'tasks.md': '# Tasks\n\n- [ ] 1.1 Add the exporter and verify the test passes\n',
  'specs__billing__spec.md': '# Spec Delta\n',
};

const getCli = async (ticket: Ticket, files: Readonly<Record<string, string>> = SPEC_FILES, yaml: string = FACTORY_YAML) => {
  const config = parseFactoryConfig(yaml);
  if (!config.ok) throw new Error('invalid test config');
  const tickets = createInMemoryTicketProvider({ tickets: [ticket], now: () => '2026-11-21T08:00:00Z' });
  await Object.entries(files).reduce(async (previous, [name, content]) => {
    await previous;
    await tickets.addAttachment({ key: ticket.key, name, content });
  }, Promise.resolve());
  const changedOnMain: string[] = [];
  const commits: Record<string, string> = {};
  const broken: { reason?: string; git?: string; revert?: string } = {};
  const scripts: ScriptRun[] = [];
  const verdictFiles: Record<string, string> = {};
  const { sourceControl: memory, world: git } = createInMemorySourceControl({ now: () => '2026-11-21T08:00:00Z' });
  const sourceControl: SourceControl = {
    ...memory,
    openRevertPullRequest: async (number) => {
      if (broken.revert !== undefined) throw new Error(broken.revert);
      return memory.openRevertPullRequest(number);
    },
  };
  const deps: LoopDeps = {
    sourceControl,
    runScript: async () => scripts.shift() ?? { exitCode: 0, output: 'ok', timedOut: false },
    sleep: async () => undefined,
    changedFilesOnBranch: async () => ['src/billing/export.ts'],
    linesChangedOnBranch: async () => 40,
    commitMessage: async (commit) => {
      if (broken.git !== undefined) throw new Error(broken.git);
      return commits[commit] ?? `Commit ${commit}`;
    },
    pushBranch: async (branch) => git.push(branch, 'c1'),
    tickets,
    runtime: createInMemoryAgentRuntime({ worktree: { id: 'wt-1', path: '/work/pay-142', branch: 'factory/pay-142', host: 'pierre-mbp' } }),
    config: config.value,
    user: 'pierre',
    now: () => '2026-11-21T08:00:00Z',
    recordBudget: 100_000,
    machine: 'pierre-mbp',
    validateSpec: async () => [],
    predictRisk: async () => 'low',
    mainCommit: async () => 'a41c9e2',
    changedFilesSince: async () => changedOnMain,
  };
  const run = async (...argv: readonly string[]) => {
    const out: string[] = [];
    const errors: string[] = [];
    const code = await runCli({
      argv,
      deps: async () => {
        if (broken.reason !== undefined) throw new Error(broken.reason);
        return deps;
      },
      folder: createSpecFolder(),
      readFile: async (path) => {
        const content = verdictFiles[path];
        if (content === undefined) throw new Error(`No such file: ${path}`);
        return content;
      },
      write: (line) => void out.push(line), writeError: (line) => void errors.push(line) });
    return { code, out, errors };
  };
  return { run, tickets, changedOnMain, scripts, verdictFiles, commits, git, sourceControl, broken };
};

const statusOf = async (cli: Awaited<ReturnType<typeof getCli>>): Promise<string | undefined> => (await cli.tickets.getTicket('PAY-142'))?.status;

describe('factory command line', () => {
  it('takes a ticket from To refine to a running build, one command at a time', async () => {
    const cli = await getCli(getMockTicket({ status: 'To refine' }));

    const refine = await cli.run('refine', 'PAY-142');
    const gate = await cli.run('ready-gate', 'PAY-142');
    const preview = await cli.run('approve', 'PAY-142', '--preview');
    const afterPreview = await statusOf(cli);
    const approval = await cli.run('approve', 'PAY-142');
    const started = await cli.run('run', 'PAY-142');
    const revalidated = await cli.run('revalidate', 'PAY-142');
    const resumed = await cli.run('run', 'PAY-142');

    expect(refine).toEqual({ code: 0, out: ['Refinement started on PAY-142'], errors: [] });
    expect(gate).toEqual({ code: 0, out: ['Ready gate passed'], errors: [] });
    expect(preview).toEqual({ code: 0, out: ['Low risk, would auto-merge'], errors: [] });
    expect(afterPreview).toBe('Spec review');
    expect(approval).toEqual({ code: 0, out: ['Approved. Low risk, would auto-merge'], errors: [] });
    expect(started).toEqual({ code: 0, out: ['Started run 1 of PAY-142 at attempt 1. Next step: revalidate'], errors: [] });
    expect(revalidated).toEqual({ code: 0, out: ['No drift since approval'], errors: [] });
    expect(resumed).toEqual({ code: 0, out: ['Resumed run 1 of PAY-142 at attempt 1. Next step: revalidate'], errors: [] });
    expect(await statusOf(cli)).toBe('In development');
  });

  it('exits 1 and lists the findings when the ready gate fails', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }), { ...SPEC_FILES, 'design.md': '# Design\n\n## Context\nTBD\n' });

    const gate = await cli.run('ready-gate', 'PAY-142');

    expect(gate).toEqual({
      code: 1,
      out: ['Ready gate failed', '- design.md:4 contains a TBD marker', '- design.md has no Decisions section'],
      errors: [],
    });
  });

  it('exits 1 and lists what drifted when revalidation sends the ticket back', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }));
    await cli.run('approve', 'PAY-142');
    await cli.run('run', 'PAY-142');
    cli.changedOnMain.push('src/billing/rounding.ts');

    const result = await cli.run('revalidate', 'PAY-142');

    expect(result).toEqual({ code: 1, out: ['Sent back to refinement', '- Changed on main since approval: src/billing/rounding.ts'], errors: [] });
    expect(await statusOf(cli)).toBe('Spec review');
  });

  it('exits 1 with the reason on stderr when a command is refused', async () => {
    const cli = await getCli(getMockTicket({ status: 'Ready for Dev' }));

    const result = await cli.run('run', 'PAY-142');

    expect(result).toEqual({ code: 1, out: [], errors: ['PAY-142 was not approved through the factory'] });
  });

  it('exits 1 with the reason when a gate or an approval is refused', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }), {});
    const reason = 'PAY-142 has no OpenSpec files attached. A draft spec is required';

    expect(await cli.run('ready-gate', 'PAY-142')).toEqual({ code: 1, out: [], errors: [reason] });
    expect(await cli.run('revalidate', 'PAY-142')).toEqual({ code: 1, out: [], errors: [reason] });
    expect(await cli.run('approve', 'PAY-142')).toEqual({ code: 1, out: [], errors: [reason] });
    expect(await cli.run('approve', 'PAY-142', '--preview')).toEqual({ code: 1, out: [], errors: [reason] });
    expect(await cli.run('refine', 'PAY-142')).toEqual({ code: 1, out: [], errors: [reason] });
  });

  it('stores a merge ceiling given on the command line', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }));

    const approval = await cli.run('approve', 'PAY-142', '--ceiling', 'human');

    expect(approval.out).toEqual(['Approved. Low risk, merged by a person']);
  });

  it('pulls the spec files into a folder, pushes back only what changed, and shows the status', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }));
    const folder = mkdtempSync(join(tmpdir(), 'factory-cli-'));

    const pulled = await cli.run('pull', 'PAY-142', '--to', folder);
    const pulledDelta = readFileSync(join(folder, 'specs/billing/spec.md'), 'utf8');
    const unchanged = await cli.run('push', 'PAY-142', '--from', folder);
    await cli.run('ready-gate', 'PAY-142');
    writeFileSync(join(folder, 'specs/billing/spec.md'), '# Spec Delta\n\nedited\n');
    writeFileSync(join(folder, 'design.md'), '# Design\n\n## Context\n');
    const pushed = await cli.run('push', '--from', folder, 'PAY-142');
    const stale = await cli.run('status', 'PAY-142');
    await cli.run('ready-gate', 'PAY-142');
    const failed = await cli.run('status', 'PAY-142');

    expect(pulled).toEqual({ code: 0, out: [`Wrote 4 spec files to ${folder}`], errors: [] });
    expect(pulledDelta).toBe('# Spec Delta\n');
    expect(unchanged.out).toEqual(['Nothing changed']);
    expect(pushed.out).toEqual(['Attached 2 spec files to PAY-142: design.md, specs__billing__spec.md']);
    expect(stale).toEqual({ code: 0, out: ['Status: Spec review', 'Ready gate: passed (out of date: the spec changed since)', 'Approval: none'], errors: [] });
    expect(failed.out).toEqual(['Status: Spec review', 'Ready gate: failed', '- design.md has no Decisions section', 'Approval: none']);
  });

  it('shows the approval and the questions of a send-back in the status', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }));
    const before = await cli.run('status', 'PAY-142');
    await cli.run('approve', 'PAY-142');
    await cli.run('run', 'PAY-142');
    cli.changedOnMain.push('src/billing/rounding.ts');
    await cli.run('revalidate', 'PAY-142');

    const status = await cli.run('status', 'PAY-142');

    expect(before.out).toEqual(['Status: Spec review', 'Ready gate: not run', 'Approval: none']);
    expect(status.out).toEqual([
      'Status: Spec review',
      'Ready gate: passed',
      'Approval: by pierre at 2026-11-21T08:00:00Z, low risk',
      'Question: These files changed on main after the spec was approved: src/billing/rounding.ts. Does the spec still hold?',
      '  Recommended: Review the changes, update the spec if needed, and approve again.',
    ]);
  });

  it('exits 1 with the problem when a command fails while running', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }));

    const result = await cli.run('push', 'PAY-142', '--from', join(tmpdir(), 'factory-cli-missing-folder'));

    expect(result.code).toBe(1);
    expect(result.out).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('factory-cli-missing-folder');
  });

  it('exits 1 with the reason when a pull, push or status is refused', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }), {});
    const folder = mkdtempSync(join(tmpdir(), 'factory-cli-'));
    writeFileSync(join(folder, 'proposal.md'), 'draft');
    const reason = 'PAY-142 has no OpenSpec files attached. A draft spec is required';

    expect(await cli.run('pull', 'PAY-142', '--to', folder)).toEqual({ code: 1, out: [], errors: [reason] });
    expect(await cli.run('status', 'PAY-142')).toEqual({ code: 1, out: [], errors: [reason] });
    expect(await cli.run('push', 'PAY-999', '--from', folder)).toEqual({ code: 1, out: [], errors: ['PAY-999 does not exist'] });
    expect(await cli.run('push', 'PAY-142', '--from', folder)).toEqual({ code: 0, out: ['Attached 1 spec files to PAY-142: proposal.md'], errors: [] });
  });

  const PASS = JSON.stringify({ verdict: 'pass', findings: [], evidence: [] });

  const getRunning = async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }));
    await cli.run('approve', 'PAY-142');
    await cli.run('run', 'PAY-142');
    cli.verdictFiles['verify.json'] = PASS;
    cli.verdictFiles['review.json'] = PASS;
    return cli;
  };

  it('advances a run from the first build to a pull request', async () => {
    const cli = await getRunning();

    const build = await cli.run('advance', 'PAY-142');
    const verify = await cli.run('advance', 'PAY-142', '--changed', 'Added the exporter', '--decision', 'D-001', '--decision', 'D-004');
    const review = await cli.run('advance', 'PAY-142', '--verdict', 'openspec-verify=verify.json');
    const done = await cli.run('advance', 'PAY-142', '--verdict', 'reviewer=review.json', '--json');

    expect(build).toEqual({ code: 0, out: ['Next: build (attempt 1)'], errors: [] });
    expect(verify).toEqual({ code: 0, out: ['Next: verify (attempt 1). Hand in the verdict of openspec-verify'], errors: [] });
    expect(review).toEqual({ code: 0, out: ['Next: review (attempt 1). Hand in a verdict for: reviewer'], errors: [] });
    expect(done.code).toBe(0);
    expect(done.out.map((line) => JSON.parse(line))).toEqual([{ ok: true, next: 'done', exit: 'pull_request', url: 'memory://pull/401' }]);
    expect(await statusOf(cli)).toBe('In review');
    expect(await cli.run('advance', 'PAY-142')).toEqual({ code: 1, out: [], errors: ['PAY-142 has no run in progress'] });
  });

  it('shows what failed when a gate sends the run to another attempt, then asks for a diagnosis after the last one', async () => {
    const cli = await getRunning();
    cli.scripts.push(...Array.from({ length: 5 }, () => ({ exitCode: 1, output: 'export.test.ts failed\nmore detail', timedOut: false })));
    await cli.run('advance', 'PAY-142');

    const second = await cli.run('advance', 'PAY-142', '--changed', 'Added the exporter');
    await cli.run('advance', 'PAY-142', '--changed', 'Second try');
    await cli.run('advance', 'PAY-142', '--changed', 'Third try');
    await cli.run('advance', 'PAY-142', '--changed', 'Fourth try');
    const diagnose = await cli.run('advance', 'PAY-142', '--changed', 'Fifth try');
    const blocked = await cli.run('advance', 'PAY-142', '--diagnosis', 'environment', '--next-step', 'Stabilize the fixture');

    expect(second).toEqual({ code: 0, out: ['Next: build (attempt 2)', '- unit-tests (quality): exit code 1', '  export.test.ts failed'], errors: [] });
    expect(diagnose.out.slice(0, 4)).toEqual(['Next: diagnose. Every attempt failed:', 'Attempt 1: Added the exporter', '- unit-tests (quality): exit code 1', '  export.test.ts failed']);
    expect(diagnose.out).toHaveLength(16);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toEqual(['Blocked. Failure report: memory://attachment/4/factory-failure-report-run-1.md']);
    expect(await statusOf(cli)).toBe('Blocked');
  });

  it('sends the ticket back on a question from the builder, and on a spec diagnosis with its questions', async () => {
    const asked = await getRunning();
    await asked.run('advance', 'PAY-142');
    const diagnosed = await getCli(getMockTicket({ status: 'Spec review' }));
    await diagnosed.run('approve', 'PAY-142');
    await diagnosed.run('run', 'PAY-142');
    diagnosed.scripts.push(...Array.from({ length: 5 }, () => ({ exitCode: 1, output: 'boom', timedOut: false })));
    await diagnosed.run('advance', 'PAY-142');
    await ['a', 'b', 'c', 'd', 'e'].reduce(async (previous, changed) => {
      await previous;
      await diagnosed.run('advance', 'PAY-142', '--changed', changed);
    }, Promise.resolve());

    const sentBack = await asked.run('advance', 'PAY-142', '--question', 'Reject a refund with no amount?', '--recommended', 'Yes');
    const specGap = await diagnosed.run('advance', 'PAY-142', '--diagnosis', 'spec', '--question', 'Round before summing?', '--recommended', 'After', '--question', 'Which currency?', '--recommended', 'Invoice currency');

    expect(sentBack).toEqual({ code: 1, out: ['Sent back to refinement', '- Reject a refund with no amount?'], errors: [] });
    expect(specGap).toEqual({ code: 1, out: ['Sent back to refinement', '- Round before summing?', '- Which currency?'], errors: [] });
    expect((await diagnosed.run('status', 'PAY-142')).out).toContain('  Recommended: Invoice currency');
  });

  it('retries a blocked ticket and overrides the run limit only when told to', async () => {
    const cli = await getRunning();
    cli.scripts.push(...Array.from({ length: 5 }, () => ({ exitCode: 1, output: 'boom', timedOut: false })));
    await cli.run('advance', 'PAY-142');
    await ['a', 'b', 'c', 'd', 'e'].reduce(async (previous, changed) => {
      await previous;
      await cli.run('advance', 'PAY-142', '--changed', changed);
    }, Promise.resolve());
    await cli.run('advance', 'PAY-142', '--diagnosis', 'code');

    const unconfirmed = await cli.run('run', 'PAY-142');
    const retried = await cli.run('run', 'PAY-142', '--confirm-retry');

    expect(unconfirmed.errors).toEqual(['PAY-142 is in "Blocked". Confirm to retry it with a new run']);
    expect(retried.out).toEqual(['Started run 2 of PAY-142 at attempt 1. Next step: revalidate']);
  });

  it('shows a failure that has no output on a single line', async () => {
    const cli = await getRunning();
    cli.verdictFiles['verify.json'] = 'Looks fine to me';
    await cli.run('advance', 'PAY-142');
    await cli.run('advance', 'PAY-142', '--changed', 'x');

    const next = await cli.run('advance', 'PAY-142', '--verdict', 'openspec-verify=verify.json');

    expect(next.out).toEqual(['Next: build (attempt 2)', '- openspec-verify (review): invalid verdict']);
  });

  it('exits 1 when a verdict file cannot be read', async () => {
    const cli = await getRunning();
    await cli.run('advance', 'PAY-142');
    await cli.run('advance', 'PAY-142', '--changed', 'x');

    expect(await cli.run('advance', 'PAY-142', '--verdict', 'openspec-verify=missing.json')).toEqual({ code: 1, out: [], errors: ['No such file: missing.json'] });
  });

  it('accepts options before the ticket key', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }), { ...SPEC_FILES, 'design.md': '# Design\n\n## Context\n' });
    const gate = await cli.run('ready-gate', '--json', 'PAY-142');
    await cli.tickets.addAttachment({ key: 'PAY-142', name: 'design.md', content: SPEC_FILES['design.md'] ?? '' });

    const approval = await cli.run('approve', '--ceiling', 'human', 'PAY-142');
    const started = await cli.run('run', '--confirm-takeover', 'PAY-142');

    expect(gate.out.map((line) => JSON.parse(line))).toEqual([{ ok: true, passed: false, findings: ['design.md has no Decisions section'] }]);
    expect(approval.out).toEqual(['Approved. Low risk, merged by a person']);
    expect(started.out).toEqual(['Started run 1 of PAY-142 at attempt 1. Next step: revalidate']);
  });

  it('claims the next eligible ticket, or says there is none', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review', labels: ['factory-auto'] }));
    const none = await cli.run('next');
    await cli.run('approve', 'PAY-142');

    const next = await cli.run('next');

    expect(none).toEqual({ code: 1, out: [], errors: ['No ticket with the "factory-auto" label is in "Ready for Dev"'] });
    expect(next.out).toEqual(['Started run 1 of PAY-142 at attempt 1. Next step: revalidate']);
  });

  it('takes over or accepts an edited record only when told to', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }));
    await cli.run('approve', 'PAY-142');
    await cli.run('run', 'PAY-142');
    const comment = (await cli.tickets.getFactoryComment('PAY-142')) ?? '';
    await cli.tickets.putFactoryComment('PAY-142', comment.replace('"claimant":"pierre"', '"claimant":"maya"'));

    const refused = await cli.run('run', 'PAY-142');
    const edited = await cli.run('run', 'PAY-142', '--accept-edited-record');
    const taken = await cli.run('run', 'PAY-142', '--accept-edited-record', '--confirm-takeover');

    expect(refused.errors).toEqual(['The record on PAY-142 was edited outside the factory']);
    expect(edited.errors).toEqual(['PAY-142 is being run by maya. Confirm to take it over']);
    expect(taken).toMatchObject({ code: 0, out: ['Resumed run 1 of PAY-142 at attempt 1. Next step: revalidate'] });
  });

  it('prints the raw result as one line of JSON when asked', async () => {
    const cli = await getCli(getMockTicket({ status: 'Spec review' }), { ...SPEC_FILES, 'design.md': '# Design\n\n## Context\n' });

    const gate = await cli.run('ready-gate', 'PAY-142', '--json');
    const refused = await cli.run('run', 'PAY-142', '--json');

    expect(gate.code).toBe(1);
    expect(gate.out.map((line) => JSON.parse(line))).toEqual([{ ok: true, passed: false, findings: ['design.md has no Decisions section'] }]);
    expect(refused.code).toBe(1);
    expect(refused.out.map((line) => JSON.parse(line))).toEqual([{ ok: false, reason: 'not_ready', message: 'PAY-142 is in "Spec review", not "Ready for Dev"' }]);
    expect(refused.errors).toEqual([]);
  });

  it.each([[[]], [['frobnicate', 'PAY-142']], [['run']], [['approve']], [['approve', 'PAY-142', '--ceiling', 'robot']], [['approve', 'PAY-142', '--ceiling']], [['pull', 'PAY-142']], [['push', 'PAY-142']], [['pull', '--to', 'x']], [['advance']], [['advance', 'PAY-142', '--diagnosis', 'bad luck']], [['advance', 'PAY-142', '--diagnosis']], [['advance', 'PAY-142', '--verdict', 'reviewer']], [['advance', 'PAY-142', '--verdict', '=file.json']], [['advance', 'PAY-142', '--question', 'Why?']]])(
    'exits 2 with usage for %j, without touching anything',
    async (argv) => {
      const cli = await getCli(getMockTicket({ status: 'Spec review' }));
      const calls = { deps: 0 };
      const errors: string[] = [];

      const code = await runCli({
        argv,
        deps: async () => {
          calls.deps += 1;
          throw new Error('must not be built');
        },
        folder: createSpecFolder(),
        readFile: async () => '',
        write: () => undefined,
        writeError: (line) => void errors.push(line),
      });

      expect(code).toBe(2);
      expect(errors[0]).toBe('Usage: factory <command> <KEY> [options]');
      expect(
        ['refine <KEY>', 'status <KEY>', 'pull <KEY> --to <folder>', 'push <KEY> --from <folder>', 'ready-gate <KEY>', 'approve <KEY> [--preview] [--ceiling human]', 'run <KEY> [--confirm-takeover] [--accept-edited-record]', 'revalidate <KEY>', 'next', 'doctor [--run-checks] [--ticket <KEY>]', 'migrate ', 'init --ticket', 'workflow --title', '--json'].filter(
          (text) => !errors.some((line) => line.includes(text)),
        ),
      ).toEqual([]);
      expect(errors).toHaveLength(23);
      expect(calls.deps).toBe(0);
      expect(await statusOf(cli)).toBe('Spec review');
    },
  );

  it('exits 2 with the problem when the project cannot be set up', async () => {
    const errors: string[] = [];

    const code = await runCli({
      argv: ['next'],
      deps: async () => {
        throw new Error('.factory/factory.yaml is missing. Run /factory-init');
      },
      folder: createSpecFolder(),
      readFile: async () => '',
      write: () => undefined,
      writeError: (line) => void errors.push(line),
    });

    expect(code).toBe(2);
    expect(errors).toEqual(['.factory/factory.yaml is missing. Run /factory-init']);
  });

  it('reports a setup failure that is not an error object as it is', async () => {
    const errors: string[] = [];

    const code = await runCli({ argv: ['next'], deps: () => Promise.reject('orca is not installed'), folder: createSpecFolder(), readFile: async () => '', write: () => undefined, writeError: (line) => void errors.push(line) });

    expect(code).toBe(2);
    expect(errors).toEqual(['orca is not installed']);
  });
});

const getProjectFolder = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), 'factory-project-'));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  execFileSync('git', ['config', 'user.name', 'Pierre Dev'], { cwd: root });
  mkdirSync(join(root, '.factory'));
  Object.entries(files).forEach(([name, content]) => writeFileSync(join(root, '.factory', name), content));
  return root;
};

const ENV = { JIRA_TOKEN: 'secret', JIRA_EMAIL: 'factory@acme.test', GH_TOKEN: 'gh-secret' };

const hasOpenspec = (() => {
  try {
    execFileSync('openspec', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const AUTO_YAML = `${FACTORY_YAML}  shadow: false\nwatch: { enabled: true, checks: [./smoke.sh], duration: 1m, interval: 1m }\n`;

const getDeliveredCli = async (yaml: string = FACTORY_YAML) => {
  const cli = await getCli(getMockTicket({ status: 'Spec review' }), SPEC_FILES, yaml);
  cli.verdictFiles['v.json'] = JSON.stringify({ verdict: 'pass', findings: [], evidence: [] });
  await cli.run('approve', 'PAY-142');
  await cli.run('run', 'PAY-142');
  await cli.run('advance', 'PAY-142');
  await cli.run('advance', 'PAY-142', '--changed', 'Added the exporter');
  await cli.run('advance', 'PAY-142', '--verdict', 'openspec-verify=v.json');
  await cli.run('advance', 'PAY-142', '--verdict', 'reviewer=v.json');
  cli.commits.HEAD = 'Merge pull request #401 from acme/factory/pay-142';
  cli.commits.m1 = 'Merge pull request #401 from acme/factory/pay-142';
  return cli;
};

describe('factory steps run from CI', () => {
  it('records a merge, then its revert', async () => {
    const cli = await getDeliveredCli();
    cli.git.merge(401, 'sam');

    const merged = await cli.run('record-merge');
    const nothing = await cli.run('record-merge', '--commit', 'm1');
    await cli.sourceControl.openRevertPullRequest(401);
    cli.git.merge(402, 'sam');
    cli.commits.m2 = 'Merge pull request #402 from acme/revert-401';
    const reverted = await cli.run('record-merge', '--commit', 'm2');
    const asJson = await cli.run('record-merge', '--commit', 'm2', '--json');

    expect(merged).toEqual({ code: 0, out: ['Recorded the merge of PAY-142 by sam (merged as is)'], errors: [] });
    expect(nothing).toEqual({ code: 0, out: ['Nothing to record'], errors: [] });
    expect(reverted).toEqual({ code: 0, out: ['Recorded the revert of PAY-142 by pull request 402'], errors: [] });
    expect(asJson).toEqual({ code: 0, out: ['{"ok":true}'], errors: [] });
    expect(await statusOf(cli)).toBe('Done');
  });

  it('says when a person changed the change before merging, using the pull request number it is given', async () => {
    const cli = await getDeliveredCli();
    cli.git.push('factory/pay-142', 'by-hand');
    cli.git.merge(401, 'sam');
    cli.commits.HEAD = 'PAY-142 Bulk invoice export';

    const merged = await cli.run('record-merge', '--pull-request', '401');

    expect(merged.out).toEqual(['Recorded the merge of PAY-142 by sam (changed by a human)']);
  });

  it('does not fail the build when the service account is missing, and names the missing secret', async () => {
    const cli = await getDeliveredCli();
    cli.broken.reason = 'Set the JIRA_TOKEN environment variable';

    const results = await Promise.all([cli.run('record-merge'), cli.run('revert'), cli.run('watch')]);
    const developer = await cli.run('status', 'PAY-142');

    expect(results).toEqual(Array.from({ length: 3 }, () => ({ code: 0, out: [], errors: ['Set the JIRA_TOKEN environment variable', 'The factory step was skipped. The build is not affected.'] })));
    expect(developer).toEqual({ code: 2, out: [], errors: ['Set the JIRA_TOKEN environment variable'] });
  });

  it('does not fail the build when the provider is down', async () => {
    const cli = await getDeliveredCli();
    cli.broken.git = 'Jira answered 503';

    const result = await cli.run('record-merge');

    expect(result).toEqual({ code: 0, out: [], errors: ['Jira answered 503', 'The factory step was skipped. The build is not affected.'] });
  });

  it('opens a revert only for a change that was merged automatically', async () => {
    const cli = await getDeliveredCli();
    cli.git.merge(401, 'sam');
    await cli.run('record-merge');

    expect(await cli.run('revert')).toEqual({ code: 0, out: ['Nothing to revert'], errors: [] });
  });

  it('opens a revert for an auto-merged change, or asks for one where source control cannot', async () => {
    const cli = await getDeliveredCli(AUTO_YAML);
    cli.git.merge(401, 'factory-bot');
    await cli.run('record-merge');
    const other = await getDeliveredCli(AUTO_YAML);
    other.git.merge(401, 'factory-bot');
    await other.run('record-merge');
    other.broken.revert = 'Bitbucket has no API to revert a pull request.';

    expect(await cli.run('revert')).toEqual({ code: 0, out: ['Revert opened for PAY-142: memory://pull/402'], errors: [] });
    expect(await other.run('revert')).toEqual({ code: 0, out: ['Revert needed for PAY-142. Revert this pull request by hand: memory://pull/401'], errors: [] });
  });

  it('marks a change delivered after the staging watch, and watches nothing twice', async () => {
    const cli = await getDeliveredCli(AUTO_YAML);
    cli.git.merge(401, 'factory-bot');
    await cli.run('record-merge');

    expect(await cli.run('watch')).toEqual({ code: 0, out: ['PAY-142 delivered: the staging watch passed'], errors: [] });
    expect(await cli.run('watch')).toEqual({ code: 0, out: ['Nothing to watch'], errors: [] });
  });

  it('exits 1 when the staging watch fails, saying where the revert is', async () => {
    const cli = await getDeliveredCli(AUTO_YAML);
    cli.git.merge(401, 'factory-bot');
    await cli.run('record-merge');
    cli.scripts.push({ exitCode: 1, output: 'GET /health 500', timedOut: false });
    const other = await getDeliveredCli(AUTO_YAML);
    other.git.merge(401, 'factory-bot');
    await other.run('record-merge');
    other.scripts.push({ exitCode: 1, output: 'GET /health 500', timedOut: false });
    other.broken.revert = 'Bitbucket has no API to revert a pull request.';

    expect(await cli.run('watch')).toEqual({ code: 1, out: ['The staging watch failed for PAY-142 on ./smoke.sh. Revert opened: memory://pull/402'], errors: [] });
    expect(await other.run('watch')).toEqual({ code: 1, out: ['The staging watch failed for PAY-142 on ./smoke.sh. Revert this pull request by hand: memory://pull/401'], errors: [] });
  });

  it('reports the watch as off when the project has none', async () => {
    const cli = await getDeliveredCli();

    expect(await cli.run('watch', '--commit', 'm1')).toEqual({ code: 0, out: ['The watch is off'], errors: [] });
  });

  it.each([['record-merge'], ['revert'], ['watch']])('rejects a pull request number that is not a number for %s', async (command) => {
    const cli = await getDeliveredCli();

    const codes = await Promise.all(['abc', '401abc', 'abc401'].map(async (number) => (await cli.run(command, '--pull-request', number)).code));

    expect(codes).toEqual([2, 2, 2]);
  });
});

describe('setting the command line up in a project', () => {
  it('sets the dashboard up from the ticket provider alone, with no source control token', async () => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML });

    const source = await createProjectViewSource({ cwd, env: { JIRA_TOKEN: 'secret', JIRA_EMAIL: 'factory@acme.test' } });

    expect(typeof source.load).toBe('function');
    await expect(createProjectViewSource({ cwd, env: {} })).rejects.toThrow('Set the JIRA_EMAIL environment variable');
    await expect(createProjectViewSource({ cwd: getProjectFolder({ 'adapters.yaml': ADAPTERS_YAML }), env: ENV })).rejects.toThrow('.factory/factory.yaml is missing');
  });

  it('sets the setup commands up even when the project config is broken, and reaches the providers only when asked', async () => {
    const cwd = getProjectFolder({ 'factory.yaml': 'schema: [' });
    const broken = createSetupDeps({ cwd, env: ENV });
    const configured = createSetupDeps({ cwd: getProjectFolder({ 'adapters.yaml': ADAPTERS_YAML }), env: {} });

    expect(await broken.files.read('.factory/factory.yaml')).toBe('schema: [');
    expect((await broken.runScript('echo checked', { timeoutSeconds: 5 })).output).toBe('checked\n');
    expect(broken.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    await expect(broken.checkAccess('PAY-142')).rejects.toThrow('.factory/adapters.yaml is missing');
    await expect(broken.canReenter({ key: 'PAY-142', status: 'In development' })).rejects.toThrow('.factory/adapters.yaml is missing');
    await expect(configured.canReenter({ key: 'PAY-142', status: 'In development' })).rejects.toThrow('Set the JIRA_EMAIL environment variable');
    await expect(broken.openPullRequest({ branch: 'b', base: 'main', title: 't', body: '' })).rejects.toThrow('.factory/adapters.yaml is missing');
    await expect(configured.checkAccess('PAY-142')).rejects.toThrow('Set the JIRA_EMAIL environment variable');
    await expect(configured.openPullRequest({ branch: 'b', base: 'main', title: 't', body: '' })).rejects.toThrow('Set the GH_TOKEN environment variable');
    await expect(broken.publishFiles({ branch: 'b', base: 'main', files: { x: 'x' }, message: 'x' })).rejects.toThrow(/origin/);
    await expect(broken.readFile('.factory/factory.yaml')).resolves.toBe('schema: [');
    await expect(broken.readFile('answers.json')).rejects.toThrow('answers.json');
    expect(await broken.remoteUrl()).toBeUndefined();
    expect(await broken.mainFile('.factory/factory.yaml', 'main')).toBeUndefined();
    const adapters = parseAdaptersConfig(ADAPTERS_YAML);
    if (!adapters.ok) throw new Error('invalid test adapters');
    expect(typeof broken.tickets(adapters.value).listStatuses).toBe('function');
    expect(typeof broken.sourceControl(adapters.value).openPullRequest).toBe('function');
    expect(() => configured.tickets(adapters.value)).toThrow('Set the JIRA_EMAIL environment variable');
    expect(() => configured.sourceControl(adapters.value)).toThrow('Set the GH_TOKEN environment variable');
  });

  it('connects to Linear when adapters.yaml names a Linear team, with the API key from the environment', async () => {
    const linearYaml = ADAPTERS_YAML.replace(/ {2}- kind: jira\n(?: {4}.*\n)+/, '  - kind: linear\n    team: PAY\n    token_env: LINEAR_API_KEY\n');
    const linear = parseAdaptersConfig(linearYaml);
    const noTeam = parseAdaptersConfig(linearYaml.replace('    team: PAY\n', ''));
    const unsupported = parseAdaptersConfig(linearYaml.replace('kind: linear', 'kind: github-issues'));
    if (!linear.ok || !noTeam.ok || !unsupported.ok) throw new Error('invalid test adapters');
    const deps = createSetupDeps({ cwd: getProjectFolder({ 'adapters.yaml': linearYaml }), env: { LINEAR_API_KEY: 'key' } });
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': linearYaml });

    expect(typeof deps.tickets(linear.value).listStatuses).toBe('function');
    expect(() => createSetupDeps({ cwd, env: {} }).tickets(linear.value)).toThrow('Set the LINEAR_API_KEY environment variable');
    expect(() => deps.tickets(noTeam.value)).toThrow('The linear ticket provider needs team and token_env in .factory/adapters.yaml');
    expect(() => deps.tickets(unsupported.value)).toThrow('No supported ticket provider is configured. Only jira and linear are supported so far');
    expect(typeof (await createProjectViewSource({ cwd, env: { LINEAR_API_KEY: 'key' } })).load).toBe('function');
  });

  it('talks to Linear\'s API and upload storage, searching the configured project, and names Linear on the dashboard', async () => {
    const linearYaml = ADAPTERS_YAML.replace(/ {2}- kind: jira\n(?: {4}.*\n)+/, '  - kind: linear\n    team: PAY\n    project: Billing service\n    token_env: LINEAR_API_KEY\n');
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': linearYaml });
    const sent: { readonly url: string; readonly body: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { readonly body: string }) => {
      sent.push({ url, body: init.body });
      return new Response(JSON.stringify({ data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    });
    try {
      const deps = await createRealDeps({ cwd, env: { LINEAR_API_KEY: 'key', GH_TOKEN: 'gh' } });
      await deps.tickets.search({});
      const view = await (await createProjectViewSource({ cwd, env: { LINEAR_API_KEY: 'key' } })).load();

      expect(sent[0]?.url).toBe('https://api.linear.app/graphql');
      expect(sent[0]?.body).toContain('"project":{"name":{"eq":"Billing service"}}');
      expect(view.providers).toEqual(['Linear']);
      await expect(deps.tickets.readAttachment('https://uploads.linear.app.evil.test/x')).rejects.toThrow('Attachment link is not on https://uploads.linear.app');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers a dashboard on sample data that needs no project config and no credentials', async () => {
    const data = await createSampleViewSource().load();

    expect(data.providers).toEqual(['Sample data']);
    expect(data.columns.flatMap((column) => column.cards).length).toBe(27);
    expect(data.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('lists every problem in a config file on its own line', async () => {
    const broken = FACTORY_YAML.replace('schema: 1', 'schema: 9').replace('engine: 0.2.0\n', '');
    const cwd = getProjectFolder({ 'factory.yaml': broken, 'adapters.yaml': ADAPTERS_YAML });

    const message = await createRealDeps({ cwd, env: ENV }).then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : ''),
    );

    expect(message.split('\n')).toHaveLength(2);
    expect(message.split('\n').every((line) => line.startsWith('.factory/factory.yaml: '))).toBe(true);
  });

  it.skipIf(!hasOpenspec)('validates spec files with the real openspec command', async () => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML });
    const deps = await createRealDeps({ cwd, env: ENV });

    const findings = await deps.validateSpec([
      { name: 'proposal.md', content: '# Proposal\n\n## Why\nBecause accounting needs invoices exported in bulk every month.\n\n## What Changes\n- Add export\n' },
      { name: 'specs__billing__spec.md', content: '# Spec Delta\n\n## ADDED Requirements\n### Requirement: Bulk export\nThe system SHALL export.\n' },
    ]);

    expect(findings.some((finding) => finding.includes('must include at least one scenario'))).toBe(true);
  });

  it('reads the project config, the developer name from git, and predicts risk from the spec', async () => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML });

    const deps = await createRealDeps({ cwd, env: ENV });

    expect(deps.user).toBe('Pierre Dev');
    expect(await deps.commitMessage('HEAD').catch(() => 'no commit')).toBe('no commit');
    expect(deps.config.states.ready_for_dev).toBe('Ready for Dev');
    expect(await deps.predictRisk([])).toBe('low');
    expect(await deps.predictRisk([{ name: 'proposal.md', content: '## Affected paths\n- `db/migrations/0007.sql`\n' }])).toBe('medium');
    expect(deps.recordBudget).toBe(30_000);
    expect(deps.machine).toBe(hostname());
    expect(deps.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('runs a project pinned to another patch of the same engine release', async () => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML.replace('engine: 0.2.0', 'engine: 0.2.7'), 'adapters.yaml': ADAPTERS_YAML });

    expect((await createRealDeps({ cwd, env: ENV })).config.engine).toBe('0.2.7');
  });

  it('writes as factory-ci where git has no user name, as in CI', async () => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML });
    execFileSync('git', ['config', 'user.name', ''], { cwd });

    expect((await createRealDeps({ cwd, env: ENV })).user).toBe('factory-ci');
  });

  it.each([
    [{ 'adapters.yaml': ADAPTERS_YAML }, '.factory/factory.yaml is missing. Run /factory-init'],
    [{ 'factory.yaml': FACTORY_YAML }, '.factory/adapters.yaml is missing. Run /factory-init'],
    [{ 'factory.yaml': FACTORY_YAML.replace('schema: 1', 'schema: 9'), 'adapters.yaml': ADAPTERS_YAML }, '.factory/factory.yaml: schema: Invalid input: expected 1'],
    [{ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML.replace('kind: orca', 'kind: other') }, '.factory/adapters.yaml: agent_runtime.kind: Invalid input: expected "orca"'],
    [
      { 'factory.yaml': FACTORY_YAML.replace('engine: 0.2.0', 'engine: 0.3.0'), 'adapters.yaml': ADAPTERS_YAML },
      'This project pins factory engine 0.3.0 in .factory/factory.yaml, and this is engine 0.2.5. Install engine 0.3.0, or upgrade the project with /factory-doctor.',
    ],
  ])('explains what is wrong with the project config (%#)', async (files, message) => {
    await expect(createRealDeps({ cwd: getProjectFolder(files), env: ENV })).rejects.toThrow(message);
  });

  it.each([
    ['source_control: { kind: bitbucket, repo: acme/billing-service, token_env: BB_TOKEN }', { BB_TOKEN: 'bb' }],
    ['source_control: { kind: bitbucket, repo: acme/billing-service, token_env: BB_TOKEN, username_env: BB_USER }', { BB_TOKEN: 'bb', BB_USER: 'factory@acme.test' }],
    ['source_control: { kind: github, repo: acme/billing-service, token_env: GH_TOKEN, api_url: "https://github.acme.test/api/v3" }', {}],
  ])('builds the source control the project names (%#)', async (line, extraEnv) => {
    const adapters = ADAPTERS_YAML.replace('source_control: { kind: github, repo: acme/billing-service, token_env: GH_TOKEN }', line);
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': adapters });

    const deps = await createRealDeps({ cwd, env: { ...ENV, ...extraEnv } });

    expect(typeof deps.sourceControl.openPullRequest).toBe('function');
  });

  it('names the missing Bitbucket username variable', async () => {
    const adapters = ADAPTERS_YAML.replace('kind: github, repo: acme/billing-service, token_env: GH_TOKEN', 'kind: bitbucket, repo: acme/billing-service, token_env: GH_TOKEN, username_env: BB_USER');
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': adapters });

    await expect(createRealDeps({ cwd, env: ENV })).rejects.toThrow('Set the BB_USER environment variable');
  });

  it.each([
    [{ JIRA_EMAIL: 'factory@acme.test', GH_TOKEN: 'x' }, 'Set the JIRA_TOKEN environment variable'],
    [{ JIRA_TOKEN: 'secret', GH_TOKEN: 'x' }, 'Set the JIRA_EMAIL environment variable'],
    [{ JIRA_TOKEN: '', JIRA_EMAIL: 'factory@acme.test', GH_TOKEN: 'x' }, 'Set the JIRA_TOKEN environment variable'],
    [{ JIRA_TOKEN: 'secret', JIRA_EMAIL: 'factory@acme.test' }, 'Set the GH_TOKEN environment variable'],
  ])('names the environment variable that is missing (%#)', async (env, message) => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML });

    await expect(createRealDeps({ cwd, env })).rejects.toThrow(message);
  });

  it.each([
    [ADAPTERS_YAML.replace('    token_env: JIRA_TOKEN\n', ''), 'The jira ticket provider needs base_url, filter, token_env and email_env in .factory/adapters.yaml'],
    [ADAPTERS_YAML.replace('    email_env: JIRA_EMAIL\n', ''), 'The jira ticket provider needs base_url, filter, token_env and email_env in .factory/adapters.yaml'],
    [ADAPTERS_YAML.replace('    base_url: https://acme.atlassian.net\n', ''), 'The jira ticket provider needs base_url, filter, token_env and email_env in .factory/adapters.yaml'],
    [ADAPTERS_YAML.replace('    filter: project = PAY\n', ''), 'The jira ticket provider needs base_url, filter, token_env and email_env in .factory/adapters.yaml'],
    [ADAPTERS_YAML.replace('kind: jira', 'kind: github-issues'), 'No supported ticket provider is configured. Only jira and linear are supported so far'],
    [ADAPTERS_YAML.replace(', token_env: GH_TOKEN', ''), 'The github source control needs token_env in .factory/adapters.yaml'],
    [ADAPTERS_YAML.replace('kind: github', 'kind: bitbucket').replace(', token_env: GH_TOKEN', ''), 'The bitbucket source control needs token_env in .factory/adapters.yaml'],
  ])('explains what the ticket provider entry lacks (%#)', async (adapters, message) => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': adapters });

    await expect(createRealDeps({ cwd, env: ENV })).rejects.toThrow(message);
  });
});
