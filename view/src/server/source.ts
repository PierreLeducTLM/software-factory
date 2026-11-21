import { createProjectViewSource } from '../../../src/cli/real-deps.js';
import type { ViewSource } from '../../../src/view/source.js';

const holder: { source?: Promise<ViewSource> } = {};

export const getSource = (): Promise<ViewSource> => {
  holder.source ??= createProjectViewSource({ cwd: process.env['FACTORY_PROJECT_DIR'] ?? process.cwd(), env: process.env });
  return holder.source;
};
