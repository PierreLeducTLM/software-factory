const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

export const duration = (seconds: number): string => {
  if (seconds < MINUTE) return `${seconds}s`;
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  const minutes = Math.floor((seconds % HOUR) / MINUTE);
  return minutes === 0 ? `${Math.floor(seconds / HOUR)}h` : `${Math.floor(seconds / HOUR)}h ${minutes}m`;
};

const count = (amount: number, unit: string): string => `${amount} ${unit}${amount === 1 ? '' : 's'}`;

export const waiting = (since: string, now: string): string => {
  const seconds = Math.max(Math.round((Date.parse(now) - Date.parse(since)) / 1000), 0);
  if (seconds < HOUR) return count(Math.floor(seconds / MINUTE), 'min');
  if (seconds < DAY) return count(Math.floor(seconds / HOUR), 'hour');
  return count(Math.floor(seconds / DAY), 'day');
};

export const clockTime = (iso: string): string => iso.slice(11, 16);
