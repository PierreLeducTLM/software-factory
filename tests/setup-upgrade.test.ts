import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { Migration } from '../src/setup/migrate.js';
import { createInMemoryProjectFiles, type PublishedChange } from '../src/setup/project-files.js';
import { upgradeProject } from '../src/setup/upgrade.js';

const FACTORY = `# Owned by the platform team. To move to another engine: run factory migrate
schema: 1
engine: 0.1.0
states: { to_refine: To refine, spec_review: Spec review, ready_for_dev: Ready for Dev, in_development: In development, in_review: In review, blocked: Blocked, done: Done }
checks:
  - { id: unit-tests, station: quality, kind: script, blocking: true, timeout: 6m, run: pnpm run test }
risk: { low: { merge: auto }, medium: { merge: human }, high: { merge: human }, sensitive_paths: [] }
`;

const RENAME_RISK: Migration = {
  from: 1,
  summary: 'risk is now called routing',
  apply: ({ risk, ...rest }) => ({ ...rest, routing: risk }),
};

type Options = Parameters<typeof upgradeProject>[1];

const upgrade = async (files: Readonly<Record<string, string>>, options: Options) => {
  const published: PublishedChange[] = [];
  const opened: { branch: string; base: string; title: string; body: string }[] = [];
  const result = await upgradeProject(
    {
      files: createInMemoryProjectFiles(files),
      publishFiles: async (change) => void published.push(change),
      openPullRequest: async (request) => {
        opened.push(request);
        return { url: `https://github.com/acme/billing-service/pull/${opened.length + 40}` };
      },
    },
    options,
  );
  return { result, published, opened };
};

describe('upgrading a project to a newer engine', () => {
  it('opens a pull request that pins the new engine, keeps the comments, and leaves the project as it is until merged', async () => {
    const files = { '.factory/factory.yaml': FACTORY };

    const { result, published, opened } = await upgrade(files, { engine: '0.2.0' });

    expect(result).toEqual({ ok: true, action: 'opened', url: 'https://github.com/acme/billing-service/pull/41', from: { engine: '0.1.0', schema: 1 }, to: { engine: '0.2.0', schema: 1 }, applied: [] });
    expect(published).toEqual([
      { branch: 'factory/upgrade-engine-0.2.0', base: 'main', files: { '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', 'engine: 0.2.0') }, message: 'chore: upgrade the factory engine to 0.2.0' },
    ]);
    expect(opened).toEqual([
      {
        branch: 'factory/upgrade-engine-0.2.0',
        base: 'main',
        title: 'chore: upgrade the factory engine to 0.2.0',
        body: [
          'Moves this project from factory engine 0.1.0 to 0.2.0.',
          '',
          'The configuration schema stays at version 1.',
          '',
          'Nothing changes until this pull request is merged: the project keeps running engine 0.1.0 until then.',
        ].join('\n'),
      },
    ]);
    expect(files['.factory/factory.yaml']).toBe(FACTORY);
  });

  it('migrates the schema in the same pull request, and lists each migration', async () => {
    const { result, published, opened } = await upgrade({ '.factory/factory.yaml': FACTORY.replace('schema: 1\n', 'schema: 1\nmain_branch: develop\n') }, { engine: '0.2.0', upgrade: { target: 2, migrations: [RENAME_RISK] } });

    expect(result).toMatchObject({ ok: true, action: 'opened', from: { schema: 1 }, to: { schema: 2 }, applied: ['risk is now called routing'] });
    expect(published.map(({ branch, base }) => ({ branch, base }))).toEqual([{ branch: 'factory/upgrade-engine-0.2.0', base: 'develop' }]);
    expect(parse(published[0]?.files['.factory/factory.yaml'] ?? '')).toMatchObject({ schema: 2, engine: '0.2.0', main_branch: 'develop', routing: { low: { merge: 'auto' } } });
    expect(parse(published[0]?.files['.factory/factory.yaml'] ?? '')).not.toHaveProperty('risk');
    expect(opened[0]?.base).toBe('develop');
    expect(opened[0]?.body.split('\n').slice(2, 5)).toEqual(['The configuration schema moves from version 1 to 2:', '- risk is now called routing', '']);
  });

  it('opens a pull request for a schema change alone', async () => {
    const { result } = await upgrade({ '.factory/factory.yaml': FACTORY }, { engine: '0.1.4', upgrade: { target: 2, migrations: [RENAME_RISK] } });

    expect(result).toMatchObject({ ok: true, action: 'opened', from: { engine: '0.1.0', schema: 1 }, to: { engine: '0.1.4', schema: 2 } });
  });

  it('does nothing for a project already on this engine release and schema', async () => {
    const { result, published, opened } = await upgrade({ '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', 'engine: 0.1.2') }, { engine: '0.1.7' });

    expect(result).toEqual({ ok: true, action: 'none', message: 'Nothing to upgrade: the project is on engine 0.1.2 and schema 1, which this engine (0.1.7) runs as they are.' });
    expect(published).toEqual([]);
    expect(opened).toEqual([]);
  });

  it.each([
    ['0.3.0', '0.2.9'],
    ['1.0.0', '0.9.0'],
    ['0.10.0', '0.9.0'],
  ])('never moves a project pinned to %s back to engine %s', async (pinned, running) => {
    const { result, published } = await upgrade({ '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', `engine: ${pinned}`) }, { engine: running });

    expect(result).toEqual({ ok: false, reason: 'newer_engine', message: `This project pins factory engine ${pinned}, newer than this engine (${running}). Install engine ${pinned} instead.` });
    expect(published).toEqual([]);
  });

  it.each([
    ['0.2.0', '0.10.0'],
    ['0.9.0', '1.0.0'],
  ])('moves a project pinned to %s forward to engine %s', async (pinned, running) => {
    const { result } = await upgrade({ '.factory/factory.yaml': FACTORY.replace('engine: 0.1.0', `engine: ${pinned}`) }, { engine: running });

    expect(result).toMatchObject({ ok: true, action: 'opened' });
  });

  it('refuses a project with no configuration, or one on a schema this engine does not know', async () => {
    const missing = await upgrade({}, { engine: '0.2.0' });
    const ahead = await upgrade({ '.factory/factory.yaml': FACTORY.replace('schema: 1', 'schema: 3') }, { engine: '0.2.0', upgrade: { target: 2, migrations: [RENAME_RISK] } });

    expect(missing.result).toEqual({ ok: false, reason: 'missing', message: '.factory/factory.yaml is missing. Run /factory-init' });
    expect(ahead.result).toEqual({ ok: false, reason: 'schema', message: 'factory.yaml uses schema 3, newer than this engine understands (2). Upgrade the engine.' });
    expect([...missing.published, ...ahead.published]).toEqual([]);
  });
});
