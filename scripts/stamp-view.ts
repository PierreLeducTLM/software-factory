import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIEW_STAMP_PATH } from '../src/view-build.ts';
import { ENGINE_VERSION } from '../src/version.ts';

writeFileSync(join(import.meta.dirname, '..', VIEW_STAMP_PATH), `${ENGINE_VERSION}\n`);
