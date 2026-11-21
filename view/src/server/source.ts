import { createProjectViewSource, createSampleViewSource } from '../../../src/cli/real-deps.js';
import type { ViewSource } from '../../../src/view/source.js';

const holder: { source?: Promise<ViewSource> } = {};

export const getSource = (): Promise<ViewSource> => {
  holder.source ??=
    process.env['FACTORY_VIEW_SAMPLE'] === '1'
      ? Promise.resolve(createSampleViewSource())
      : createProjectViewSource({ cwd: process.env['FACTORY_PROJECT_DIR'] ?? process.cwd(), env: process.env });
  return holder.source;
};
