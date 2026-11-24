export const ENGINE_VERSION = '0.2.9';

const release = (version: string): string => version.split('.').slice(0, 2).join('.');

export const enginePinMatches = (pinned: string, running: string = ENGINE_VERSION): boolean => release(pinned) === release(running);

export const enginePinMessage = (pinned: string, running: string = ENGINE_VERSION): string =>
  `This project pins factory engine ${pinned} in .factory/factory.yaml, and this is engine ${running}. Install engine ${pinned}, or upgrade the project with /factory-doctor.`;
