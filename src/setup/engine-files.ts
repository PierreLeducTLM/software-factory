export const ENGINE_SOURCE = 'git+https://github.com/PierreLeducTLM/software-factory.git';

export const ENGINE_LAUNCHER = `#!/bin/sh
# Runs the factory engine this project pins in .factory/package.json.
# The first call installs it into .factory/node_modules, which git ignores.
# A private factory repository is read with FACTORY_REPO_TOKEN when it is set.
dir=$(cd "$(dirname "$0")/.." && pwd)
stamp="$dir/node_modules/.installed"
if [ ! -f "$stamp" ] || [ "$dir/package.json" -nt "$stamp" ]; then
  (
    if [ -n "$FACTORY_REPO_TOKEN" ]; then
      export GIT_CONFIG_COUNT=1
      export GIT_CONFIG_KEY_0="url.https://x-access-token:$FACTORY_REPO_TOKEN@github.com/.insteadOf"
      export GIT_CONFIG_VALUE_0="https://github.com/"
    fi
    npm install --prefix "$dir" --no-audit --no-fund --loglevel=error 1>&2
  ) || { echo "The factory engine could not be installed. If its repository is private, set FACTORY_REPO_TOKEN to a token that can read it." 1>&2; exit 1; }
  mkdir -p "$dir/node_modules" && touch "$stamp"
fi
exec "$dir/node_modules/.bin/factory" "$@"
`;

export const LAUNCHER_PATH = '.factory/bin/factory';
export const ENGINE_PACKAGE_PATH = '.factory/package.json';

export const enginePackage = (engine: string): string =>
  `${JSON.stringify({ private: true, dependencies: { 'software-factory': `${ENGINE_SOURCE}#v${engine}` } }, null, 2)}\n`;

export const engineFiles = (engine: string): Readonly<Record<string, string>> => ({
  [ENGINE_PACKAGE_PATH]: enginePackage(engine),
  [LAUNCHER_PATH]: ENGINE_LAUNCHER,
  '.factory/.gitignore': 'node_modules/\npackage-lock.json\n',
});
