import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIEW_SERVER_PATH, VIEW_STAMP_PATH, viewBuildProblem } from '../src/view-build.js';
import { ENGINE_VERSION } from '../src/version.js';

const ROOT = join(import.meta.dirname, '..');
const REBUILD = 'Run: pnpm build:view, then commit view/.output';

const getBuild = (files: Readonly<Record<string, string>>) => ({
  version: '0.3.0',
  exists: (path: string) => path in files,
  read: (path: string) => files[path] ?? '',
});

describe('the committed dashboard build', () => {
  it('is accepted when it was built for this engine version', () => {
    expect(viewBuildProblem(getBuild({ [VIEW_SERVER_PATH]: 'server', [VIEW_STAMP_PATH]: '0.3.0\n' }))).toBeUndefined();
  });

  it('is refused when the dashboard server is missing', () => {
    expect(viewBuildProblem(getBuild({ [VIEW_STAMP_PATH]: '0.3.0\n' }))).toBe(
      `The committed dashboard build is missing (view/.output/server/index.mjs). ${REBUILD}`,
    );
  });

  it('is refused when it has no engine version stamp', () => {
    expect(viewBuildProblem(getBuild({ [VIEW_SERVER_PATH]: 'server' }))).toBe(
      `The committed dashboard build has no engine version stamp (view/.output/engine-version). ${REBUILD}`,
    );
  });

  it('is refused when it was built for another engine version', () => {
    expect(viewBuildProblem(getBuild({ [VIEW_SERVER_PATH]: 'server', [VIEW_STAMP_PATH]: '0.2.4\n' }))).toBe(
      `The committed dashboard was built for engine 0.2.4, and this is engine 0.3.0. ${REBUILD}`,
    );
  });

  it('in this repository was built for this engine version, so a release ships a current dashboard', () => {
    const problem = viewBuildProblem({
      version: ENGINE_VERSION,
      exists: (path) => existsSync(join(ROOT, path)),
      read: (path) => readFileSync(join(ROOT, path), 'utf8'),
    });

    expect(problem).toBeUndefined();
  });
});
