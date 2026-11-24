import { describe, expect, it } from 'vitest';
import { requiresCheck, type CiResult, type CommitStatus, type SourceControl } from '../../src/adapters/source-control.js';

export type SourceControlWorld = {
  readonly push: (branch: string, commit: string) => void;
  readonly merge: (number: number, by: string) => void;
  readonly setCi: (ref: string, job: string, result: Exclude<CiResult, 'missing'>) => void;
  readonly advanceClock: (iso: string) => void;
  readonly putFile: (commit: string, path: string, content: string) => void;
  readonly statusesOf: (commit: string) => readonly CommitStatus[];
  readonly requireChecks: (branch: string, contexts: readonly string[] | 'unreadable') => void;
};

const getMockStatus = (overrides?: Partial<CommitStatus>): CommitStatus => ({
  context: 'factory/tasks',
  state: 'failure',
  description: '2 of 9 tasks open',
  link: 'https://example.test/pull/7',
  commit: 'c1',
  ...overrides,
});

export type SourceControlSetup = { readonly sourceControl: SourceControl; readonly world: SourceControlWorld };

const open = async ({ sourceControl, world }: SourceControlSetup, branch = 'factory/pay-142', commit = 'c1') => {
  world.push(branch, commit);
  return sourceControl.openPullRequest({ branch, base: 'main', title: 'PAY-142 Bulk invoice export', body: 'Spec: PAY-142' });
};

export type SourceControlCapabilities = { readonly revert: boolean };

export const describeSourceControlContract = (
  name: string,
  setup: () => SourceControlSetup,
  capabilities: SourceControlCapabilities = { revert: true },
): void => {
  describe(`source control contract: ${name}`, () => {
    it('opens a pull request for a pushed branch', async () => {
      const context = setup();

      const pullRequest = await open(context);

      expect(pullRequest.state).toBe('open');
      expect(pullRequest.branch).toBe('factory/pay-142');
      expect(pullRequest.headCommit).toBe('c1');
      expect(pullRequest.body).toBe('Spec: PAY-142');
      expect(pullRequest.autoMerge).toBe(false);
      expect(pullRequest.url).toContain(String(pullRequest.number));
      expect(await context.sourceControl.getPullRequest(pullRequest.number)).toEqual(pullRequest);
    });

    it('gives each pull request its own number', async () => {
      const context = setup();

      const first = await open(context, 'factory/pay-142');
      const second = await open(context, 'factory/eng-87');

      expect(second.number).not.toBe(first.number);
      expect((await context.sourceControl.getPullRequest(second.number))?.branch).toBe('factory/eng-87');
    });

    it('returns nothing for a pull request that does not exist', async () => {
      expect(await setup().sourceControl.getPullRequest(999)).toBeUndefined();
    });

    it('follows the branch when more commits are pushed', async () => {
      const context = setup();
      const pullRequest = await open(context);

      context.world.push('factory/pay-142', 'c2');

      expect((await context.sourceControl.getPullRequest(pullRequest.number))?.headCommit).toBe('c2');
    });

    it('leaves other open pull requests alone when one branch gets a commit', async () => {
      const context = setup();
      const first = await open(context, 'factory/pay-142', 'c1');
      const second = await open(context, 'factory/eng-87', 'e1');

      context.world.push('factory/pay-142', 'c2');

      expect((await context.sourceControl.getPullRequest(first.number))?.headCommit).toBe('c2');
      expect((await context.sourceControl.getPullRequest(second.number))?.headCommit).toBe('e1');
    });

    it('replaces the description', async () => {
      const context = setup();
      const pullRequest = await open(context);

      await context.sourceControl.updatePullRequestBody({ number: pullRequest.number, body: 'Risk: low' });

      expect((await context.sourceControl.getPullRequest(pullRequest.number))?.body).toBe('Risk: low');
    });

    it('reports a CI job as missing until it exists, then by its result', async () => {
      const { sourceControl, world } = setup();
      const request = { ref: 'factory/pay-142', job: 'unit-tests' };
      const seen: CiResult[] = [await sourceControl.getCiResult(request)];

      world.setCi('factory/pay-142', 'unit-tests', 'pending');
      seen.push(await sourceControl.getCiResult(request));
      world.setCi('factory/pay-142', 'unit-tests', 'failed');
      seen.push(await sourceControl.getCiResult(request));
      world.setCi('factory/pay-142', 'unit-tests', 'passed');
      seen.push(await sourceControl.getCiResult(request));

      expect(seen).toEqual(['missing', 'pending', 'failed', 'passed']);
    });

    it('keeps CI results apart by job and by ref', async () => {
      const { sourceControl, world } = setup();
      world.setCi('factory/pay-142', 'unit-tests', 'passed');

      expect(await sourceControl.getCiResult({ ref: 'factory/pay-142', job: 'lint' })).toBe('missing');
      expect(await sourceControl.getCiResult({ ref: 'factory/eng-87', job: 'unit-tests' })).toBe('missing');
    });

    it('hands one pull request to the source control\'s own merge, leaving the others open', async () => {
      const context = setup();
      const first = await open(context, 'factory/pay-142');
      const second = await open(context, 'factory/eng-87');

      await context.sourceControl.enableAutoMerge(first.number);

      const handed = await context.sourceControl.getPullRequest(first.number);
      const other = await context.sourceControl.getPullRequest(second.number);
      expect(handed?.autoMerge === true || handed?.state === 'merged').toBe(true);
      expect(other?.autoMerge).toBe(false);
      expect(other?.state).toBe('open');
    });

    it('records who merged and when, and that the merge was as is', async () => {
      const context = setup();
      const pullRequest = await open(context);
      context.world.advanceClock('2026-11-21T15:00:00Z');

      context.world.merge(pullRequest.number, 'maya');
      const merged = await context.sourceControl.getPullRequest(pullRequest.number);

      expect(merged?.state).toBe('merged');
      expect(merged?.mergedBy).toBe('maya');
      expect(merged?.mergedAt).toBe('2026-11-21T15:00:00Z');
      expect(await context.sourceControl.wasMergedAsIs({ number: pullRequest.number, commit: 'c1' })).toBe(true);
    });

    it('says a merge was not as is when a person pushed a commit first', async () => {
      const context = setup();
      const pullRequest = await open(context);
      context.world.push('factory/pay-142', 'human-fix');

      context.world.merge(pullRequest.number, 'maya');

      expect(await context.sourceControl.wasMergedAsIs({ number: pullRequest.number, commit: 'c1' })).toBe(false);
    });

    it('does not call an unmerged or unknown pull request merged as is', async () => {
      const context = setup();
      const pullRequest = await open(context);

      expect(await context.sourceControl.wasMergedAsIs({ number: pullRequest.number, commit: 'c1' })).toBe(false);
      expect(await context.sourceControl.wasMergedAsIs({ number: 999, commit: 'c1' })).toBe(false);
    });

    it('posts a commit status on a commit, a later one of the same context replacing it', async () => {
      const { sourceControl, world } = setup();

      await sourceControl.postStatus(getMockStatus());
      await sourceControl.postStatus(getMockStatus({ context: 'other/check', state: 'success', description: 'Fine' }));
      await sourceControl.postStatus(getMockStatus({ state: 'success', description: 'All 9 tasks done' }));

      expect(world.statusesOf('c1')).toEqual([getMockStatus({ context: 'other/check', state: 'success', description: 'Fine' }), getMockStatus({ state: 'success', description: 'All 9 tasks done' })]);
      expect(world.statusesOf('c2')).toEqual([]);
    });

    it('keeps the statuses of each commit apart', async () => {
      const { sourceControl, world } = setup();

      await sourceControl.postStatus(getMockStatus());
      await sourceControl.postStatus(getMockStatus({ commit: 'c2', state: 'success', description: 'All 9 tasks done' }));

      expect(world.statusesOf('c1')).toEqual([getMockStatus()]);
      expect(world.statusesOf('c2')).toEqual([getMockStatus({ commit: 'c2', state: 'success', description: 'All 9 tasks done' })]);
    });

    it('reads a file as it is at a commit, and nothing for a file that is not there', async () => {
      const { sourceControl, world } = setup();
      world.putFile('c1', 'openspec/changes/archive/2026-11-21-billing-export/tasks.md', '- [ ] 1.1 Open\n');
      world.putFile('c2', 'openspec/changes/archive/2026-11-21-billing-export/tasks.md', '- [x] 1.1 Open\n');

      expect(await sourceControl.readFileAt({ path: 'openspec/changes/archive/2026-11-21-billing-export/tasks.md', commit: 'c1' })).toBe('- [ ] 1.1 Open\n');
      expect(await sourceControl.readFileAt({ path: 'openspec/changes/archive/2026-11-21-billing-export/tasks.md', commit: 'c2' })).toBe('- [x] 1.1 Open\n');
      expect(await sourceControl.readFileAt({ path: 'openspec/changes/archive/2026-11-21-billing-export/design.md', commit: 'c1' })).toBeUndefined();
    });

    it('lists the files a pull request adds or changes', async () => {
      const context = setup();
      context.world.putFile('c1', 'openspec/changes/archive/2026-11-21-billing-export/tasks.md', '- [ ] 1.1 Open\n');
      context.world.putFile('c1', 'src/billing/export.ts', 'export {}\n');
      const pullRequest = await open(context);

      expect((await context.sourceControl.changedFiles(pullRequest.number)).toSorted()).toEqual(['openspec/changes/archive/2026-11-21-billing-export/tasks.md', 'src/billing/export.ts']);
    });

    it('says whether a check is required on a branch, or that it cannot tell', async () => {
      const { sourceControl, world } = setup();

      const none = await sourceControl.requiredChecks('main');
      world.requireChecks('main', ['factory/tasks']);
      const required = await sourceControl.requiredChecks('main');
      world.requireChecks('main', 'unreadable');
      const unreadable = await sourceControl.requiredChecks('main');

      expect(none !== 'unreadable' && requiresCheck(none, 'factory/tasks')).toBe(false);
      expect(required !== 'unreadable' && requiresCheck(required, 'factory/tasks')).toBe(true);
      expect(unreadable).toBe('unreadable');
    });

    it.skipIf(capabilities.revert)('says plainly that it cannot open a revert pull request', async () => {
      const context = setup();
      const pullRequest = await open(context);
      context.world.merge(pullRequest.number, 'maya');

      await expect(context.sourceControl.openRevertPullRequest(pullRequest.number)).rejects.toThrow(/revert/i);
    });

    it.skipIf(!capabilities.revert)('opens a revert pull request that names the one it reverts', async () => {
      const context = setup();
      const pullRequest = await open(context);
      context.world.merge(pullRequest.number, 'maya');

      const revert = await context.sourceControl.openRevertPullRequest(pullRequest.number);

      expect(revert.number).not.toBe(pullRequest.number);
      expect(revert.state).toBe('open');
      expect(revert.reverts).toBe(pullRequest.number);
      expect((await context.sourceControl.getPullRequest(revert.number))?.reverts).toBe(pullRequest.number);
      expect((await context.sourceControl.getPullRequest(pullRequest.number))?.reverts).toBeUndefined();
    });

    it.skipIf(!capabilities.revert)('refuses to revert a pull request that was never merged', async () => {
      const context = setup();
      const pullRequest = await open(context);

      await expect(context.sourceControl.openRevertPullRequest(pullRequest.number)).rejects.toThrow();
    });
  });
};
