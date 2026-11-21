export const matchesPath = (pattern: string, file: string): boolean => {
  if (!pattern.includes('*')) return file === pattern || file.startsWith(`${pattern}/`);
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`).test(file);
};
