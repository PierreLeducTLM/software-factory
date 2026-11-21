import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createFetchHttp, sleep, withRateLimitRetry, type Http, type HttpResponse } from '../src/adapters/http.js';

const respond = (status: number, headers: Record<string, string> = {}): HttpResponse => ({ status, headers, body: `status ${status}` });

const scripted = (responses: readonly HttpResponse[]) => {
  const calls: string[] = [];
  const http: Http = async (request) => {
    calls.push(request.url);
    return responses[calls.length - 1] ?? respond(500);
  };
  return { http, calls };
};

const recordingSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

const request = { method: 'GET', url: 'https://example.test/a', headers: {} } as const;

describe('rate-limit back-off', () => {
  it('passes a normal response straight through without waiting', async () => {
    const { http, calls } = scripted([respond(200)]);
    const { waits, sleep } = recordingSleep();

    const response = await withRateLimitRetry(http, { sleep, maxRetries: 3 })(request);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('waits for the time the provider indicates, then retries', async () => {
    const { http, calls } = scripted([respond(429, { 'retry-after': '7' }), respond(200)]);
    const { waits, sleep } = recordingSleep();

    const response = await withRateLimitRetry(http, { sleep, maxRetries: 3 })(request);

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([7000]);
  });

  it('waits 5 seconds when the provider gives no usable time', async () => {
    const { http } = scripted([respond(429), respond(429, { 'retry-after': 'soon' }), respond(200)]);
    const { waits, sleep } = recordingSleep();

    await withRateLimitRetry(http, { sleep, maxRetries: 3 })(request);

    expect(waits).toEqual([5000, 5000]);
  });

  it('gives up after the allowed number of retries and hands back the throttled response', async () => {
    const throttled = respond(429, { 'retry-after': '1' });
    const { http, calls } = scripted([throttled, throttled, throttled, respond(200)]);
    const { waits, sleep } = recordingSleep();

    const response = await withRateLimitRetry(http, { sleep, maxRetries: 2 })(request);

    expect(response.status).toBe(429);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 1000]);
  });
});

describe('sleep', () => {
  it('waits at least the time asked for', async () => {
    const started = Date.now();

    await sleep(20);

    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});

describe('fetch transport', () => {
  it('sends the method, headers and body, and returns status, lower-cased headers and body', async () => {
    const seen: { method?: string; auth?: string; body?: string } = {};
    const server = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        seen.method = incoming.method ?? '';
        seen.auth = incoming.headers.authorization ?? '';
        seen.body = Buffer.concat(chunks).toString();
        outgoing.writeHead(201, { 'Retry-After': '3' });
        outgoing.end('created');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    await createFetchHttp()({ method: 'GET', url: `http://127.0.0.1:${port}/x`, headers: {} });
    const bodiless = { ...seen };
    const response = await createFetchHttp()({
      method: 'POST',
      url: `http://127.0.0.1:${port}/x`,
      headers: { authorization: 'Basic abc' },
      body: '{"a":1}',
    });
    await new Promise((resolve) => server.close(resolve));

    expect(seen).toEqual({ method: 'POST', auth: 'Basic abc', body: '{"a":1}' });
    expect(bodiless).toEqual({ method: 'GET', auth: '', body: '' });
    expect(response.status).toBe(201);
    expect(response.headers['retry-after']).toBe('3');
    expect(response.body).toBe('created');
  });
});
