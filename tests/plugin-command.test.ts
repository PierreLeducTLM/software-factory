import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_LAUNCHER, enginePackage } from '../src/setup/engine-files.js';
import { ENGINE_VERSION } from '../src/version.js';

const ROOT = join(import.meta.dirname, '..');

const STUB_NPM = `#!/bin/sh
prefix=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then prefix="$2"; fi
  shift
done
mkdir -p "$prefix/node_modules/.bin"
cat > "$prefix/node_modules/.bin/factory" <<'EOF2'
#!/bin/sh
echo "cache-engine $*"
EOF2
chmod +x "$prefix/node_modules/.bin/factory"
`;

const write = (path: string, content: string, mode = 0o644): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
};

const getWorld = () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-plugin-'));
  const plugin = join(root, 'plugin');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(plugin, 'bin'));
  mkdirSync(join(plugin, 'engine'));
  copyFileSync(join(ROOT, 'bin', 'factory'), join(plugin, 'bin', 'factory'));
  copyFileSync(join(ROOT, 'engine', 'launcher'), join(plugin, 'engine', 'launcher'));
  copyFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), join(plugin, '.claude-plugin', 'plugin.json'));
  write(join(root, 'tools', 'npm'), STUB_NPM, 0o755);
  const cache = join(root, 'cache');
  const run = (cwd: string, args: readonly string[]) =>
    spawnSync('sh', [join(plugin, 'bin', 'factory'), ...args], { cwd, encoding: 'utf8', env: { PATH: `${join(root, 'tools')}:/usr/bin:/bin`, HOME: root, XDG_CACHE_HOME: cache } });
  return { root, cache, run };
};

describe('the plugin command', () => {
  it('runs the launcher of the project that installed the factory, from any folder of it', () => {
    const { root, run } = getWorld();
    const project = join(root, 'project');
    spawnSync('git', ['init', '--quiet', project]);
    write(join(project, '.factory', 'bin', 'factory'), '#!/bin/sh\necho "project-launcher $*"\n', 0o755);
    mkdirSync(join(project, 'src'));

    expect(run(join(project, 'src'), ['doctor']).stdout).toBe('project-launcher doctor\n');
  });

  it('runs migrate with the engine of the plugin release, so a project can move past the engine it pins', () => {
    const { root, cache, run } = getWorld();
    const project = join(root, 'project');
    spawnSync('git', ['init', '--quiet', project]);
    write(join(project, '.factory', 'bin', 'factory'), '#!/bin/sh\necho "project-launcher $*"\n', 0o755);

    const result = run(project, ['migrate', '--json']);

    expect(result.stdout).toBe('cache-engine migrate --json\n');
    expect(readFileSync(join(cache, 'software-factory', ENGINE_VERSION, 'package.json'), 'utf8')).toBe(enginePackage(ENGINE_VERSION));
  });

  it('runs the engine of the plugin release from the user cache when the project has none yet', () => {
    const { root, cache, run } = getWorld();
    const empty = join(root, 'empty');
    mkdirSync(empty);

    const result = run(empty, ['init', '--json']);

    expect(result.stdout).toBe('cache-engine init --json\n');
    expect(readFileSync(join(cache, 'software-factory', ENGINE_VERSION, 'package.json'), 'utf8')).toBe(enginePackage(ENGINE_VERSION));
    expect(existsSync(join(empty, '.factory'))).toBe(false);
  });
});

describe('the files the plugin ships', () => {
  it('keeps the launcher copy identical to the one a project commits', () => {
    expect(readFileSync(join(ROOT, 'engine', 'launcher'), 'utf8')).toBe(ENGINE_LAUNCHER);
  });

  it.each(['bin/factory', 'engine/launcher'])('marks %s as executable', (path) => {
    expect(statSync(join(ROOT, path)).mode & 0o111).not.toBe(0);
  });
});
