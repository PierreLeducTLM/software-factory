export const VIEW_SERVER_PATH = 'view/.output/server/index.mjs';
export const VIEW_STAMP_PATH = 'view/.output/engine-version';

type BuildOptions = {
  readonly version: string;
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string;
};

const REBUILD = 'Run: pnpm build:view, then commit view/.output';

export const viewBuildProblem = ({ version, exists, read }: BuildOptions): string | undefined => {
  if (!exists(VIEW_SERVER_PATH)) return `The committed dashboard build is missing (${VIEW_SERVER_PATH}). ${REBUILD}`;
  if (!exists(VIEW_STAMP_PATH)) return `The committed dashboard build has no engine version stamp (${VIEW_STAMP_PATH}). ${REBUILD}`;
  const built = read(VIEW_STAMP_PATH).trim();
  return built === version ? undefined : `The committed dashboard was built for engine ${built}, and this is engine ${version}. ${REBUILD}`;
};
