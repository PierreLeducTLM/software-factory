import { expect, it } from 'vitest';
import { createInMemorySourceControl } from '../src/adapters/in-memory-source-control.js';
import { describeSourceControlContract } from './contracts/source-control-contract.js';

describeSourceControlContract('in-memory fake', () => {
  const clock = { now: '2026-11-21T08:00:00Z' };
  const { sourceControl, world } = createInMemorySourceControl({ now: () => clock.now });
  return {
    sourceControl,
    world: {
      ...world,
      advanceClock: (iso) => {
        clock.now = iso;
      },
    },
  };
});

it('refuses to open a pull request for a branch nobody pushed', async () => {
  const { sourceControl } = createInMemorySourceControl({ now: () => '2026-11-21T08:00:00Z' });

  await expect(
    sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'x', body: 'y' }),
  ).rejects.toThrow('Branch factory/pay-142 has no commits');
});

it('stops following a branch once its pull request is merged', async () => {
  const { sourceControl, world } = createInMemorySourceControl({ now: () => '2026-11-21T08:00:00Z' });
  world.push('factory/pay-142', 'c1');
  const pullRequest = await sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'x', body: 'y' });
  world.merge(pullRequest.number, 'maya');

  world.push('factory/pay-142', 'later');

  expect(await sourceControl.wasMergedAsIs({ number: pullRequest.number, commit: 'c1' })).toBe(true);
});

it('numbers pull requests one after the other', async () => {
  const { sourceControl, world } = createInMemorySourceControl({ now: () => '2026-11-21T08:00:00Z' });
  world.push('a', 'c1');
  world.push('b', 'c2');

  const first = await sourceControl.openPullRequest({ branch: 'a', base: 'main', title: 'x', body: 'y' });
  const second = await sourceControl.openPullRequest({ branch: 'b', base: 'main', title: 'x', body: 'y' });

  expect([first.number, second.number]).toEqual([401, 402]);
});

it('opens a revert on its own branch with its own commit, saying what it reverts', async () => {
  const { sourceControl, world } = createInMemorySourceControl({ now: () => '2026-11-21T08:00:00Z' });
  world.push('factory/pay-142', 'c1');
  const original = await sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'x', body: 'y' });
  world.merge(original.number, 'maya');

  const revert = await sourceControl.openRevertPullRequest(original.number);

  expect(revert.branch).toBe('revert-401');
  expect(revert.headCommit).toBe('revert-of-c1');
  expect(revert.body).toBe('Reverts #401');
});

it('says why it will not revert an unmerged pull request', async () => {
  const { sourceControl, world } = createInMemorySourceControl({ now: () => '2026-11-21T08:00:00Z' });
  world.push('factory/pay-142', 'c1');
  const original = await sourceControl.openPullRequest({ branch: 'factory/pay-142', base: 'main', title: 'x', body: 'y' });

  await expect(sourceControl.openRevertPullRequest(original.number)).rejects.toThrow('Pull request 401 is not merged');
});
