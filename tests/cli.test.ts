import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInMemoryAgentRuntime } from '../src/adapters/in-memory-agent-runtime.js';
import { createInMemorySourceControl } from '../src/adapters/in-memory-source-control.js';
import { createInMemoryTicketProvider } from '../src/adapters/in-memory-ticket-provider.js';
import type { Ticket } from '../src/adapters/ticket-provider.js';
import { parseFactoryConfig } from '../src/config/project-config.js';
import { runCli } from '../src/cli/cli.js';
import { createSpecFolder } from '../src/cli/inputs.js';
import { createRealDeps } from '../src/cli/real-deps.js';
import type { LoopDeps } from '../src/factory/build-loop.js';
import type { ScriptRun } from '../src/factory/checks.js';
import { getMockTicket } from './contracts/ticket-provider-contract.js';

const FACTORY_YAML = `
schema: 1
engine: 0.1.0
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

const getCli = async (ticket: Ticket, files: Readonly<Record<string, string>> = SPEC_FILES) => {
  const config = parseFactoryConfig(FACTORY_YAML);
  if (!config.ok) throw new Error('invalid test config');
  const tickets = createInMemoryTicketProvider({ tickets: [ticket], now: () => '2026-11-21T08:00:00Z' });
  await Object.entries(files).reduce(async (previous, [name, content]) => {
    await previous;
    await tickets.addAttachment({ key: ticket.key, name, content });
  }, Promise.resolve());
  const changedOnMain: string[] = [];
  const scripts: ScriptRun[] = [];
  const verdictFiles: Record<string, string> = {};
  const { sourceControl, world: git } = createInMemorySourceControl({ now: () => '2026-11-21T08:00:00Z' });
  const deps: LoopDeps = {
    sourceControl,
    runScript: async () => scripts.shift() ?? { exitCode: 0, output: 'ok', timedOut: false },
    sleep: async () => undefined,
    changedFilesOnBranch: async () => ['src/billing/export.ts'],
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
      deps: async () => deps,
      folder: createSpecFolder(),
      readFile: async (path) => {
        const content = verdictFiles[path];
        if (content === undefined) throw new Error(`No such file: ${path}`);
        return content;
      },
      write: (line) => void out.push(line), writeError: (line) => void errors.push(line) });
    return { code, out, errors };
  };
  return { run, tickets, changedOnMain, scripts, verdictFiles };
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
        ['refine <KEY>', 'status <KEY>', 'pull <KEY> --to <folder>', 'push <KEY> --from <folder>', 'ready-gate <KEY>', 'approve <KEY> [--preview] [--ceiling human]', 'run <KEY> [--confirm-takeover] [--accept-edited-record]', 'revalidate <KEY>', 'next', '--json'].filter(
          (text) => !errors.some((line) => line.includes(text)),
        ),
      ).toEqual([]);
      expect(errors).toHaveLength(13);
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

describe('setting the command line up in a project', () => {
  it('lists every problem in a config file on its own line', async () => {
    const broken = FACTORY_YAML.replace('schema: 1', 'schema: 9').replace('engine: 0.1.0\n', '');
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

  it('reads the project config, the developer name from git, and predicts high risk until the risk script exists', async () => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML });

    const deps = await createRealDeps({ cwd, env: ENV });

    expect(deps.user).toBe('Pierre Dev');
    expect(deps.config.states.ready_for_dev).toBe('Ready for Dev');
    expect(await deps.predictRisk([])).toBe('high');
    expect(deps.recordBudget).toBe(30_000);
    expect(deps.machine).toBe(hostname());
    expect(deps.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it.each([
    [{ 'adapters.yaml': ADAPTERS_YAML }, '.factory/factory.yaml is missing. Run /factory-init'],
    [{ 'factory.yaml': FACTORY_YAML }, '.factory/adapters.yaml is missing. Run /factory-init'],
    [{ 'factory.yaml': FACTORY_YAML.replace('schema: 1', 'schema: 9'), 'adapters.yaml': ADAPTERS_YAML }, '.factory/factory.yaml: schema: Invalid input: expected 1'],
    [{ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': ADAPTERS_YAML.replace('kind: orca', 'kind: other') }, '.factory/adapters.yaml: agent_runtime.kind: Invalid input: expected "orca"'],
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
    [ADAPTERS_YAML.replace('kind: jira', 'kind: linear'), 'No supported ticket provider is configured. Only jira is supported so far'],
    [ADAPTERS_YAML.replace(', token_env: GH_TOKEN', ''), 'The github source control needs token_env in .factory/adapters.yaml'],
    [ADAPTERS_YAML.replace('kind: github', 'kind: bitbucket').replace(', token_env: GH_TOKEN', ''), 'The bitbucket source control needs token_env in .factory/adapters.yaml'],
  ])('explains what the ticket provider entry lacks (%#)', async (adapters, message) => {
    const cwd = getProjectFolder({ 'factory.yaml': FACTORY_YAML, 'adapters.yaml': adapters });

    await expect(createRealDeps({ cwd, env: ENV })).rejects.toThrow(message);
  });
});
