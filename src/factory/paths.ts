const ANY_DIRECTORIES = '\u0000';
const ANYTHING = '\u0001';

export const matchesPath = (pattern: string, file: string): boolean => {
  if (!pattern.includes('*')) return file === pattern || file.startsWith(`${pattern}/`);
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**/', ANY_DIRECTORIES)
    .replaceAll('**', ANYTHING)
    .replaceAll('*', '[^/]*')
    .replaceAll(ANY_DIRECTORIES, '(?:.*/)?')
    .replaceAll(ANYTHING, '.*');
  return new RegExp(`^${escaped}$`).test(file);
};

const fixedPartOf = (pattern: string): string => {
  const star = pattern.indexOf('*');
  return (star === -1 ? pattern : pattern.slice(0, star)).replace(/\/$/, '');
};

const isWithin = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

export const patternsOverlap = (pattern: string, announced: string): boolean => {
  const fixed = fixedPartOf(pattern);
  if (!announced.includes('*')) return matchesPath(pattern, announced) || isWithin(fixed, announced);
  const folder = fixedPartOf(announced);
  if (folder === '') return true;
  if (fixed === '') return matchesPath(pattern, `${folder}/`);
  return isWithin(fixed, folder) || isWithin(folder, fixed);
};
