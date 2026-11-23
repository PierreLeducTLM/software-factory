export const ENGINE_VERSION = '0.2.4';

const release = (version: string): string => version.split('.').slice(0, 2).join('.');

export const enginePinMatches = (pinned: string, running: string = ENGINE_VERSION): boolean => release(pinned) === release(running);

const patch = (version: string): number => Number(version.split('.')[2] ?? 0);

export const isNewerPatch = (pinned: string, running: string = ENGINE_VERSION): boolean => enginePinMatches(pinned, running) && patch(running) > patch(pinned);

export const enginePinMessage = (pinned: string, running: string = ENGINE_VERSION): string =>
  `This project pins factory engine ${pinned} in .factory/factory.yaml, and this is engine ${running}. Install engine ${pinned}, or upgrade the project with /factory-doctor.`;
