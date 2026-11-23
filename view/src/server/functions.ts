import { createServerFn } from '@tanstack/react-start';
import { getSource } from './source';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const fetchView = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    return { ok: true as const, data: await (await getSource()).load() };
  } catch (error) {
    return { ok: false as const, message: messageOf(error) };
  }
});

export const reloadView = createServerFn({ method: 'POST' }).handler(async () => {
  try {
    return { ok: true as const, data: await (await getSource()).reload() };
  } catch (error) {
    return { ok: false as const, message: messageOf(error) };
  }
});

export const fetchDetail = createServerFn({ method: 'GET' })
  .validator((key: string) => key)
  .handler(async ({ data }) => (await (await getSource()).detail(data)) ?? null);

export const openRun = createServerFn({ method: 'POST' })
  .validator((key: string) => key)
  .handler(async ({ data }) => (await getSource()).openInOrca(data));

const PERIODS = [7, 30, 90];

export const fetchHealth = createServerFn({ method: 'GET' })
  .validator((days: number) => (PERIODS.includes(days) ? days : 7))
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, data: await (await getSource()).health(data) };
    } catch (error) {
      return { ok: false as const, message: messageOf(error) };
    }
  });
