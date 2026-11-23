import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_LAUNCHER, ENGINE_SOURCE, engineFiles } from '../src/setup/engine-files.js';

const write = (path: string, content: string, mode = 0o644): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
};

const STUB_NPM = `#!/bin/sh
prefix=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then prefix="$2"; fi
  shift
done
echo "install $GIT_CONFIG_KEY_0=$GIT_CONFIG_VALUE_0" >> "$STUB_LOG"
if [ -n "$STUB_FAIL" ]; then echo "npm failed" >&2; exit 1; fi
mkdir -p "$prefix/node_modules/.bin"
echo '{"lockfileVersion":3}' > "$prefix/package-lock.json"
cat > "$prefix/node_modules/.bin/factory" <<'EOF'
#!/bin/sh
echo "engine $PWD $*"
EOF
chmod +x "$prefix/node_modules/.bin/factory"
`;

const getProject = () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-launcher-'));
  const tools = join(root, 'tools');
  write(join(tools, 'npm'), STUB_NPM, 0o755);
  const files = engineFiles('0.1.0');
  Object.entries(files).forEach(([path, content]) => write(join(root, 'project', path), content, path === '.factory/bin/factory' ? 0o755 : 0o644));
  const log = join(root, 'log');
  writeFileSync(log, '');
  const launcher = join(root, 'project', '.factory', 'bin', 'factory');
  const run = (args: readonly string[], env: Readonly<Record<string, string>> = {}, cwd = join(root, 'project')) =>
    spawnSync('sh', [launcher, ...args], { cwd, encoding: 'utf8', env: { PATH: `${tools}:/usr/bin:/bin`, STUB_LOG: log, ...env } });
  return { root, run, installs: () => readFileSync(log, 'utf8').split('\n').filter((line) => line !== ''), project: join(root, 'project') };
};

describe('the engine files a project commits', () => {
  it('pins the engine to the release tag of the factory repository, and keeps its install and its lockfile out of git', () => {
    const files = engineFiles('0.1.0');

    expect(JSON.parse(files['.factory/package.json'] ?? '')).toEqual({ private: true, dependencies: { 'software-factory': `${ENGINE_SOURCE}#v0.1.0` } });
    expect(files['.factory/.gitignore']).toBe('node_modules/\npackage-lock.json\n');
    expect(files['.factory/bin/factory']).toBe(ENGINE_LAUNCHER);
  });
});

describe('the launcher in .factory/bin', () => {
  it('installs the pinned engine on first use, then runs it where it was called, with the arguments', () => {
    const { run, installs, project } = getProject();

    const result = run(['doctor', '--json']);

    expect(result.stdout.trim()).toBe(`engine ${execFileSync('sh', ['-c', 'pwd -P'], { cwd: project, encoding: 'utf8' }).trim()} doctor --json`);
    expect(result.status).toBe(0);
    expect(installs()).toEqual(['install =']);
  });

  it('leaves no untracked file under .factory after its first run in a fresh checkout', () => {
    const { run, project } = getProject();
    const git = (args: readonly string[]) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.com', ...args], { cwd: project, encoding: 'utf8' });
    git(['init', '--quiet']);
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'install the factory']);

    run(['doctor']);

    expect(existsSync(join(project, '.factory', 'package-lock.json'))).toBe(true);
    expect(git(['status', '--porcelain', '--untracked-files=all', '.factory'])).toBe('');
  });

  it('runs from any folder of the project and does not install again', () => {
    const { run, installs, project } = getProject();
    mkdirSync(join(project, 'src'));

    run(['one']);
    const second = run(['two'], {}, join(project, 'src'));

    expect(second.stdout).toContain('two');
    expect(installs()).toHaveLength(1);
  });

  it('installs again when the pin changed after the last install', () => {
    const { run, installs, project } = getProject();
    run(['one']);
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(project, '.factory', 'package.json'), later, later);

    run(['two']);

    expect(installs()).toHaveLength(2);
  });

  it('tells git to read the factory repository with the token, for that install only', () => {
    const { run, installs } = getProject();

    const result = run(['one'], { FACTORY_REPO_TOKEN: 'tok123' });

    expect(installs()).toEqual(['install url.https://x-access-token:tok123@github.com/.insteadOf=https://github.com/']);
    expect(result.stdout).toContain('one');
  });

  it('stops with the install error and runs nothing when the install fails, so the next call tries again', () => {
    const { run, installs, project } = getProject();

    const failed = run(['one'], { STUB_FAIL: '1' });
    const stamped = existsSync(join(project, '.factory', 'node_modules', '.installed'));
    const retried = run(['two']);

    expect(failed.status).toBe(1);
    expect(failed.stdout).toBe('');
    expect(failed.stderr).toContain('npm failed');
    expect(failed.stderr).toContain('set FACTORY_REPO_TOKEN to a token that can read it');
    expect(stamped).toBe(false);
    expect(retried.stdout).toContain('two');
    expect(installs()).toHaveLength(2);
  });
});
