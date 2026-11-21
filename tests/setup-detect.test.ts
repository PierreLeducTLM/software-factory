import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectProject, type Detection } from '../src/setup/detect.js';
import { createInMemoryProjectFiles, createProjectFiles } from '../src/setup/project-files.js';

const PACKAGE = JSON.stringify({
  scripts: { test: 'vitest run', lint: 'eslint .', build: 'vite build', 'test:e2e': 'playwright test', dev: 'vite dev' },
  dependencies: { react: '^19.0.0', '@tanstack/react-start': '^1.0.0' },
  devDependencies: { typescript: '^5.9.0', tailwindcss: '^4.0.0' },
});

const WORKFLOW = `
name: CI
on: [push]
jobs:
  unit:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          pnpm install
          pnpm test
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - run: trivy fs .
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/ship.sh
`;

const detect = (files: Readonly<Record<string, string>>, remoteUrl?: string): Promise<Detection> =>
  detectProject({ files: createInMemoryProjectFiles(files), ...(remoteUrl === undefined ? {} : { remoteUrl }) });

const coverageOf = (detection: Detection) => Object.fromEntries(detection.coverage.map(({ category, candidates }) => [category, candidates]));

describe('detecting a TypeScript project', () => {
  it('finds the stack, the framework and the checks the scripts already offer', async () => {
    const detection = await detect({ 'package.json': PACKAGE, 'tsconfig.json': '{}', 'pnpm-lock.yaml': '' });

    expect(detection.stack).toEqual({ kind: 'typescript', framework: 'TanStack Start', inDepth: true });
    expect(detection.candidates).toEqual([
      { id: 'test', category: 'tests', source: 'local', run: 'pnpm run test', from: 'package.json' },
      { id: 'lint', category: 'lint', source: 'local', run: 'pnpm run lint', from: 'package.json' },
      { id: 'build', category: 'build', source: 'local', run: 'pnpm run build', from: 'package.json' },
      { id: 'test-e2e', category: 'e2e', source: 'local', run: 'pnpm run test:e2e', from: 'package.json' },
    ]);
    expect(detection.designSystem).toBe('Tailwind CSS');
  });

  it('shows coverage per category and recommends a check where one is missing', async () => {
    const detection = await detect({ 'package.json': PACKAGE, 'tsconfig.json': '{}', 'pnpm-lock.yaml': '' });

    expect(coverageOf(detection)).toEqual({ tests: ['test'], lint: ['lint'], types: [], format: [], security: [], build: ['build'], e2e: ['test-e2e'] });
    expect(detection.coverage.find(({ category }) => category === 'types')?.recommended).toEqual({
      id: 'typecheck',
      run: 'pnpm run typecheck',
      how: 'pnpm add --dev typescript, then add "typecheck": "tsc --noEmit" to the scripts',
    });
    expect(detection.coverage.find(({ category }) => category === 'tests')).not.toHaveProperty('recommended');
    expect(detection.coverage.find(({ category }) => category === 'e2e')).not.toHaveProperty('recommended');
  });

  it.each([
    [{ 'yarn.lock': '' }, 'yarn run test', 'yarn add --dev typescript'],
    [{ 'bun.lock': '' }, 'bun run test', 'bun add --dev typescript'],
    [{ 'bun.lockb': '' }, 'bun run test', 'bun add --dev typescript'],
    [{ 'package-lock.json': '{}' }, 'npm run test', 'npm install --save-dev typescript'],
  ])('uses the package manager of the lock file (%#)', async (lock, run, install) => {
    const detection = await detect({ 'package.json': PACKAGE, 'tsconfig.json': '{}', ...lock });

    expect(detection.candidates[0]?.run).toBe(run);
    expect(detection.coverage.find(({ category }) => category === 'types')?.recommended?.how).toContain(install);
  });

  it.each([
    [{ next: '15', react: '19' }, {}, 'Next.js', undefined],
    [{ react: '19' }, { storybook: '9' }, 'React', 'Storybook'],
    [{}, { typescript: '5' }, undefined, undefined],
  ])('names the framework and the design system it finds (%#)', async (dependencies, devDependencies, framework, designSystem) => {
    const detection = await detect({ 'package.json': JSON.stringify({ dependencies, devDependencies }), 'tsconfig.json': '{}' });

    expect(detection.stack.framework).toBe(framework);
    expect(detection.designSystem).toBe(designSystem);
  });

  it('recognises a TypeScript project by its dependency when it has no tsconfig at the root, and Storybook by its folder', async () => {
    const detection = await detect({ 'package.json': JSON.stringify({ devDependencies: { typescript: '5' } }), '.storybook/main.ts': '' });

    expect(detection.stack.kind).toBe('typescript');
    expect(detection.designSystem).toBe('Storybook');
  });
});

describe('detecting a Django project', () => {
  it('finds the tools the project configures', async () => {
    const detection = await detect({
      'manage.py': '#!/usr/bin/env python',
      'pyproject.toml': '[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\n\n[tool.black]\n',
      'requirements-dev.txt': 'django-stubs\nbandit==1.7\n',
    });

    expect(detection.stack).toEqual({ kind: 'django', framework: 'Django', inDepth: true });
    expect(detection.candidates.map(({ id, category, run }) => [id, category, run])).toEqual([
      ['pytest', 'tests', 'pytest'],
      ['ruff', 'lint', 'ruff check .'],
      ['black', 'format', 'black --check .'],
      ['bandit', 'security', 'bandit -r .'],
      ['django-check', 'build', 'python manage.py check'],
    ]);
    expect(detection.coverage.find(({ category }) => category === 'types')?.recommended).toEqual({ id: 'mypy', run: 'mypy .', how: 'pip install mypy django-stubs, and add them to the development requirements' });
  });

  it('falls back to the Django test runner, and reads tool config files', async () => {
    const detection = await detect({ 'requirements.txt': 'Django==5.1\npip-audit\n', 'mypy.ini': '[mypy]', '.flake8': '[flake8]' });

    expect(detection.stack.kind).toBe('django');
    expect(detection.candidates.map(({ id }) => id)).toEqual(['django-tests', 'flake8', 'mypy', 'pip-audit', 'django-check']);
    expect(detection.candidates[0]).toEqual({ id: 'django-tests', category: 'tests', source: 'local', run: 'python manage.py test', from: 'manage.py' });
    expect(detection).not.toHaveProperty('designSystem');
  });
});

describe('detecting any other project', () => {
  it('derives the checks from the CI files only, and says so', async () => {
    const detection = await detect({ 'go.mod': 'module acme', '.github/workflows/ci.yml': WORKFLOW.replace('pnpm test', 'go test ./...').replace('pnpm install', 'go mod download') });

    expect(detection.stack).toEqual({ kind: 'other', inDepth: false, note: 'In-depth detection is not available for this stack. Checks come from the CI files only.' });
    expect(detection.candidates).toEqual([
      { id: 'unit-tests', category: 'tests', source: 'ci', job: 'Unit tests', from: '.github/workflows/ci.yml' },
      { id: 'security-scan', category: 'security', source: 'ci', job: 'security-scan', from: '.github/workflows/ci.yml' },
    ]);
    expect(detection.coverage.every((entry) => !('recommended' in entry))).toBe(true);
  });

  it('treats a JavaScript project without TypeScript as any other stack', async () => {
    const detection = await detect({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }) });

    expect(detection.stack.kind).toBe('other');
    expect(detection.candidates).toEqual([]);
  });

  it('survives files it cannot parse', async () => {
    const detection = await detect({ 'package.json': '{ not json', 'tsconfig.json': '{}', '.github/workflows/ci.yml': 'jobs: [', '.github/workflows/odd.yml': 'jobs: 3', 'bitbucket-pipelines.yml': 'pipelines: [' });

    expect(detection.stack.kind).toBe('other');
    expect(detection.ci).toEqual({ system: 'none', files: [], jobs: [], factorySteps: [] });
  });
});

describe('reading the CI files', () => {
  it('lists the jobs of every GitHub workflow with their commands', async () => {
    const detection = await detect({ 'package.json': PACKAGE, 'tsconfig.json': '{}', '.github/workflows/ci.yml': WORKFLOW, '.github/workflows/notes.md': 'x', '.github/workflows/release.yaml': 'jobs:\n  publish:\n    steps:\n      - run: npm publish\n' });

    expect(detection.ci.system).toBe('github-actions');
    expect(detection.ci.files).toEqual(['.github/workflows/ci.yml', '.github/workflows/release.yaml']);
    expect(detection.ci.jobs).toEqual([
      { name: 'Unit tests', file: '.github/workflows/ci.yml', commands: ['pnpm install', 'pnpm test'] },
      { name: 'security-scan', file: '.github/workflows/ci.yml', commands: ['trivy fs .'] },
      { name: 'deploy', file: '.github/workflows/ci.yml', commands: ['./scripts/ship.sh'] },
      { name: 'publish', file: '.github/workflows/release.yaml', commands: ['npm publish'] },
    ]);
    expect(coverageOf(detection)).toMatchObject({ tests: ['test', 'unit-tests'], security: ['security-scan'] });
  });

  it('lists the steps of a Bitbucket pipeline once each, including parallel ones', async () => {
    const pipeline = `
pipelines:
  default:
    - step:
        name: Lint
        script:
          - pnpm lint
    - parallel:
        - step:
            name: Unit tests
            script: [pnpm test]
        - step:
            script:
              - pnpm build
              - pipe: atlassian/slack-notify:2.0.0
  branches:
    main:
      - step:
          name: Lint
          script: [pnpm lint]
      - parallel:
          steps:
            - step:
                name: Types
                script: [pnpm exec tsc --noEmit]
      - variables: []
  pull-requests:
    '**':
      - step:
          name: E2E
          script: [pnpm exec playwright test]
`;
    const detection = await detect({ 'bitbucket-pipelines.yml': pipeline });

    expect(detection.ci.system).toBe('bitbucket-pipelines');
    expect(detection.ci.jobs.map(({ name, commands }) => [name, commands])).toEqual([
      ['Lint', ['pnpm lint']],
      ['Unit tests', ['pnpm test']],
      ['step 3', ['pnpm build']],
      ['Types', ['pnpm exec tsc --noEmit']],
      ['E2E', ['pnpm exec playwright test']],
    ]);
    expect(detection.candidates.map(({ id, category, job }) => [id, category, job])).toEqual([
      ['lint', 'lint', 'Lint'],
      ['unit-tests', 'tests', 'Unit tests'],
      ['step-3', 'build', 'step 3'],
      ['types', 'types', 'Types'],
      ['e2e', 'e2e', 'E2E'],
    ]);
  });

  it('finds the factory steps already installed, and does not offer them as checks', async () => {
    const workflow = 'jobs:\n  record:\n    steps:\n      - run: factory record-merge\n  undo:\n    steps:\n      - run: npx factory revert --commit $SHA\n  tests:\n    steps:\n      - run: echo factory watcher\n';
    const detection = await detect({ '.github/workflows/factory.yml': workflow });

    expect(detection.ci.factorySteps).toEqual(['record-merge', 'revert']);
    expect(detection.candidates.map(({ id }) => id)).toEqual(['tests']);
  });
});

describe('the rest of the project', () => {
  it.each([
    ['git@github.com:acme/billing-service.git', { kind: 'github', repository: 'acme/billing-service' }],
    ['https://github.com/acme/billing-service', { kind: 'github', repository: 'acme/billing-service' }],
    ['https://pierre@bitbucket.org/acme/billing-service.git/', { kind: 'bitbucket', repository: 'acme/billing-service' }],
  ])('reads the repository from the remote %s', async (remoteUrl, remote) => {
    expect((await detect({}, remoteUrl)).remote).toEqual(remote);
  });

  it('has no repository for a remote it does not know, or none', async () => {
    expect(await detect({}, 'https://gitlab.com/acme/billing-service.git')).not.toHaveProperty('remote');
    expect(await detect({})).not.toHaveProperty('remote');
  });

  it('says whether the project uses OpenSpec', async () => {
    expect((await detect({ 'openspec/project.md': '# Project' })).openspec).toBe(true);
    expect((await detect({ 'openspecs.md': 'x' })).openspec).toBe(false);
  });

  it('reads a real folder the same way', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-detect-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, 'openspec'));
    writeFileSync(join(root, 'package.json'), PACKAGE);
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'openspec', 'project.md'), '# Project');
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), WORKFLOW);

    const detection = await detectProject({ files: createProjectFiles(root) });

    expect(detection.stack.kind).toBe('typescript');
    expect(detection.openspec).toBe(true);
    expect(detection.ci.jobs).toHaveLength(3);
    expect(detection.candidates[0]?.run).toBe('npm run test');
  });
});
